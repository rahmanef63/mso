import type { WorkflowGraphSummary } from "./workflows-api.ts";
import { bezierEdgePath } from "./workflow-geometry.ts";

import { isTriggerNodeType, sourceHandlesOf, type WorkflowEdge, type WorkflowNode } from "./workflow-types.ts";
export type PreviewNode = { id: string; label: string; col: number; x: number; y: number; w: number; h: number };
export type PreviewEdge = { id: string; from: string; to: string; d: string };
export type PreviewLayoutBase = { nodes: PreviewNode[]; edges: PreviewEdge[]; width: number; height: number };
export type WorkflowPreviewLayout = PreviewLayoutBase & { overflowNodes: number };

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
