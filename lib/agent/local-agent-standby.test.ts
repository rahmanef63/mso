import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  arm,
  capabilities,
  cleanupStandbyFixture,
  completedTask,
  directory,
  events,
  eventually,
  mailbox,
  messaging,
  mocks,
  owner,
  pair,
  resetStandbyMocks,
  resetStandbyRuntime,
  standbyStore,
  workflowActor,
  workflowId,
} from "./local-agent-standby-test-fixture";

beforeEach(resetStandbyMocks);
afterEach(resetStandbyRuntime);
afterAll(cleanupStandbyFixture);

describe("server-native durable local-agent standby execution", () => {
  it("arms immediately without a foreground receiver and remains explicitly actionable", async () => {
    const { worker } = await pair();
    const started = Date.now();
    const result = await arm(worker.id);
    expect(Date.now() - started).toBeLessThan(500);
    expect(result).toMatchObject({
      mode: "listen",
      status: "waiting",
      standbyArmed: true,
      workflowId,
    });
    const row = (await directory.listLocalAgents(owner, { includeOffline: true }))
      .find((item) => item.id === worker.id);
    expect(row).toMatchObject({
      consumerConnected: false,
      consumerCount: 0,
      standbyArmed: true,
      standbyState: "waiting",
      standbyWorkflowId: workflowId,
      actionable: true,
    });
    expect(events.localAgentSubscriberCount(worker.id)).toBe(0);
    expect(events.localAgentStandbySubscriberCount(worker.id)).toBe(1);
  });

  it("executes a correlated request, replies once, and returns to waiting", async () => {
    const { coordinator, worker } = await pair();
    await arm(worker.id);
    const sent = await messaging.sendLocalAgentMessage({
      principal: owner,
      senderSessionId: coordinator.id,
      target: worker.id,
      text: "perform one bounded task",
      kind: "task",
      intent: "request",
      requiresUserRelay: true,
      executionAuthorized: true,
    });
    expect(sent.status).toBe("accepted_for_standby");
    const reply = await eventually(() =>
      mailbox.findLocalAgentReply(owner, coordinator.id, sent.message.id));
    expect(reply.text).toBe("standby result");
    expect(mocks.handoff).toHaveBeenCalledTimes(1);
    expect(mocks.handoff).toHaveBeenCalledWith(
      owner,
      worker.id,
      "perform one bounded task",
      capabilities,
      undefined,
      { workflowId, workflowActor, fixedWorkflow: true },
    );
    const record = await eventually(async () => {
      const current = await standbyStore.getLocalAgentStandbyRecord(owner, worker.id);
      return current?.state === "waiting" &&
        current.lastMessageId === sent.message.id
        ? current
        : null;
    });
    expect(record).toMatchObject({
      armed: true,
      state: "waiting",
      lastMessageId: sent.message.id,
    });
    const executed = await mailbox.getLocalAgentInboxMessage(
      owner,
      worker.id,
      sent.message.id,
    );
    expect(executed?.execution).toMatchObject({
      authorized: true,
      state: "completed",
      attempts: 1,
    });
  });

  it("does not execute the same durable message twice when duplicate events arrive", async () => {
    const { coordinator, worker } = await pair();
    await arm(worker.id);
    const sent = await messaging.sendLocalAgentMessage({
      principal: owner,
      senderSessionId: coordinator.id,
      target: worker.id,
      text: "deduplicate me",
      intent: "request",
      executionAuthorized: true,
    });
    events.publishLocalAgentStandbyMessage(worker.id, sent.message);
    events.publishLocalAgentStandbyMessage(worker.id, sent.message);
    await eventually(() =>
      mailbox.findLocalAgentReply(owner, coordinator.id, sent.message.id));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mocks.handoff).toHaveBeenCalledTimes(1);
  });

  it("queues a second request while working and drains sequentially with no overlap", async () => {
    const { coordinator, worker } = await pair();
    await arm(worker.id);
    let releaseFirst!: () => void;
    let active = 0;
    let peak = 0;
    mocks.handoff.mockImplementationOnce(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => { releaseFirst = resolve; });
      active -= 1;
      return completedTask("first done");
    });
    mocks.handoff.mockImplementationOnce(async () => {
      active += 1;
      peak = Math.max(peak, active);
      active -= 1;
      return completedTask("second done");
    });

    const first = await messaging.sendLocalAgentMessage({
      principal: owner,
      senderSessionId: coordinator.id,
      target: worker.id,
      text: "first",
      intent: "request",
      executionAuthorized: true,
    });
    await eventually(async () => mocks.handoff.mock.calls.length === 1 ? true : null);
    const second = await messaging.sendLocalAgentMessage({
      principal: owner,
      senderSessionId: coordinator.id,
      target: worker.id,
      text: "second",
      intent: "request",
      executionAuthorized: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mocks.handoff).toHaveBeenCalledTimes(1);
    const row = (await directory.listLocalAgents(owner, { includeOffline: true }))
      .find((item) => item.id === worker.id);
    expect(row?.queuedCount).toBeGreaterThanOrEqual(1);
    releaseFirst();
    await eventually(() =>
      mailbox.findLocalAgentReply(owner, coordinator.id, second.message.id));
    expect(await mailbox.findLocalAgentReply(
      owner,
      coordinator.id,
      first.message.id,
    )).toBeTruthy();
    expect(mocks.handoff).toHaveBeenCalledTimes(2);
    expect(peak).toBe(1);
  });
});
