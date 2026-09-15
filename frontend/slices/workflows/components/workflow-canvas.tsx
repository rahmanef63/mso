"use client";

import { useMemo, useRef } from "react";
import type { WorkflowGraph, WorkflowGraphNode, WorkflowGraphNodeState } from "@/lib/contracts/workflow-graph";
import { cn } from "@/lib/utils";

const W = 184, H = 76;

export function WorkflowCanvas({ graph, selectedId, onSelect, onMove, nodeStates, onOpen }: {
  graph: WorkflowGraph;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, position: { x: number; y: number }) => void;
  nodeStates?: ReadonlyMap<string, WorkflowGraphNodeState>;
  onOpen?: (id: string) => void;
}) {
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const nodes = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const down = (event: React.PointerEvent, node: WorkflowGraphNode) => {
    const box = event.currentTarget.getBoundingClientRect();
    drag.current = { id: node.id, dx: event.clientX - box.left, dy: event.clientY - box.top };
    event.currentTarget.setPointerCapture(event.pointerId); onSelect(node.id);
  };
  const move = (event: React.PointerEvent) => {
    if (!drag.current) return;
    const canvas = event.currentTarget.getBoundingClientRect();
    onMove(drag.current.id, { x: Math.max(12, event.clientX - canvas.left - drag.current.dx), y: Math.max(12, event.clientY - canvas.top - drag.current.dy) });
  };
  return (
    <div className="relative h-full min-h-[520px] min-w-[880px] overflow-auto bg-muted/20" onPointerMove={move} onPointerUp={() => { drag.current = null; }} onClick={(event) => { if (event.target === event.currentTarget) onSelect(null); }}>
      <svg className="pointer-events-none absolute inset-0 h-[1400px] w-[2200px]" aria-hidden>
        {graph.edges.map((edge) => {
          const a = nodes.get(edge.source), b = nodes.get(edge.target); if (!a || !b) return null;
          const x1 = a.position.x + W, y1 = a.position.y + H / 2, x2 = b.position.x, y2 = b.position.y + H / 2, c = Math.max(60, Math.abs(x2 - x1) / 2);
          return <path key={edge.id} d={`M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-border" />;
        })}
      </svg>
      <div className="relative h-[1400px] w-[2200px]">
        {graph.nodes.map((node) => (
          <button key={node.id} type="button" onPointerDown={(event) => down(event, node)} onClick={(event) => { event.stopPropagation(); onSelect(node.id); }}
            onDoubleClick={() => { if ((node.type === "project" || node.type === "folder") && onOpen) onOpen(node.id); }}
            className={cn("absolute flex h-[76px] w-[184px] cursor-grab flex-col items-start justify-center rounded-xl border bg-card px-3 text-left shadow-sm active:cursor-grabbing", selectedId === node.id && "ring-2 ring-ring", nodeStates?.get(node.id) === "failed" && "border-destructive ring-1 ring-destructive", nodeStates?.get(node.id) === "running" && "border-primary ring-1 ring-primary", ["skipped", "blocked"].includes(nodeStates?.get(node.id) ?? "") && "opacity-55", node.disabled && "opacity-50")}
            style={{ transform: `translate(${node.position.x}px, ${node.position.y}px)` }}>
            <span className="w-full truncate text-xs font-semibold">{node.name}</span>
            <span className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{node.type.replaceAll("_", " ")}{nodeStates?.get(node.id) ? ` · ${nodeStates.get(node.id)}` : ""}</span>
            {node.type === "condition" && <span className="mt-1 text-[10px] text-muted-foreground">true / false</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
