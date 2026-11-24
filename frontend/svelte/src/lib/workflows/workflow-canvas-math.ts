import type { WorkflowGraphSummary } from "./workflows-api.ts";
import {
  isTriggerNodeType,
  sourceHandlesOf,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowNodeType,
  type WorkflowRunNodeState,
} from "./workflow-types.ts";

import { computeLayoutPreview } from "./workflow-preview-geometry.ts";

export { STUDIO_NODE_H, STUDIO_NODE_W, MIN_ZOOM, MAX_ZOOM } from "./workflow-canvas-consts.ts";
import { MAX_ZOOM, MIN_ZOOM, STUDIO_NODE_H, STUDIO_NODE_W } from "./workflow-canvas-consts.ts";
export { statusTokens } from "./workflow-preview-geometry.ts";
export { computeLayoutPreview } from "./workflow-preview-geometry.ts";
export type { PreviewEdge, PreviewLayoutBase, PreviewNode, WorkflowPreviewLayout } from "./workflow-preview-geometry.ts";
export { bezierEdgePath, inputPortPos, outputPortPos, runStateStroke } from "./workflow-geometry.ts";
import { bezierEdgePath } from "./workflow-geometry.ts";

export function clampZoom(zoom: number): number {
  return Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) * 100) / 100;
}

export function computeFitViewport(
  nodes: readonly WorkflowNode[],
  viewW: number,
  viewH: number,
): { panX: number; panY: number; zoom: number } {
  if (nodes.length === 0) return { panX: 0, panY: 0, zoom: 1 };
  const pad = 44;
  const minX = Math.min(...nodes.map((n) => n.position.x));
  const minY = Math.min(...nodes.map((n) => n.position.y));
  const maxX = Math.max(...nodes.map((n) => n.position.x + STUDIO_NODE_W));
  const maxY = Math.max(...nodes.map((n) => n.position.y + STUDIO_NODE_H));
  const contentW = Math.max(1, maxX - minX + pad * 2);
  const contentH = Math.max(1, maxY - minY + pad * 2);
  const zoom = clampZoom(Math.min(1.15, viewW / contentW, viewH / contentH));
  const panX = Math.round((viewW - (maxX - minX) * zoom) / 2 - minX * zoom);
  const panY = Math.round((viewH - (maxY - minY) * zoom) / 2 - minY * zoom);
  return { panX, panY, zoom };
}

export function wouldCreateCycle(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  source: string,
  target: string,
): boolean {
  if (source === target) return true;
  const adj = new Map<string, string[]>();
  for (const node of nodes) adj.set(node.id, []);
  for (const edge of edges) {
    if (!edge.disabled) adj.get(edge.source)?.push(edge.target);
  }
  adj.get(source)?.push(target);
  const visited = new Set<string>();
  const stack = [target];
  while (stack.length > 0) {
    const curr = stack.pop()!;
    if (curr === source) return true;
    if (visited.has(curr)) continue;
    visited.add(curr);
    for (const next of adj.get(curr) ?? []) stack.push(next);
  }
  return false;
}

export function tidyGraphNodes(nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[]): WorkflowNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const indegree = new Map(nodes.map((n) => [n.id, 0]));
  for (const edge of edges) {
    if (!edge.disabled && byId.has(edge.source) && byId.has(edge.target)) {
      indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    }
  }
  const layer = new Map<string, number>();
  const queue = nodes
    .filter((n) => (indegree.get(n.id) ?? 0) === 0)
    .sort((a, b) => a.position.y - b.position.y || a.name.localeCompare(b.name));
  for (const n of queue) layer.set(n.id, 0);
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i]!;
    const depth = layer.get(cur.id) ?? 0;
    for (const edge of edges) {
      if (edge.disabled || edge.source !== cur.id || !byId.has(edge.target)) continue;
      layer.set(edge.target, Math.max(layer.get(edge.target) ?? 0, depth + 1));
      const rem = (indegree.get(edge.target) ?? 1) - 1;
      indegree.set(edge.target, rem);
      if (rem === 0) queue.push(byId.get(edge.target)!);
    }
  }
  const fallback = Math.max(0, ...layer.values()) + 1;
  for (const n of nodes) if (!layer.has(n.id)) layer.set(n.id, fallback);
  const cols = new Map<number, WorkflowNode[]>();
  for (const n of nodes) {
    const col = layer.get(n.id)!;
    cols.set(col, [...(cols.get(col) ?? []), n]);
  }
  for (const group of cols.values()) group.sort((a, b) => a.position.y - b.position.y || a.name.localeCompare(b.name));
  return nodes.map((n) => {
    const col = layer.get(n.id)!;
    const group = cols.get(col)!;
    const idx = group.findIndex((item) => item.id === n.id);
    return { ...n, position: { x: 48 + col * 246, y: 48 + idx * 116 } };
  });
}

export function synthesizeStudioGraph(
  summary: Pick<WorkflowGraphSummary, "name" | "status" | "nodeCount" | "edgeCount">,
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const preview = computeLayoutPreview(summary);
  const nodes: WorkflowNode[] = preview.nodes.map((p, idx) => {
    const type: WorkflowNodeType =
      idx === 0 ? "manual" : idx === preview.nodes.length - 1 ? "output" : "tool";
    return {
      id: p.id,
      name: p.label,
      type,
      position: { x: 48 + p.col * 246, y: Math.max(48, Math.round(p.y * 1.6)) },
      config: {},
    };
  });
  const edges: WorkflowEdge[] = preview.edges.map((e) => ({ id: e.id, source: e.from, target: e.to }));
  return { nodes, edges };
}

export function canAcceptInput(node: WorkflowNode): boolean {
  return !isTriggerNodeType(node.type);
}
