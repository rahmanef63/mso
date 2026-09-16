import { describe, expect, it } from "vitest";
import { semanticSessionFlow } from "./session-flow";
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
});
