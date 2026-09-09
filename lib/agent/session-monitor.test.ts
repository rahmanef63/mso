import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "./session-types";
import type { LocalAgentPresenceRecord } from "./local-agent-types";
const mocks = vi.hoisted(() => ({ records: vi.fn(), read: vi.fn(), presence: vi.fn(), connected: vi.fn() }));
vi.mock("./session-files", () => ({ listSessionRecords: mocks.records, readSessionFile: mocks.read, SESSION_ID: /^\d{8}_\d{6}_[a-f0-9]{8}$/ }));
vi.mock("./local-agent-presence", () => ({
  listLocalAgentPresenceOwner: mocks.presence,
  localAgentStatus: (row: LocalAgentPresenceRecord, now: number) => row.state === "ended" ? "ended" : Date.parse(row.leaseUntil) > now ? row.state : "offline",
}));
vi.mock("./local-agent-events", () => ({ localAgentConsumerConnected: mocks.connected }));
import { ownerSessionDetail, ownerSessionPage } from "./session-monitor";
const now = Date.now();
function record(i: number): AgentSession {
  return { id: `20260909_120000_${i.toString(16).padStart(8, "0")}`, principalHash: "a".repeat(64),
    source: i % 2 ? "mcp" : "cli", name: "session-" + i, title: "Work " + i, titleSource: "manual",
    createdAt: new Date(now - i * 1000).toISOString(), updatedAt: new Date(now - i * 1000).toISOString(),
    events: [], history: ["private transcript"], memorySnapshot: { secret: "private-memory" },
    archiveCount: 0 } as unknown as AgentSession;
}
function presence(row: AgentSession, extra = {}): LocalAgentPresenceRecord {
  return { sessionId: row.id, principalHash: row.principalHash, alias: "agent-a", instanceId: "test",
    state: "idle", lastSeenAt: row.updatedAt, leaseUntil: new Date(now + 60_000).toISOString(), ...extra };
}
beforeEach(() => { vi.clearAllMocks(); mocks.connected.mockReturnValue(false); });
describe("owner session monitor", () => {
  it("paginates mixed MCP/CLI active sessions six at a time without leaking private records", async () => {
    const rows = Array.from({ length: 9 }, (_, i) => record(i));
    mocks.records.mockResolvedValue(rows); mocks.presence.mockResolvedValue(rows.map(row => presence(row)));
    const first = await ownerSessionPage(1), second = await ownerSessionPage(2);
    expect(first.sessions).toHaveLength(6); expect(second.sessions).toHaveLength(3);
    expect(first.total).toBe(9); expect(first.pages).toBe(2);
    expect(new Set([...first.sessions, ...second.sessions].map(row => row.id)).size).toBe(9);
    expect(first.sessions.map(row => row.source)).toContain("cli"); expect(first.sessions.map(row => row.source)).toContain("mcp");
    expect(JSON.stringify(first)).not.toMatch(/principalHash|private transcript|private-memory|history/);
  });
  it("separates expired/ended leases and mismatched principals from active receivers", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => record(i));
    mocks.records.mockResolvedValue(rows); mocks.presence.mockResolvedValue([
      presence(rows[0]), presence(rows[1], { leaseUntil: new Date(0).toISOString() }),
      presence(rows[2], { state: "ended" }), presence(rows[3], { principalHash: "b".repeat(64) }),
    ]);
    mocks.connected.mockImplementation(id => id === rows[0].id);
    const active = await ownerSessionPage(), all = await ownerSessionPage(999, true);
    expect(active.total).toBe(1); expect(active.sessions[0].receiverConnected).toBe(true);
    expect(all.total).toBe(5); expect(all.page).toBe(1);
    expect(all.sessions.find(row => row.id === rows[3].id)?.status).toBe("offline");
  });
  it("returns bounded newest-first redacted log pages without transcript or arbitrary fields", async () => {
    const row = record(0);
    row.title = "password=should-not-appear";
    row.events = Array.from({ length: 25 }, (_, i) => ({ at: new Date(now + i).toISOString(), kind: "tool",
      tool: "exec_run", state: "completed", detail: `task ${i} token=secret-value Bearer hidden-value`, workflowId: "workflow-1" }));
    mocks.read.mockResolvedValue(row); mocks.presence.mockResolvedValue([]);
    const first = await ownerSessionDetail(row.id), second = await ownerSessionDetail(row.id, 2);
    expect(first?.events).toHaveLength(20); expect(second?.events).toHaveLength(5);
    expect(first?.events[0].detail).toContain("task 24");
    expect(JSON.stringify(first)).not.toMatch(/secret-value|hidden-value|should-not-appear|private transcript|private-memory|principalHash/);
    expect(first?.events[0].workflowId).toBe("workflow-1");
  });
  it("rejects path traversal and handles a removed session or an empty list", async () => {
    await expect(ownerSessionDetail("../private")).rejects.toThrow("invalid_session_id");
    expect(mocks.read).not.toHaveBeenCalled();
    mocks.read.mockResolvedValue(null); mocks.presence.mockResolvedValue([]);
    expect(await ownerSessionDetail(record(0).id)).toBeNull();
    mocks.records.mockResolvedValue([]);
    expect(await ownerSessionPage(Number.NaN)).toMatchObject({ page: 1, pages: 1, total: 0, sessions: [] });
  });
});
