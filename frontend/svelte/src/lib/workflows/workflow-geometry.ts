import { STUDIO_NODE_H, STUDIO_NODE_W } from "./workflow-canvas-consts.ts";
import { sourceHandlesOf, type WorkflowNode, type WorkflowRunNodeState } from "./workflow-types.ts";

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
