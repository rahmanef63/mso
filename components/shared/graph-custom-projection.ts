import type { Edge, Node } from "@xyflow/react";
import type { GraphCustomNode } from "@/lib/contracts/graph-custom-nodes";

export type CustomNodeData = Record<string, unknown> & { group: GraphCustomNode; ports: { id: string; label: string; side: "in" | "out" }[] };
export type CustomCanvasNode = Node<CustomNodeData, "customGroup">;

/** Render proxies only. Stored nodes, handles, edges and configuration are never rewritten. */
export function projectCustomNodes<N extends Node, E extends Edge>(nodes: N[], edges: E[], groups: GraphCustomNode[], selected: string[]) {
  const collapsed = groups.filter((group) => group.collapsed && group.nodeIds.some((id) => nodes.some((node) => node.id === id)));
  const owner = new Map(collapsed.flatMap((group) => group.nodeIds.map((id) => [id, group.id] as const)));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const proxies: CustomCanvasNode[] = collapsed.map((group) => {
    const members = group.nodeIds.map((id) => nodeById.get(id)).filter((node): node is N => !!node);
    const ports = edges.flatMap<CustomNodeData["ports"][number]>((edge) => {
      if (owner.get(edge.source) === group.id && owner.get(edge.target) !== group.id) return [{ id: `out-${edge.id}`, label: String(edge.sourceHandle ?? edge.source), side: "out" as const }];
      if (owner.get(edge.target) === group.id && owner.get(edge.source) !== group.id) return [{ id: `in-${edge.id}`, label: String(edge.targetHandle ?? edge.target), side: "in" as const }];
      return [];
    });
    return { id: group.id, type: "customGroup", position: { x: Math.min(...members.map((node) => node.position.x)), y: Math.min(...members.map((node) => node.position.y)) }, width: 240, height: Math.max(104, 48 + Math.max(ports.filter((port) => port.side === "in").length, ports.filter((port) => port.side === "out").length) * 18), selected: selected.includes(group.id), data: { group, ports }, connectable: false, deletable: false };
  });
  const projectedEdges = edges.filter((edge) => !owner.has(edge.source) || owner.get(edge.source) !== owner.get(edge.target)).map((edge) => ({
    ...edge, source: owner.get(edge.source) ?? edge.source, target: owner.get(edge.target) ?? edge.target,
    ...(owner.has(edge.source) ? { sourceHandle: `out-${edge.id}` } : {}), ...(owner.has(edge.target) ? { targetHandle: `in-${edge.id}` } : {}),
  }));
  return { nodes: [...nodes.filter((node) => !owner.has(node.id)).map((node) => ({ ...node, selected: selected.includes(node.id) })), ...proxies] as (N | CustomCanvasNode)[], edges: projectedEdges };
}

export function moveCustomNode<T extends { id: string; position: { x: number; y: number } }>(nodes: T[], group: GraphCustomNode, position: { x: number; y: number }): T[] {
  const members = nodes.filter((node) => group.nodeIds.includes(node.id));
  if (!members.length) return nodes;
  const dx = position.x - Math.min(...members.map((node) => node.position.x)), dy = position.y - Math.min(...members.map((node) => node.position.y));
  return nodes.map((node) => group.nodeIds.includes(node.id) ? { ...node, position: { x: node.position.x + dx, y: node.position.y + dy } } : node);
}


export function moveGraphNodesWithCustomGroups<T extends { id: string; position: { x: number; y: number } }>(
  nodes: T[],
  groups: GraphCustomNode[],
  movedItems: Array<{ id: string; position: { x: number; y: number } }>,
): T[] {
  let next = nodes;
  for (const item of movedItems) {
    const group = groups.find((candidate) => candidate.id === item.id);
    next = group
      ? moveCustomNode(next, group, item.position)
      : next.map((node) => node.id === item.id ? { ...node, position: item.position } : node);
  }
  return next;
}
