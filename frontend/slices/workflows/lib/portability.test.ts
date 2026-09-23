import { describe, expect, it } from "vitest";
import type { WorkflowGraph } from "@/lib/contracts/workflow-graph";
import { buildWorkflowPackage, parseWorkflowPackage, workflowPackageFilename } from "./portability";

const graph: WorkflowGraph = {
  version: 2,
  id: "graph-id",
  revision: "revision",
  createdAt: "2026-09-22T00:00:00.000Z",
  updatedAt: "2026-09-22T00:00:00.000Z",
  name: "Deploy & Verify",
  description: "portable",
  status: "draft",
  inputs: {},
  metadata: { provenance: "user", tags: ["qa"] },
  nodes: [{ id: "manual", name: "Manual", type: "manual", position: { x: 0, y: 0 }, config: {} }],
  edges: [],
};

describe("workflow portability", () => {
  it("exports a runtime-id-free package and imports the definition", () => {
    const pkg = buildWorkflowPackage(graph);
    expect(pkg.graph).not.toHaveProperty("id");
    expect(pkg.graph).not.toHaveProperty("revision");
    expect(parseWorkflowPackage(JSON.stringify(pkg))).toMatchObject({ name: graph.name, nodes: graph.nodes, metadata: graph.metadata });
  });

  it("accepts a full graph export but drops runtime identity fields", () => {
    const imported = parseWorkflowPackage(JSON.stringify(graph));
    expect(imported.name).toBe(graph.name);
    expect(imported).not.toHaveProperty("id");
    expect(imported).not.toHaveProperty("createdAt");
  });

  it("creates a bounded portable filename and rejects invalid payloads", () => {
    expect(workflowPackageFilename(graph.name)).toBe("deploy-verify.mso-workflow.json");
    expect(() => parseWorkflowPackage("{}")).toThrow("required graph fields");
    expect(() => parseWorkflowPackage("{")).toThrow("valid JSON");
  });
});
