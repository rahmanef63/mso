import { afterAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeSessionEventSemantics } from "./session-semantic";
import { resolveSessionFlowAction } from "./session-flow";
import type { AgentSession } from "./session-types";

const root = await mkdtemp(path.join(os.tmpdir(), "mso-action-history-"));
process.env.OS_AGENT_SESSION_ARCHIVE_DIR = path.join(root, "archives");
process.env.OS_AGENT_SESSIONS_DIR = path.join(root, "sessions");
const history = await import("./session-action-history");

afterAll(async () => { delete process.env.OS_AGENT_SESSION_ARCHIVE_DIR; delete process.env.OS_AGENT_SESSIONS_DIR; await rm(root, { recursive: true, force: true }); });

describe("archive-backed session action lookup", () => {
  it("keeps evicted action refs resolvable without crossing principals", async () => {
    const principal = "mcp-client:owner", now = Date.now();
    const all = normalizeSessionEventSemantics(Array.from({ length: 401 }, (_, index) => ({
      at: new Date(now + index).toISOString(), kind: "tool" as const, tool: index === 0 ? "fs_read" : "fs_write", state: "completed", detail: index === 0 ? "src/old.ts token=secret-value" : `src/${index}.ts`,
      ...(index === 0 ? { artifactRevision: { version: 1 as const, cwd: "/srv/project", relativePath: "src/old.ts", worktreeSha256: "a".repeat(64), bytes: 12, cleanAtCapture: false } } : {}),
    })));
    const original = resolveSessionFlowAction(all, "E1", "/srv/project", 0)!;
    const session: AgentSession = {
      id: "20260917_010101_deadbeef", principalHash: createHash("sha256").update(principal).digest("hex"), source: "mcp", name: "milo", title: "History", titleSource: "auto",
      createdAt: all[0]!.at, updatedAt: all.at(-1)!.at, cwd: "/srv/project", memorySnapshot: { capturedAt: all[0]!.at, user: "", memory: "" }, history: [],
      events: all.slice(1), eventSeqBase: 1, estimatedTokens: 0, lifetimeEstimatedTokens: 0, compactThresholdTokens: 700000, compactionCount: 0, archiveCount: 0,
    };
    await history.archiveDroppedSessionEvents(session, [all[0]!], 0);
    for (const ref of ["E1", original.action.ref, original.action.id]) {
      const resolved = await history.resolveHistoricalSessionAction(principal, session, ref);
      expect(resolved?.action.eventRef).toBe("E1");
      expect(JSON.stringify(resolved)).not.toContain("secret-value");
      const record = await history.resolveHistoricalSessionActionRecord(principal, session, ref);
      expect(record?.event.artifactRevision).toMatchObject({ relativePath: "src/old.ts", bytes: 12 });
    }
    await expect(history.resolveHistoricalSessionAction("mcp-client:other", session, "E1")).rejects.toThrow("session not found");
  });
});


describe("preserved action index overflow", () => {
  it("resolves an older event after more than 5000 records without crossing principals", async () => {
    const principal = "mcp-client:overflow", now = Date.now();
    const events = normalizeSessionEventSemantics(Array.from({ length: 5001 }, (_, index) => ({
      at: new Date(now + index).toISOString(), kind: "tool" as const, tool: "fs_read", state: "completed", detail: `file-${index}.md`,
    })));
    const session: AgentSession = {
      id: "20260925_020202_cafebabe", principalHash: createHash("sha256").update(principal).digest("hex"), source: "mcp", name: "overflow", title: "Overflow", titleSource: "auto",
      createdAt: events[0]!.at, updatedAt: events.at(-1)!.at, cwd: "/srv/project", memorySnapshot: { capturedAt: events[0]!.at, user: "", memory: "" }, history: [],
      events: [], eventSeqBase: 5001, estimatedTokens: 0, lifetimeEstimatedTokens: 0, compactThresholdTokens: 700000, compactionCount: 0, archiveCount: 0,
    };
    await history.archiveDroppedSessionEvents(session, events, 0);
    const index = await import("./session-action-index");
    expect((await index.readActionIndex(index.actionIndexPath(session.id)))?.records).toHaveLength(5000);
    expect(await index.readActionSegments(session.id)).toHaveLength(1);
    expect((await history.resolveHistoricalSessionAction(principal, session, "E1"))?.action.eventRef).toBe("E1");
    await expect(history.resolveHistoricalSessionAction("mcp-client:other", session, "E1")).rejects.toThrow("session not found");
  });
});
