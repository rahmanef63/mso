import type { GraphCustomNode } from "@/lib/contracts/graph-custom-nodes";
import type { OrganizationFlowEdge, OrganizationFlowNode } from "@/lib/contracts/organization-flow";

export function organizationProjectFlowVisibleIds({
  nodes, edges, groups, query, focusNodeId, focusGroupId,
}: {
  nodes: OrganizationFlowNode[];
  edges: OrganizationFlowEdge[];
  groups: GraphCustomNode[];
  query: string;
  focusNodeId?: string | null;
  focusGroupId?: string | null;
}): Set<string> {
  const text = query.trim().toLowerCase();
  const focusedGroup = focusGroupId ? groups.find((group) => group.id === focusGroupId) : undefined;
  const focusSeeds = focusedGroup?.nodeIds.length ? focusedGroup.nodeIds : focusNodeId ? [focusNodeId] : [];
  if (!text && !focusSeeds.length) return new Set(nodes.map((node) => node.id));

  const seeds = new Set<string>(focusSeeds);
  if (text) {
    for (const node of nodes) {
      if (`${node.title} ${node.summary} ${node.kind} ${node.status}`.toLowerCase().includes(text)) seeds.add(node.id);
    }
    for (const group of groups) {
      if (group.name.toLowerCase().includes(text)) for (const id of group.nodeIds) seeds.add(id);
    }
  }

  const visible = new Set(seeds);
  for (const edge of edges) {
    if (seeds.has(edge.source) || seeds.has(edge.target)) {
      visible.add(edge.source);
      visible.add(edge.target);
    }
  }
  return visible;
}
