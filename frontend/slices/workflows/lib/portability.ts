import type { WorkflowGraph } from "@/lib/contracts/workflow-graph";

export type WorkflowDefinition = Omit<WorkflowGraph, "version" | "id" | "revision" | "createdAt" | "updatedAt">;
export type WorkflowPackage = { format: "mso-workflow"; version: 1; exportedAt: string; graph: WorkflowDefinition };

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function workflowDefinition(graph: WorkflowGraph): WorkflowDefinition {
  const { version: _version, id: _id, revision: _revision, createdAt: _createdAt, updatedAt: _updatedAt, ...definition } = graph;
  return structuredClone(definition);
}

export function buildWorkflowPackage(graph: WorkflowGraph): WorkflowPackage {
  return { format: "mso-workflow", version: 1, exportedAt: new Date().toISOString(), graph: workflowDefinition(graph) };
}

export function workflowPackageFilename(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "workflow";
  return `${slug}.mso-workflow.json`;
}

export function parseWorkflowPackage(text: string): WorkflowDefinition {
  if (text.length > 2 * 1024 * 1024) throw new Error("Workflow package exceeds 2 MiB");
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("Workflow package is not valid JSON"); }
  if (!object(raw)) throw new Error("Workflow package must be an object");
  const candidate = raw.format === "mso-workflow" && raw.version === 1 ? raw.graph : raw;
  if (!object(candidate)) throw new Error("Workflow package does not contain a graph");
  const { version: _version, id: _id, revision: _revision, createdAt: _createdAt, updatedAt: _updatedAt, ...definition } = candidate;
  if (typeof definition.name !== "string" || !Array.isArray(definition.nodes) || !Array.isArray(definition.edges) || !object(definition.metadata)) {
    throw new Error("Workflow package is missing required graph fields");
  }
  return definition as WorkflowDefinition;
}
