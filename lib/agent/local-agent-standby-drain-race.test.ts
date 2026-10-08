import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalAgentMessageView, LocalAgentStandbyRecord } from "./local-agent-types";

const mocks = vi.hoisted(() => ({
  active: true,
  record: undefined as LocalAgentStandbyRecord | undefined,
  inbox: vi.fn<() => Promise<LocalAgentMessageView[]>>(),
  recordRead: vi.fn<() => Promise<LocalAgentStandbyRecord | undefined>>(),
  execute: vi.fn(),
  block: vi.fn(),
}));
vi.mock("@/lib/workflow", () => ({
  activeWorkflowForActor: async () => mocks.active ? { id: "workflow" } : null,
}));
vi.mock("./session-store", () => ({ getAgentSession: async () => ({ id: "worker" }) }));
vi.mock("./local-agent-mailbox", () => ({ listLocalAgentExecutableInbox: mocks.inbox }));
vi.mock("./local-agent-standby-execution", () => ({ executeLocalAgentStandbyMessage: mocks.execute }));
vi.mock("./local-agent-events", () => ({
  localAgentConsumerConnected: () => false,
  subscribeLocalAgentStandbyMessages: () => () => undefined,
}));
vi.mock("./local-agent-standby-store", () => ({
  armLocalAgentStandbyRecord: async () => mocks.record,
  blockLocalAgentStandby: mocks.block,
  disarmLocalAgentStandbyForWorkflow: async () => [],
  disarmLocalAgentStandbyRecord: async () => undefined,
  getLocalAgentStandbyRecord: mocks.recordRead,
  listAllArmedLocalAgentStandbyRecords: async () => [],
}));

const standby = await import("./local-agent-standby");
const capabilities = { authorize: async () => true, list: () => [], invoke: vi.fn(async () => ({ content: [] })) };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(async () => {
  standby.resetLocalAgentStandbyRuntimeForTest();
  mocks.active = true;
  mocks.record = {
    principal: "owner", principalHash: "owner-hash", sessionId: "worker",
    authorizationGrant: { kind: "mcp", id: "a".repeat(64), fingerprint: "fixture", resource: "https://fixture.example/mcp" },
    workflowActor: "owner:worker", workflowId: "workflow", armed: true, state: "waiting",
    armedAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
  };
  mocks.recordRead.mockReset().mockImplementation(async () => mocks.record);
  mocks.inbox.mockReset().mockResolvedValue([]);
  mocks.execute.mockReset().mockResolvedValue({ advanced: true, fatal: false });
  mocks.block.mockReset().mockImplementation(async () => {
    mocks.record = { ...mocks.record!, armed: false, state: "blocked" };
  });
  await standby.ensureLocalAgentStandbyRuntime(capabilities);
});
afterEach(() => standby.resetLocalAgentStandbyRuntimeForTest());

async function overlapEmptySnapshot() {
  const entered = deferred<void>();
  const snapshot = deferred<LocalAgentMessageView[]>();
  mocks.inbox.mockImplementationOnce(async () => {
    entered.resolve();
    return snapshot.promise;
  });
  const first = standby.drainStandbySession("owner", "worker");
  await entered.promise;
  return { first, snapshot };
}

async function joinHeldDrain() {
  const completion = standby.drainStandbySession("owner", "worker");
  // Complete the record-read and catch continuations while the inbox remains held.
  await Promise.resolve();
  await Promise.resolve();
  return { completion };
}

describe("standby overlapping drains", () => {
  it("revalidates a stale workflow after an overlapping wake during an empty snapshot", async () => {
    const { first, snapshot } = await overlapEmptySnapshot();
    mocks.active = false;
    const { completion } = await joinHeldDrain();
    snapshot.resolve([]);
    await Promise.all([first, completion]);
    expect(mocks.record).toMatchObject({ armed: false, state: "blocked" });
    expect(mocks.block).toHaveBeenCalledWith("owner", "worker", "standby workflow is no longer active");
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("processes a message arriving during an empty snapshot exactly once", async () => {
    const { first, snapshot } = await overlapEmptySnapshot();
    const message: LocalAgentMessageView = {
      id: "message", senderSessionId: "sender", senderLabel: "sender",
      targetSessionId: "worker", targetLabel: "worker", kind: "task", intent: "request",
      requiresUserRelay: false, text: "authorized work", state: "queued",
      execution: { requested: true, authorized: true, state: "pending" },
      createdAt: "2026-10-01T00:00:00Z",
    };
    let pending = true;
    mocks.inbox.mockImplementation(async () => pending ? [message] : []);
    mocks.execute.mockImplementation(async () => {
      pending = false;
      return { advanced: true, fatal: false };
    });
    const { completion } = await joinHeldDrain();
    snapshot.resolve([]);
    await Promise.all([first, completion]);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ message, capabilities }));
    expect(mocks.block).not.toHaveBeenCalled();
  });

  it("accepts a drain whose initial read completes during runner finalization", async () => {
    const entered = deferred<void>();
    const snapshot = deferred<LocalAgentMessageView[]>();
    mocks.inbox.mockImplementationOnce(() => {
      entered.resolve();
      return snapshot.promise;
    });
    const first = standby.drainStandbySession("owner", "worker");
    await entered.promise;
    const initialRead = deferred<LocalAgentStandbyRecord | undefined>();
    mocks.recordRead.mockImplementationOnce(() => initialRead.promise);
    mocks.active = false;
    const completion = standby.drainStandbySession("owner", "worker");
    // Queue the second lookup between the first runner's exit and a chained finally.
    initialRead.resolve(mocks.record);
    snapshot.resolve([]);
    await Promise.all([first, completion]);
    expect(mocks.record).toMatchObject({ armed: false, state: "blocked" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
