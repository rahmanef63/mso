import { describe, expect, it } from "vitest";
import type { WorkflowGraph } from "@/lib/contracts/workflow-graph";
import { workflowMatchesQuery, workflowTagQuery } from "./search";

const graph: WorkflowGraph = {
  version: 2,
  id: "graph-1",
  name: "Deploy QA Daily",
  description: "Build and deploy the storefront after validation.",
  status: "active",
  inputs: {},
  metadata: { folder: "Automation / Release", project: "mso", tags: ["qa", "daily deploy"] },
  nodes: [
    { id: "manual", name: "Manual Trigger", type: "manual", position: { x: 0, y: 0 }, config: {} },
    { id: "script", name: "Health Script", type: "script", position: { x: 100, y: 0 }, config: { script_id: "script-health", token: "must-not-index" } },
    { id: "tool", name: "Run System Stats", type: "tool", position: { x: 200, y: 0 }, config: { tool: "sys_stats" } },
  ],
  edges: [],
  createdAt: "2026-09-16T00:00:00.000Z",
  updatedAt: "2026-09-16T00:00:00.000Z",
  revision: "r1",
};

describe("workflow search", () => {
  it("matches case-insensitive free text across workflow and node metadata", () => {
    expect(workflowMatchesQuery(graph, "storefront health")).toBe(true);
    expect(workflowMatchesQuery(graph, "SYS_STATS")).toBe(true);
    expect(workflowMatchesQuery(graph, "missing")).toBe(false);
  });

  it("supports structured operators with AND semantics", () => {
    expect(workflowMatchesQuery(graph, "deploy tag:qa status:active project:mso folder:release node:script")).toBe(true);
    expect(workflowMatchesQuery(graph, "deploy tag:qa status:draft")).toBe(false);
    expect(workflowMatchesQuery(graph, "tag:ops")).toBe(false);
  });

  it("supports quoted tag values", () => {
    const query = workflowTagQuery("daily deploy");
    expect(query).toBe('tag:"daily deploy"');
    expect(workflowMatchesQuery(graph, query)).toBe(true);
  });

  it("applies explicit filters", () => {
    expect(workflowMatchesQuery(graph, "", { tag: "qa", status: "active", project: "ms", folder: "automation", node: "system stats" })).toBe(true);
    expect(workflowMatchesQuery(graph, "", { status: "archived" })).toBe(false);
  });

  it("does not index secret-like node config keys", () => {
    expect(workflowMatchesQuery(graph, "must-not-index")).toBe(false);
  });
});
