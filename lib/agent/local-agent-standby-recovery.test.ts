import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  arm,
  authorizationGrant,
  capabilities,
  cleanupStandbyFixture,
  events,
  eventually,
  mailbox,
  messaging,
  mocks,
  other,
  owner,
  pair,
  resetStandbyMocks,
  resetStandbyRuntime,
  standby,
  standbyStore,
  token,
  workflowActor,
  workflowId,
} from "./local-agent-standby-test-fixture";

beforeEach(resetStandbyMocks);
afterEach(resetStandbyRuntime);
afterAll(cleanupStandbyFixture);

describe("durable local-agent standby recovery and security", () => {
  it("reconciles an armed worker and pending mailbox request after runtime restart", async () => {
    const { coordinator, worker } = await pair();
    await arm(worker.id);
    standby.resetLocalAgentStandbyRuntimeForTest();
    expect(events.localAgentStandbySubscriberCount(worker.id)).toBe(0);

    const sent = await messaging.sendLocalAgentMessage({
      principal: owner,
      senderSessionId: coordinator.id,
      target: worker.id,
      text: "survive restart",
      intent: "request",
      executionAuthorized: true,
      authorizationGrant,
    });
    expect(sent.status).toBe("accepted_for_standby");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.handoff).not.toHaveBeenCalled();

    await standby.ensureLocalAgentStandbyRuntime(capabilities);
    await eventually(() =>
      mailbox.findLocalAgentReply(owner, coordinator.id, sent.message.id));
    expect(mocks.handoff).toHaveBeenCalledTimes(1);
    expect(events.localAgentStandbySubscriberCount(worker.id)).toBe(1);
  });

  it("never wakes for notify-only or a request not authorized by exec scope", async () => {
    const { coordinator, worker } = await pair();
    await arm(worker.id);
    const notify = await messaging.sendLocalAgentMessage({
      principal: owner,
      senderSessionId: coordinator.id,
      target: worker.id,
      text: "FYI only",
      intent: "notify",
      executionAuthorized: true,
      authorizationGrant,
    });
    const writeOnly = await messaging.sendLocalAgentMessage({
      principal: owner,
      senderSessionId: coordinator.id,
      target: worker.id,
      text: "write token request",
      intent: "request",
      executionAuthorized: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(mocks.handoff).not.toHaveBeenCalled();
    expect(notify.message.execution).toBeUndefined();
    expect(writeOnly.message.execution).toMatchObject({
      requested: true,
      authorized: false,
      state: "pending",
    });
  });

  it("disarms explicitly and refuses execution under a stale workflow", async () => {
    const { coordinator, worker } = await pair();
    await arm(worker.id);
    const stopped = await standby.stopLocalAgentStandby({
      principal: owner,
      sessionId: worker.id,
      workflowId,
    });
    expect(stopped).toMatchObject({ standbyArmed: false, changed: true });
    const afterStop = await messaging.sendLocalAgentMessage({
      principal: owner,
      senderSessionId: coordinator.id,
      target: worker.id,
      text: "do not auto execute",
      intent: "request",
      executionAuthorized: true,
      authorizationGrant,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(afterStop.status).not.toBe("accepted_for_standby");
    expect(mocks.handoff).not.toHaveBeenCalled();

    await arm(worker.id);
    await new Promise((resolve) => setTimeout(resolve, 30));
    mocks.active = false;
    await standby.drainStandbySession(owner, worker.id);
    const blocked = await eventually(async () => {
      const current = await standbyStore.getLocalAgentStandbyRecord(owner, worker.id);
      return current?.state === "blocked" ? current : null;
    });
    expect(blocked).toMatchObject({ armed: false, state: "blocked" });
  });

  it("enforces same-owner standby state", async () => {
    const { worker } = await pair();
    await arm(worker.id);
    expect(await standbyStore.getLocalAgentStandbyRecord(other, worker.id)).toBeNull();
    await expect(standbyStore.armLocalAgentStandbyRecord({
      principal: other,
      sessionId: worker.id,
      workflowActor,
      workflowId,
    })).rejects.toThrow(/session not found/i);
  });

  it("blocks recovered standby before claiming queued work after its durable token is revoked", async () => {
    const { coordinator, worker } = await pair();
    await arm(worker.id); standby.resetLocalAgentStandbyRuntimeForTest();
    const sent = await messaging.sendLocalAgentMessage({ principal: owner, senderSessionId: coordinator.id, target: worker.id, text: "queued before restart", intent: "request", executionAuthorized: true, authorizationGrant });
    const credentials = await import("@/lib/mcp/store");
    await credentials.revokeToken((await credentials.validateToken(token))!.hash);
    await standby.ensureLocalAgentStandbyRuntime(capabilities);
    const blocked = await eventually(async () => { const row = await standbyStore.getLocalAgentStandbyRecord(owner, worker.id); return row?.state === "blocked" ? row : null; });
    expect(blocked.armed).toBe(false); expect(mocks.handoff).not.toHaveBeenCalled();
    expect((await mailbox.getLocalAgentInboxMessage(owner, worker.id, sent.message.id))?.execution?.state).toBe("pending");
  });
});
