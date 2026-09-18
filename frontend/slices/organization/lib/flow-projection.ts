import { applyNodeChanges, type Node, type NodeChange } from "@xyflow/react";
import type { OrganizationFlowNode } from "@/lib/contracts/organization-flow";

export type ProjectCanvasNode = Node<{ item: OrganizationFlowNode }, "project">;
export type FlowProjection = { source?: OrganizationFlowNode[]; nodes: ProjectCanvasNode[] };

/** API positions are authoritative; measured dimensions belong only to the canvas. */
export function projectCanvasNodes(source: OrganizationFlowNode[], projection: FlowProjection): ProjectCanvasNode[] {
  if (projection.source === source) return projection.nodes;
  const previous = new Map(projection.nodes.map((node) => [node.id, node]));
  return source.map((item) => ({
    id: item.id, type: "project", position: item.position, data: { item },
    measured: previous.get(item.id)?.measured,
  }));
}

/** Retain dimension changes as well as drags, so React Flow can resolve edge handles. */
export function updateFlowProjection(source: OrganizationFlowNode[], previous: FlowProjection, changes: NodeChange<ProjectCanvasNode>[]): FlowProjection {
  return { source, nodes: applyNodeChanges(changes, projectCanvasNodes(source, previous)) };
}
