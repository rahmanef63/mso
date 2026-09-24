import { describe, expect, it } from "vitest";
import type { WorkflowGraph } from "@/lib/contracts/workflow-graph";
import type { CapabilityTool } from "@/lib/capabilities/tool";
import { optimizeWorkflowGraph } from "./graph-optimizer";

function graph(nodes: WorkflowGraph["nodes"], edges: WorkflowGraph["edges"]): WorkflowGraph {
  return {
    version: 2,
    id: "graph-1",
    name: "Optimizer fixture",
    description: "fixture",
    status: "draft",
    inputs: {},
    nodes,
    edges,
    metadata: { provenance: "user" },
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    revision: "r1",
  };
}

const pos = (x: number) => ({ x, y: 100 });
const manual = { id: "manual", name: "Manual", type: "manual" as const, position: pos(0), config: {} };
const output = { id: "output", name: "Output", type: "output" as const, position: pos(1000), config: {} };

describe("workflow graph optimizer", () => {
  it("adds presentation-only grouping without changing executable topology", async () => {
    const nodes: WorkflowGraph["nodes"] = [
      manual,
      { id: "a", name: "A", type: "project" as const, position: pos(100), config: { project: "mso" } },
      { id: "b", name: "B", type: "skill" as const, position: pos(200), config: { query: "workflow" } },
      { id: "c", name: "C", type: "knowledge" as const, position: pos(300), config: { query: "graph" } },
      { id: "d", name: "D", type: "directory" as const, position: pos(400), config: { source: "tools" } },
      output,
    ];
    const edges = nodes.slice(1).map((node, index) => ({ id: `e${index}`, source: nodes[index]!.id, target: node.id }));
    const result = await optimizeWorkflowGraph(graph(nodes, edges));
    expect(result.preview.summary.visualGroupsAdded).toBe(1);
    expect(result.preview.summary.nodeReduction).toBe(0);
    expect((result.definition.metadata as WorkflowGraph["metadata"]).customNodes?.[0]?.nodeIds).toEqual(["a", "b", "c", "d"]);
    expect(result.definition.edges).toEqual(edges);
  });

  it("suggests repeated prepared read calls as review-only loop compaction", async () => {
    const nodes: WorkflowGraph["nodes"] = [
      manual,
      ...[1, 2, 3].map((n, index) => ({
        id: `read-${n}`,
        name: `Read ${n}`,
        type: "tool" as const,
        position: pos(100 + index * 100),
        config: { tool: "fs_read", arguments: { path: `/tmp/file-${n}.txt` } },
      })),
      output,
    ];
    const edges = nodes.slice(1).map((node, index) => ({ id: `e${index}`, source: nodes[index]!.id, target: node.id }));
    const resolveTool = (name: string) => name === "fs_read" ? ({ name, description: "read", scope: "read", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true }, run: async () => ({}) } as CapabilityTool) : undefined;
    const preview = await optimizeWorkflowGraph(graph(nodes, edges), { resolveTool });
    expect(preview.preview.reviewCandidateIds).toEqual(["loop:1"]);
    expect(preview.preview.selectedCandidateIds).toEqual([]);
    expect(preview.preview.summary.nodeReduction).toBe(0);

    const applied = await optimizeWorkflowGraph(graph(nodes, edges), { resolveTool, applyReview: true });
    expect(applied.preview.selectedCandidateIds).toEqual(["loop:1"]);
    expect(applied.preview.summary.nodeReduction).toBe(2);
    const loop = applied.definition.nodes.find((node) => node.id === "read-1");
    expect(loop?.type).toBe("loop");
    expect(loop?.config).toMatchObject({ tool: "fs_read", concurrency: 1 });
    expect((loop?.config.items as unknown[]).length).toBe(3);
  });

  it("uses Jev probabilities only as an optimization signal and falls back deterministically", async () => {
    const nodes: WorkflowGraph["nodes"] = [
      manual,
      { id: "a", name: "A", type: "project" as const, position: pos(100), config: { project: "mso" } },
      { id: "b", name: "B", type: "skill" as const, position: pos(200), config: { query: "workflow" } },
      { id: "c", name: "C", type: "knowledge" as const, position: pos(300), config: { query: "graph" } },
      { id: "d", name: "D", type: "directory" as const, position: pos(400), config: { source: "tools" } },
      output,
    ];
    const edges = nodes.slice(1).map((node, index) => ({ id: `e${index}`, source: nodes[index]!.id, target: node.id }));
    const source = graph(nodes, edges);

    const rejected = await optimizeWorkflowGraph(source, {
      mode: "jev",
      evaluator: async (_state, candidates) => ({ provider: "jev", probabilities: Object.fromEntries(candidates.map((candidate) => [candidate.id, 0.2])) }),
    });
    expect(rejected.preview.provider).toBe("jev");
    expect(rejected.preview.selectedCandidateIds).toEqual([]);
    expect(rejected.preview.shadow?.agreement).toBe(0);
    expect(rejected.preview.shadow?.disagreements).toEqual(["presentation:1"]);

    const fallback = await optimizeWorkflowGraph(source, {
      mode: "jev",
      evaluator: async () => { throw new Error("upstream unavailable"); },
    });
    expect(fallback.preview.provider).toBe("fallback");
    expect(fallback.preview.fallbackReason).toContain("upstream unavailable");
    expect(fallback.preview.selectedCandidateIds.length).toBeGreaterThan(0);
  });
});
