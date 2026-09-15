import { describe, expect, it } from "vitest";
import type { WorkflowGraph } from "@/lib/contracts/workflow-graph";
import { tidyWorkflowNodes } from "./canvas-layout";

const graph = (nodes: WorkflowGraph["nodes"], edges: WorkflowGraph["edges"]): WorkflowGraph => ({
  version: 2, id: "g", name: "Graph", description: "", status: "draft", inputs: {}, metadata: {},
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", revision: "r", nodes, edges,
});
const node = (id: string): WorkflowGraph["nodes"][number] => ({ id, name: id, type: id === "manual" ? "manual" : id === "output" ? "output" : "tool", position: { x: 0, y: 0 }, config: {} });

describe("workflow canvas tidy layout", () => {
  it("lays dependencies left to right and branches without overlap", () => {
    const rows = tidyWorkflowNodes(graph([node("manual"), node("alpha"), node("beta"), node("output")], [
      { id: "a", source: "manual", target: "alpha" }, { id: "b", source: "manual", target: "beta" },
      { id: "c", source: "alpha", target: "output" }, { id: "d", source: "beta", target: "output" },
    ]));
    const byId = new Map(rows.map((row) => [row.id, row.position]));
    expect(byId.get("manual")!.x).toBeLessThan(byId.get("alpha")!.x);
    expect(byId.get("alpha")!.x).toBeLessThan(byId.get("output")!.x);
    expect(byId.get("alpha")!.y).not.toBe(byId.get("beta")!.y);
  });

  it("keeps invalid cyclic drafts finite instead of exploding layout", () => {
    const rows = tidyWorkflowNodes(graph([node("alpha"), node("beta")], [{ id: "a", source: "alpha", target: "beta" }, { id: "b", source: "beta", target: "alpha" }]));
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(Number.isFinite(row.position.x) && Number.isFinite(row.position.y)).toBe(true);
  });
});
