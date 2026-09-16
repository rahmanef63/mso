import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { normalizeSessionEventSemantics } from "@/lib/agent/session-semantic";
import type { AgentSession } from "@/lib/agent/session-types";
import type { WorkflowStep } from "./types";
import { workflowStepProvenance } from "./session-provenance";

it("links workflow steps to human Sx.Ay/E# receipts without persisting internal session id", () => {
  const now = new Date().toISOString(), principal = "mcp-client:test";
  const session: AgentSession = {
    id: "20260917_010101_deadbeef", principalHash: createHash("sha256").update(principal).digest("hex"), source: "mcp", name: "milo", title: "Build", titleSource: "auto",
    createdAt: now, updatedAt: now, cwd: "/srv/project", memorySnapshot: { capturedAt: now, user: "", memory: "" }, history: [], eventSeqBase: 0,
    events: normalizeSessionEventSemantics([
      { at: now, kind: "tool", tool: "fs_read", state: "completed", workflowId: "wf-1", detail: "src/app.ts" },
      { at: now, kind: "tool", tool: "fs_write", state: "completed", workflowId: "wf-1", detail: "src/app.ts" },
    ]), estimatedTokens: 0, lifetimeEstimatedTokens: 0, compactThresholdTokens: 700000, compactionCount: 0, archiveCount: 0,
  };
  const steps: WorkflowStep[] = [
    { id: "one", tool: "fs_read", state: "completed", ts: now },
    { id: "two", tool: "fs_write", state: "completed", ts: now },
  ];
  const out = workflowStepProvenance(session, "wf-1", "milo-build", steps);
  expect(out.one).toMatchObject({ sessionLabel: "milo-build", eventRef: "E1" });
  expect(out.one?.actionRef).toMatch(/^S\d+\.A\d+$/);
  expect(out.one?.artifactRefs?.[0]).toMatch(/^artifact_[a-f0-9]{20}$/);
  expect(JSON.stringify(out)).not.toContain(session.id);
});
