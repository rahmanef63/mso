import { describe, expect, it } from "vitest";
import type { AgentSession } from "./session-types";
import { normalizeSessionEventSemantics } from "./session-semantic";
import { sessionWorkflowDraftDefinition } from "./session-workflow-draft";

function session(): AgentSession {
  const now = new Date().toISOString();
  return {
    id: "20260917_010101_deadbeef", principalHash: "a".repeat(64), source: "mcp", name: "milo", title: "Deploy app", titleSource: "auto",
    createdAt: now, updatedAt: now, cwd: "/srv/app", memorySnapshot: { capturedAt: now, user: "", memory: "" }, history: [],
    events: normalizeSessionEventSemantics([
      { at: now, kind: "tool", tool: "fs_read", state: "completed", detail: "src/app.ts token=secret-value" },
      { at: now, kind: "tool", tool: "fs_write", state: "completed", detail: "src/app.ts" },
    ]), eventSeqBase: 0, estimatedTokens: 0, lifetimeEstimatedTokens: 0, compactThresholdTokens: 700000, compactionCount: 0, archiveCount: 0,
  };
}

describe("session workflow drafts", () => {
  it("creates an inert private-review draft without raw details or internal session ids", () => {
    const source = session(), draft = sessionWorkflowDraftDefinition(source);
    expect(draft.status).toBe("draft");
    expect(draft.metadata.provenance).toBe("learned-from-session");
    const tools = draft.nodes.filter((node) => node.type === "tool");
    expect(tools).toHaveLength(2);
    expect(tools.every((node) => node.disabled === true && node.config.reviewRequired === true)).toBe(true);
    expect(JSON.stringify(draft)).not.toContain(source.id);
    expect(JSON.stringify(draft)).not.toContain("secret-value");
    expect(JSON.stringify(draft)).not.toContain("src/app.ts token");
  });

  it("can save one exact semantic step", () => {
    const source = session(), all = sessionWorkflowDraftDefinition(source);
    const ref = String(all.nodes.find((node) => node.type === "tool")!.config.sourceRef).split(".A")[0]!;
    const one = sessionWorkflowDraftDefinition(source, ref);
    expect(one.name).toContain(ref);
    expect(one.metadata.tags).toContain(ref);
    expect(one.nodes.filter((node) => node.type === "tool").every((node) => String(node.config.sourceRef).startsWith(`${ref}.A`))).toBe(true);
  });
});
