import { afterAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeSessionEventSemantics } from "./session-semantic";
import { resolveSessionFlowAction } from "./session-flow";
import type { AgentSession } from "./session-types";

const root = await mkdtemp(path.join(os.tmpdir(), "mso-action-history-"));
process.env.OS_AGENT_SESSION_ARCHIVE_DIR = root;
const history = await import("./session-action-history");

afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe("archive-backed session action lookup", () => {
  it("keeps evicted action refs resolvable without crossing principals", async () => {
    const principal = "mcp-client:owner", now = Date.now();
    const all = normalizeSessionEventSemantics(Array.from({ length: 401 }, (_, index) => ({
      at: new Date(now + index).toISOString(), kind: "tool" as const, tool: index === 0 ? "fs_read" : "fs_write", state: "completed", detail: index === 0 ? "src/old.ts token=secret-value" : `src/${index}.ts`,
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
    }
    await expect(history.resolveHistoricalSessionAction("mcp-client:other", session, "E1")).rejects.toThrow("session not found");
  });
});
