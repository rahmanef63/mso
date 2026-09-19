import { createHash } from "node:crypto";
import type { WorkflowGraph } from "@/lib/contracts/workflow-graph";
import type { OrganizationProjectFlow } from "@/lib/contracts/organization-flow";
import { redactMemoryContext } from "./memory-context.mjs";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
function text(value: unknown, max = 160): string {
  return redactMemoryContext(String(value ?? "")).replace(/[\r\n]+/g, " ").trim().slice(0, max);
}
function testMemoryEnabled(): boolean {
  return process.env.NODE_ENV !== "test" || Boolean(process.env.OS_AGENT_MEMORY_DIR);
}

export async function rememberWorkflowGraphSave(
  principal: string,
  graph: WorkflowGraph,
  reason: "create" | "update" | "restore" | "import" | "template" | "ai-assisted",
): Promise<boolean> {
  if (!principal || !testMemoryEnabled()) return false;
  const value = [
    "Event: workflow_save",
    `Workflow: ${text(graph.name, 180)}`,
    `Graph ID: ${text(graph.id, 96)}`,
    `Status: ${text(graph.status, 32)}`,
    `Reason: ${reason}`,
    `Nodes: ${graph.nodes.length}`,
    `Edges: ${graph.edges.length}`,
    `Revision: ${graph.revision.slice(0, 16)}`,
    `Updated: ${graph.updatedAt}`,
  ].join("\n");
  const { rememberAgentMemory } = await import("./memory-store");
  await rememberAgentMemory(principal, "MEMORY.md", `workflow-save:${digest(graph.id)}`, value, {
    kind: "episodic", sensitivity: "private", confidence: 1,
    provenance: { authority: "observed", channel: "system" },
  });
  return true;
}

export type OrganizationNodeMemory = {
  unitId: string;
  node: OrganizationProjectFlow["nodes"][number];
  chartRevision: string;
  change: "created" | "updated";
};

export async function rememberOrganizationNodeUpdate(principal: string, input: OrganizationNodeMemory): Promise<boolean> {
  if (!principal || !testMemoryEnabled()) return false;
  const node = input.node;
  const value = [
    "Event: organization_node_update",
    `Unit ID: ${text(input.unitId, 96)}`,
    `Node ID: ${text(node.id, 96)}`,
    `Title: ${text(node.title, 180)}`,
    `Kind: ${text(node.kind, 32)}`,
    `Status: ${text(node.status, 32)}`,
    ...(node.projectRef ? [`Project ref: ${text(node.projectRef, 160)}`] : []),
    `Change: ${input.change}`,
    `Chart revision: ${input.chartRevision.slice(0, 16)}`,
  ].join("\n");
  const { rememberAgentMemory } = await import("./memory-store");
  await rememberAgentMemory(principal, "MEMORY.md", `organization-node:${digest(`${input.unitId}:${node.id}`)}`, value, {
    kind: "episodic", sensitivity: "private", confidence: 1,
    provenance: { authority: "observed", channel: "system" },
  });
  return true;
}
