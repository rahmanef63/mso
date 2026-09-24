import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowGraph } from "@/lib/contracts/workflow-graph";

const f = vi.hoisted(() => ({
  get: vi.fn(),
  create: vi.fn(),
  optimize: vi.fn(),
}));

vi.mock("@/lib/workflow/graph-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workflow/graph-store")>();
  return { ...actual, getWorkflowGraph: f.get, createWorkflowGraph: f.create };
});
vi.mock("@/lib/workflow/graph-optimizer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workflow/graph-optimizer")>();
  return { ...actual, optimizeWorkflowGraph: f.optimize };
});
vi.mock("./tools", () => ({ TOOLS_BY_NAME: new Map() }));

const { FLOW_TOOLS } = await import("./tools-flows");
const tool = FLOW_TOOLS.find((row) => row.name === "workflow_graph")!;

const graph: WorkflowGraph = {
  version: 2,
  id: "graph-1",
  name: "Source",
  description: "",
  status: "draft",
  inputs: {},
  nodes: [{ id: "manual", name: "Manual", type: "manual", position: { x: 0, y: 0 }, config: {} }],
  edges: [],
  metadata: {},
  createdAt: "2026-09-24T00:00:00.000Z",
  updatedAt: "2026-09-24T00:00:00.000Z",
  revision: "rev-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  f.get.mockResolvedValue(graph);
  f.optimize.mockResolvedValue({
    preview: {
      version: 1,
      source: { id: graph.id, revision: graph.revision, name: graph.name, nodeCount: 1, edgeCount: 0 },
      mode: "deterministic",
      provider: "deterministic",
      threshold: 0.72,
      candidates: [{ id: "presentation:1", kind: "presentation-group", title: "Group", description: "safe", nodeIds: ["manual"], risk: "safe", estimatedNodeDelta: 0, hostEligible: true, probability: 0.96, selected: true }],
      selectedCandidateIds: ["presentation:1"],
      reviewCandidateIds: [],
      summary: { candidateCount: 1, selectedCount: 1, reviewCount: 0, beforeNodes: 1, afterNodes: 1, beforeEdges: 0, afterEdges: 0, visualGroupsAdded: 1, nodeReduction: 0, edgeReduction: 0 },
    },
    definition: { name: graph.name, description: graph.description, status: graph.status, inputs: {}, nodes: graph.nodes, edges: [], metadata: {} },
  });
  f.create.mockImplementation(async (_principal, definition) => ({ ...graph, ...definition, id: "clone-1", revision: "rev-2" }));
});

describe("workflow_graph optimizer actions", () => {
  it("previews without creating or updating a graph", async () => {
    const result = await tool.run({ action: "optimize_preview", id: graph.id }, { actor: "test", scope: "exec" });
    expect(result).toMatchObject({ optimization: { source: { id: graph.id }, summary: { selectedCount: 1 } } });
    expect(f.create).not.toHaveBeenCalled();
  });

  it("creates a new draft from the exact source revision", async () => {
    const result = await tool.run({ action: "optimize_clone", id: graph.id, data: { revision: "rev-1" } }, { actor: "test", scope: "exec" });
    expect(result).toMatchObject({ graph: { id: "clone-1", status: "draft" }, optimization: { summary: { selectedCount: 1 } } });
    expect(f.create).toHaveBeenCalledTimes(1);
    const definition = f.create.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(definition.name).toBe("Source · Optimized");
    expect(definition.metadata).toMatchObject({ provenance: "ai-assisted", tags: ["optimized", "deterministic"] });
  });

  it("refuses a stale source revision", async () => {
    await expect(tool.run({ action: "optimize_clone", id: graph.id, data: { revision: "stale" } }, { actor: "test", scope: "exec" }))
      .rejects.toThrow("revision changed");
    expect(f.optimize).not.toHaveBeenCalled();
  });
});
