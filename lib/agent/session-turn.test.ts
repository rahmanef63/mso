import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CapabilityRuntime } from "@/lib/capabilities/runtime";

const root = mkdtempSync(path.join(os.tmpdir(), "mso-session-turn-test-"));
process.env.OS_AGENT_SESSIONS_DIR = path.join(root, "sessions");

const mockHandoff = vi.hoisted(() => vi.fn());
vi.mock("@/lib/a2a/local-session", () => ({
  handoffOwnerLocalSession: mockHandoff,
}));

const { createAgentSession, getAgentSession } = await import("./session-store");
const { clearAllSessionTurnLeasesForTest, runDurableSessionTurn } = await import("./session-turn");

afterAll(() => rmSync(root, { recursive: true, force: true }));

beforeEach(() => {
  clearAllSessionTurnLeasesForTest();
  mockHandoff.mockReset();
});

const capabilities: CapabilityRuntime = {
  list: () => [],
  invoke: vi.fn(async () => ({ content: [] })),
};

describe("durable session turn runner", () => {
  it("persists history and an audit event for a completed turn", async () => {
    const session = await createAgentSession("principal:alice", "cli", {
      title: "turn-test",
      history: [{ role: "user", text: "initial greeting" }],
    });

    mockHandoff.mockResolvedValueOnce({
      session,
      task: {
        artifacts: [{ parts: [{ text: "assistant response" }] }],
        rounds: 2,
        toolCalls: [{ name: "test_tool", ok: true }],
      },
    });

    const result = await runDurableSessionTurn({
      principal: "principal:alice",
      sessionRef: session.id,
      objective: "perform bounded turn",
      capabilities,
      authority: { principal: "principal:alice", scope: "exec", workflowId: "wf-123" },
    });

    expect(result).toEqual({
      sessionRef: session.id,
      rounds: 2,
      toolCalls: [{ name: "test_tool", ok: true }],
      text: "assistant response",
    });

    expect(mockHandoff).toHaveBeenCalledWith(
      "principal:alice",
      session.id,
      "perform bounded turn",
      capabilities,
      undefined,
      { authority: { principal: "principal:alice", scope: "exec", workflowId: "wf-123" }, workflowId: "wf-123" },
    );

    const updated = await getAgentSession("principal:alice", session.id);
    expect(updated?.history).toEqual([
      { role: "user", text: "initial greeting" },
      { role: "user", text: "perform bounded turn" },
      { role: "assistant", text: "assistant response" },
    ]);
    expect(updated?.events).toHaveLength(2);
    expect(updated?.events.at(-1)).toMatchObject({
      kind: "workflow",
      tool: "agent_turn",
      state: "completed",
      workflowId: "wf-123",
      detail: "perform bounded turn",
    });
  });

  it("fails closed without modifying history for unavailable or unauthorized sessions", async () => {
    const session = await createAgentSession("principal:alice", "cli", {
      title: "auth-test",
      history: [{ role: "user", text: "secret data" }],
    });

    await expect(
      runDurableSessionTurn({
        principal: "principal:alice",
        sessionRef: "non-existent-session-id",
        objective: "test",
        capabilities,
      }),
    ).rejects.toThrow(/session_not_found/);

    await expect(
      runDurableSessionTurn({
        principal: "principal:bob",
        sessionRef: session.id,
        objective: "unauthorized access",
        capabilities,
      }),
    ).rejects.toThrow(/session_not_found/);

    expect(mockHandoff).not.toHaveBeenCalled();

    const record = await getAgentSession("principal:alice", session.id);
    expect(record?.history).toEqual([{ role: "user", text: "secret data" }]);
    expect(record?.events).toHaveLength(1);
    expect(record?.events[0].kind).toBe("created");
  });

  it("prevents interleaving writes when two turns execute concurrently on the same session", async () => {
    const session = await createAgentSession("principal:alice", "cli", {
      title: "lease-test",
      history: [{ role: "user", text: "baseline" }],
    });

    let resolveTurn1!: (value: unknown) => void;
    const turn1Pending = new Promise((resolve) => {
      resolveTurn1 = resolve;
    });
    let signalHandoffEntered!: () => void;
    const handoffEntered = new Promise<void>((resolve) => {
      signalHandoffEntered = resolve;
    });
    mockHandoff.mockImplementationOnce(() => {
      signalHandoffEntered();
      return turn1Pending;
    });

    const turn1Promise = runDurableSessionTurn({
      principal: "principal:alice",
      sessionRef: session.id,
      objective: "turn 1 objective",
      capabilities,
    });

    // Deterministic: the handoff is the only point after `acquireSessionTurnLease`,
    // so waiting for turn 1 to ENTER it proves turn 1 holds the lease before the
    // contender starts. Without this barrier the two turns race after their
    // `resolveAgentSessionRef` awaits and the contender can win instead — leaving
    // turn 2 pending and turn 1's rejection unhandled.
    await handoffEntered;

    try {
      await expect(
        runDurableSessionTurn({
          principal: "principal:alice",
          sessionRef: session.id,
          objective: "turn 2 objective",
          capabilities,
        }),
      ).rejects.toThrow(/already in progress/);
    } finally {
      // Release turn 1 even if the rejection assertion above fails, so its pending
      // turn (and any unhandled rejection it would otherwise strand) is not left
      // behind for the next test.
      resolveTurn1({
        session,
        task: { artifacts: [{ parts: [{ text: "turn 1 result" }] }] },
      });
    }

    const turn1Result = await turn1Promise;
    expect(turn1Result.text).toBe("turn 1 result");

    const sessionAfterTurn1 = await getAgentSession("principal:alice", session.id);
    expect(sessionAfterTurn1?.history).toEqual([
      { role: "user", text: "baseline" },
      { role: "user", text: "turn 1 objective" },
      { role: "assistant", text: "turn 1 result" },
    ]);
    expect(sessionAfterTurn1?.events).toHaveLength(2);

    mockHandoff.mockResolvedValueOnce({
      session,
      task: { artifacts: [{ parts: [{ text: "turn 3 result" }] }] },
    });
    const turn3Result = await runDurableSessionTurn({
      principal: "principal:alice",
      sessionRef: session.id,
      objective: "turn 3 objective",
      capabilities,
    });
    expect(turn3Result.text).toBe("turn 3 result");

    const sessionAfterTurn3 = await getAgentSession("principal:alice", session.id);
    expect(sessionAfterTurn3?.history).toHaveLength(5);
    expect(sessionAfterTurn3?.events).toHaveLength(3);
  });
});
