import { describe, expect, it } from "vitest";
import { workflowStartProjection } from "./tools-workflow-start-output";

describe("workflow_start structured projection", () => {
  it("carries selected agent/project memory and recipe context to compact clients", () => {
    const projected = workflowStartProjection({
      workflow: { id: "wf-1", intent: "fix memory retrieval", project: "/srv/mso", startedAt: "2026-09-19T00:00:00.000Z", steps: [] },
      bootstrap: {
        orchestration: {
          memoryHits: 3,
          agentMemory: [{ ref: "MEMORY.md#Browser gotcha", kind: "procedural", key: "Browser gotcha", value: "Camoufox is on-demand.", score: 14 }],
          memory: [{ id: "mem-project-1", kind: "failure", title: "Prior regression", summary: "Viewer failed after stale auth.", score: 0.91, lastVerified: "2026-09-18T10:00:00.000Z" }],
          recipe: {
            id: "recipe-1", maturity: "verified", attempts: 4, successRate: 100,
            steps: [{ tool: "browser_status" }, { tool: "exec_run" }],
            instruction: "Prefer the verified bounded route when current evidence is compatible.",
          },
        },
      },
    }) as { context: { memoryHits: number; memory: Array<{ source: string; ref: string; text: string }>; recipe: { id: string; maturity: string; tools: string[] } } };

    expect(projected.context.memoryHits).toBe(3);
    expect(projected.context.memory).toEqual([
      expect.objectContaining({ source: "agent", ref: "MEMORY.md#Browser gotcha", text: "Camoufox is on-demand." }),
      expect.objectContaining({ source: "project", ref: "mem-project-1", text: "Viewer failed after stale auth." }),
    ]);
    expect(projected.context.recipe).toMatchObject({ id: "recipe-1", maturity: "verified", tools: ["browser_status", "exec_run"] });
  });

  it("falls back to projected memory plus recipe when orchestration count is absent", () => {
    const projected = workflowStartProjection({
      workflow: { id: "wf-2", startedAt: "2026-09-19T00:00:00.000Z", steps: [] },
      bootstrap: { orchestration: { agentMemory: [{ ref: "USER.md#Locale", value: "Indonesia" }], recipe: { id: "r", maturity: "candidate", attempts: 2, successRate: 100, steps: [] } } },
    }) as { context: { memoryHits: number } };
    expect(projected.context.memoryHits).toBe(2);
  });
});
