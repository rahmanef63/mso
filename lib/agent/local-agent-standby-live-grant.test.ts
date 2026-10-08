import { afterAll, afterEach, expect, it } from "vitest";
import { arm, authorizationGrant, capabilities, cleanupStandbyFixture, completedTask, eventually, messaging, mocks, owner, pair, resetStandbyRuntime, standbyStore, token } from "./local-agent-standby-test-fixture";

afterEach(resetStandbyRuntime);
afterAll(cleanupStandbyFixture);

it("rechecks the durable credential before each capability during an already-started worker", async () => {
  const { coordinator, worker } = await pair();
  const credentials = await import("@/lib/mcp/store");
  mocks.handoff.mockImplementation(async (_principal, _session, _message, runtime) => {
    await credentials.revokeToken((await credentials.validateToken(token))!.hash);
    const result = await runtime.invoke({ name: "host_exec", args: {}, scope: "exec", principal: owner });
    expect(result.isError).toBe(true);
    return completedTask();
  });
  await arm(worker.id);
  await messaging.sendLocalAgentMessage({ principal: owner, senderSessionId: coordinator.id, target: worker.id, text: "exercise active grant", intent: "request", executionAuthorized: true, authorizationGrant });
  await eventually(async () => (await standbyStore.getLocalAgentStandbyRecord(owner, worker.id))?.lastMessageId);
  expect(mocks.handoff).toHaveBeenCalledOnce();
  expect(capabilities.invoke).not.toHaveBeenCalled();
});
