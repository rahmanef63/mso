import type { WorkflowGraphSummary } from "./workflows-api.ts";
import {
  isTriggerNodeType,
  sourceHandlesOf,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowNodeType,
  type WorkflowRunNodeState,
} from "./workflow-types.ts";

export type PreviewNode = { id: string; label: string; col: number; x: number; y: number; w: number; h: number };
export type PreviewEdge = { id: string; from: string; to: string; d: string };
export type WorkflowPreviewLayout = {
  width: number;
  height: number;
  nodes: PreviewNode[];
  edges: PreviewEdge[];
  overflowNodes: number;
  strokeToken: string;
  fillToken: string;
  tone: "ok" | "warn" | "muted";
};

export const STUDIO_NODE_W = 186;
export const STUDIO_NODE_H = 72;
export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 2.0;

const PREVIEW_MAX_NODES = 8;
const PREVIEW_NODE_W = 104;
const PREVIEW_NODE_H = 38;
const PREVIEW_COL_GAP = 140;
const PREVIEW_PAD_X = 20;

export function statusTokens(status: WorkflowGraphSummary["status"]) {
  if (status === "active") return { strokeToken: "var(--ok)", fillToken: "var(--ok-bg)", tone: "ok" as const };
  if (status === "draft") return { strokeToken: "var(--warn)", fillToken: "var(--warn-bg)", tone: "warn" as const };
  return { strokeToken: "var(--muted)", fillToken: "var(--surface)", tone: "muted" as const };
}

export function runStateStroke(runState: WorkflowRunNodeState | undefined, fallback: string): string {
  if (runState === "completed") return "var(--ok)";
  if (runState === "running") return "var(--accent)";
  if (runState === "failed") return "var(--danger)";
  if (runState === "skipped" || runState === "blocked") return "var(--muted)";
  return fallback;
}

export function bezierEdgePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.abs(x2 - x1);
  const spread = Math.max(44, Math.min(180, dx * 0.48));
  const c1x = Math.round(x1 + spread);
  const c2x = Math.round(x2 - spread);
  return `M ${Math.round(x1)} ${Math.round(y1)} C ${c1x} ${Math.round(y1)}, ${c2x} ${Math.round(y2)}, ${Math.round(x2)} ${Math.round(y2)}`;
}

export function inputPortPos(node: WorkflowNode): { x: number; y: number } {
  return { x: node.position.x, y: node.position.y + STUDIO_NODE_H / 2 };
}

export function outputPortPos(node: WorkflowNode, handle?: string): { x: number; y: number } {
  const handles = sourceHandlesOf(node);
  const count = Math.max(1, handles.length);
  const idx = handle ? Math.max(0, handles.indexOf(handle)) : 0;
  const ratio = count === 1 ? 0.5 : (idx + 1) / (count + 1);
  return { x: node.position.x + STUDIO_NODE_W, y: node.position.y + STUDIO_NODE_H * ratio };
}

export function computeLayoutPreview(
  graph: Pick<WorkflowGraphSummary, "name" | "status" | "nodeCount" | "edgeCount">,
): WorkflowPreviewLayout {
  const tokens = statusTokens(graph.status);
  const totalNodes = Math.max(0, Math.floor(graph.nodeCount));
  const totalEdges = Math.max(0, Math.floor(graph.edgeCount));
  const visible = Math.min(totalNodes, PREVIEW_MAX_NODES);
  const overflowNodes = Math.max(0, totalNodes - PREVIEW_MAX_NODES);
  if (visible === 0) return { width: 360, height: 120, nodes: [], edges: [], overflowNodes: 0, ...tokens };

  const nodes: PreviewNode[] = [];
  let height = 126;
  let totalCols = visible;
  if (visible <= 4) {
    for (let i = 0; i < visible; i++) {
      const label = visible === 1 ? "Step 1" : i === 0 ? "Trigger" : i === visible - 1 ? "Output" : `Step ${i + 1}`;
      nodes.push({ id: `n-${i}`, label, col: i, x: PREVIEW_PAD_X + i * PREVIEW_COL_GAP, y: 44, w: PREVIEW_NODE_W, h: PREVIEW_NODE_H });
    }
  } else {
    height = 176;
    const midCount = visible - 2;
    const midCols = Math.ceil(midCount / 2);
    totalCols = midCols + 2;
    nodes.push({ id: "n-0", label: "Trigger", col: 0, x: PREVIEW_PAD_X, y: 69, w: PREVIEW_NODE_W, h: PREVIEW_NODE_H });
    for (let k = 0; k < midCount; k++) {
      const col = 1 + Math.floor(k / 2);
      const solo = k % 2 === 0 && k === midCount - 1;
      const y = solo ? 69 : k % 2 === 0 ? 24 : 114;
      nodes.push({ id: `n-${k + 1}`, label: `Step ${k + 2}`, col, x: PREVIEW_PAD_X + col * PREVIEW_COL_GAP, y, w: PREVIEW_NODE_W, h: PREVIEW_NODE_H });
    }
    const lastX = PREVIEW_PAD_X + (totalCols - 1) * PREVIEW_COL_GAP;
    nodes.push({ id: `n-${visible - 1}`, label: "Output", col: totalCols - 1, x: lastX, y: 69, w: PREVIEW_NODE_W, h: PREVIEW_NODE_H });
  }

  const candidates: Array<[number, number]> = [];
  const seen = new Set<string>();
  const pushPair = (a: number, b: number) => {
    const key = `${a}->${b}`;
    if (a === b || seen.has(key)) return;
    seen.add(key);
    candidates.push([a, b]);
  };
  for (let c = 0; c < totalCols - 1; c++) {
    const left = nodes.map((n, i) => ({ n, i })).filter((x) => x.n.col === c);
    const right = nodes.map((n, i) => ({ n, i })).filter((x) => x.n.col === c + 1);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      const a = left[Math.min(i, left.length - 1)];
      const b = right[Math.min(i, right.length - 1)];
      if (a && b) pushPair(a.i, b.i);
    }
    for (const a of left) for (const b of right) pushPair(a.i, b.i);
  }
  const edges: PreviewEdge[] = candidates.slice(0, totalEdges).map(([aIdx, bIdx], idx) => {
    const a = nodes[aIdx]!;
    const b = nodes[bIdx]!;
    const d = bezierEdgePath(a.x + a.w, a.y + a.h / 2, b.x - 4, b.y + b.h / 2);
    return { id: `e-${idx}`, from: a.id, to: b.id, d };
  });
  const width = Math.max(320, PREVIEW_PAD_X * 2 + (totalCols - 1) * PREVIEW_COL_GAP + PREVIEW_NODE_W);
  return { width, height, nodes, edges, overflowNodes, ...tokens };
}

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
