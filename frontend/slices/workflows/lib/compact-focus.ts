import type { WorkflowGraphNode } from "@/lib/contracts/workflow-graph";
import type { GraphCustomNode } from "@/lib/contracts/graph-custom-nodes";

const triggerTypes = new Set(["manual", "schedule", "webhook"]);

/** Compact panes should anchor on workflow entry points, even when a trigger is inside a collapsed group. */
export function compactWorkflowFocusIds(
  nodes: WorkflowGraphNode[],
  groups: GraphCustomNode[],
  visibleIds: Set<string>,
  limit: number,
): string[] {
  const owner = new Map<string, string>();
  for (const group of groups) if (group.collapsed) for (const nodeId of group.nodeIds) owner.set(nodeId, group.id);
  const triggers = nodes
    .filter((node) => triggerTypes.has(node.type) || node.config.sessionRoot === true)
    .map((node) => owner.get(node.id) ?? node.id);
  const unique = [...new Set(triggers)].filter((id) => visibleIds.has(id));
  return unique.slice(0, Math.max(1, limit));
}
