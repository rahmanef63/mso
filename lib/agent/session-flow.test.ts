import { describe, expect, it } from "vitest";
import { resolveSessionFlowAction, semanticSessionFlow } from "./session-flow";
import { appendSemanticSessionEvent, normalizeSessionEventSemantics } from "./session-semantic";
import { retainSessionEvents } from "./session-sequence";
import type { AgentSessionEvent } from "./session-types";

const at = (n: number) => new Date(1_780_000_000_000 + n * 1000).toISOString();

describe("semantic session flow", () => {
  it("compresses raw tool events into readable steps with referable actions", () => {
    const events: AgentSessionEvent[] = [
      { at: at(0), kind: "created", detail: "session started" },
      { at: at(1), kind: "tool", tool: "exec_run", state: "completed", detail: "git status --short" },
      { at: at(2), kind: "tool", tool: "fs_read", state: "completed", detail: "frontend/app.tsx" },
      { at: at(3), kind: "tool", tool: "fs_write", state: "completed", detail: "scripts/release.sh" },
      { at: at(4), kind: "tool", tool: "exec_run", state: "completed", detail: "bunx vitest run token=secret-value" },
      { at: at(5), kind: "tool", tool: "exec_run", state: "completed", detail: "git commit -m release" },
      { at: at(6), kind: "tool", tool: "exec_run", state: "completed", detail: "mso deploy" },
    ];
    const flow = semanticSessionFlow(events, 120, "/srv/project");
    expect(flow.steps.length).toBeLessThanOrEqual(8);
    expect(flow.steps.map((step) => step.category)).toEqual(expect.arrayContaining(["context", "inspect", "implement", "verify", "integrate", "deploy"]));
    expect(flow.steps.flatMap((step) => step.actions).every((action) => /^S\d+\.A\d+$/.test(action.ref))).toBe(true);
    expect(flow.steps.flatMap((step) => step.actions).map((action) => action.eventRef)).toEqual(["E1","E2","E3","E4","E5","E6","E7"]);
    expect(JSON.stringify(flow)).not.toContain("secret-value");
  });

  it("exposes commands as code receipts and safe project-local file artifacts", () => {
    const flow = semanticSessionFlow([
      { at: at(0), kind: "tool", tool: "exec_run", state: "completed", detail: "bash scripts/release.sh" },
    ], 120, "/srv/project");
    const action = flow.steps[0]!.actions[0]!;
    expect(action.code).toMatchObject({ kind: "command", language: "bash", content: "bash scripts/release.sh" });
    expect(action.artifact).toMatchObject({ path: "/srv/project/scripts/release.sh", label: "release.sh", kind: "script" });
    expect(action.terminalContext).toBe(true);
  });

  it("keeps stable refs when the latest-120 projection moves and resolves actions outside the canvas window", () => {
    const raw: AgentSessionEvent[] = Array.from({ length: 140 }, (_, index) => ({
      at: at(index),
      kind: "tool",
      tool: index % 3 === 0 ? "fs_read" : index % 3 === 1 ? "fs_write" : "exec_run",
      state: "completed",
      detail: index % 3 === 2 ? "bunx vitest run" : `src/file-${index}.ts`,
    }));
    const indexed = normalizeSessionEventSemantics(raw);
    const before = resolveSessionFlowAction(indexed, "E130", "/srv/project", 0)!;
    const projected = semanticSessionFlow(indexed, 120, "/srv/project", 0);
    expect(projected.shownEvents).toBeLessThanOrEqual(120);
    expect(projected.steps.length).toBeLessThanOrEqual(8);
    let next = indexed;
    for (let index = 140; index < 180; index += 1) next = appendSemanticSessionEvent(next, { at: at(index), kind: "tool", tool: "fs_read", state: "completed", detail: `src/new-${index}.ts` });
    const after = resolveSessionFlowAction(next, "E130", "/srv/project", 0)!;
    expect(after.action.ref).toBe(before.action.ref);
    expect(after.action.id).toBe(before.action.id);
    expect(semanticSessionFlow(next, 120, "/srv/project", 0).steps.flatMap((step) => step.actions).some((action) => action.eventRef === "E130")).toBe(false);
  });

  it("keeps refs stable across MAX_EVENTS rotation using persisted semantic metadata and eventSeqBase", () => {
    let events = normalizeSessionEventSemantics(Array.from({ length: 400 }, (_, index) => ({
      at: at(index), kind: "tool" as const, tool: index < 200 ? "fs_read" : "fs_write", state: "completed", detail: `src/${index}.ts`,
    })));
    const before = resolveSessionFlowAction(events, "E400", "/srv/project", 0)!;
    const appended = appendSemanticSessionEvent(events, { at: at(400), kind: "tool", tool: "fs_write", state: "completed", detail: "src/400.ts" });
    const retained = retainSessionEvents(appended, 0, 400);
    events = retained.events;
    const after = resolveSessionFlowAction(events, "E400", "/srv/project", retained.eventSeqBase)!;
    expect(retained.eventSeqBase).toBe(1);
    expect(after.action.ref).toBe(before.action.ref);
    expect(after.action.id).toBe(before.action.id);
    expect(resolveSessionFlowAction(events, "E401", "/srv/project", retained.eventSeqBase)?.action.ref).toMatch(/^S\d+\.A\d+$/);
  });

  it("aggregates homogeneous actions without losing exact child receipts or durable artifact identity", () => {
    const flow = semanticSessionFlow(normalizeSessionEventSemantics([
      { at: at(0), kind: "tool", tool: "fs_read", detail: "src/a.ts" },
      { at: at(1), kind: "tool", tool: "fs_read", detail: "src/b.ts" },
      { at: at(2), kind: "tool", tool: "fs_search", detail: "semanticSessionFlow" },
    ]), 120, "/srv/project", 0);
    const step = flow.steps[0]!;
    expect(step.groups.find((group) => group.key === "read")).toMatchObject({ title: "Read files", count: 2 });
    expect(step.groups.flatMap((group) => group.actionRefs)).toEqual(expect.arrayContaining(step.actions.map((action) => action.ref)));
    const artifact = step.actions[0]!.artifact!;
    expect(artifact.ref).toMatch(/^artifact_[a-f0-9]{20}$/);
    expect(artifact.relativePath).toBe("src/a.ts");
    expect(artifact.revisionRef).toBe(step.actions[0]!.ref);
  });

});
