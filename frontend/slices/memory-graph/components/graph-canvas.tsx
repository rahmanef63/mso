"use client";

import { useMemo, useRef, useState } from "react";
import type { MemoryGraphEdge, MemoryGraphNode } from "@/lib/memory-graph/types";
import { groupColor, placeNodes, type GraphLayoutName } from "../lib/layout";

export function GraphCanvas({
  nodes, edges, layout, selected, onSelect, onOpen,
}: {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  layout: GraphLayoutName;
  selected: string | null;
  onSelect: (id: string) => void;
  onOpen: (node: MemoryGraphNode) => void;
}) {
  const points = useMemo(() => placeNodes(nodes, edges, layout), [nodes, edges, layout]);
  const groups = useMemo(() => [...new Set(nodes.map((node) => node.group))], [nodes]);
  const bounds = useMemo(() => {
    const values = [...points.values()];
    if (!values.length) return { x: 0, y: 0, w: 200, h: 200 };
    const xs = values.map((point) => point.x), ys = values.map((point) => point.y);
    const minX = Math.min(...xs) - 80, minY = Math.min(...ys) - 60;
    return { x: minX, y: minY, w: Math.max(...xs) - minX + 160, h: Math.max(...ys) - minY + 140 };
  }, [points]);
  return (
    <GraphStage key={`${layout}:${nodes.map((node) => node.id).join("\n")}`} bounds={bounds} points={points} groups={groups} nodes={nodes} edges={edges} selected={selected} onSelect={onSelect} onOpen={onOpen} />
  );
}

function GraphStage({
  bounds, points, groups, nodes, edges, selected, onSelect, onOpen,
}: {
  bounds: { x: number; y: number; w: number; h: number };
  points: Map<string, { x: number; y: number }>;
  groups: string[];
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  selected: string | null;
  onSelect: (id: string) => void;
  onOpen: (node: MemoryGraphNode) => void;
}) {
  const [view, setView] = useState(bounds);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  return (
    <svg
      className="h-full w-full touch-none bg-background"
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      role="application"
      aria-label="Memory graph"
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return;
        drag.current = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const scale = view.w / Math.max(rect.width, 1);
        setView((current) => ({ ...current, x: drag.current!.vx - (event.clientX - drag.current!.x) * scale, y: drag.current!.vy - (event.clientY - drag.current!.y) * scale }));
      }}
      onPointerUp={() => { drag.current = null; }}
      onWheel={(event) => {
        event.preventDefault();
        const factor = event.deltaY > 0 ? 1.08 : 0.92;
        setView((current) => ({ ...current, w: current.w * factor, h: current.h * factor }));
      }}
    >
      {edges.map((edge) => {
        const source = points.get(edge.source), target = points.get(edge.target);
        if (!source || !target) return null;
        return <line key={`${edge.kind}:${edge.source}:${edge.target}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke="var(--muted-foreground)" strokeOpacity={edge.resolved ? 0.55 : 0.35} strokeDasharray={edge.resolved ? undefined : "4 3"} />;
      })}
      {nodes.map((node) => {
        const point = points.get(node.id);
        if (!point) return null;
        const radius = node.kind === "folder" ? 16 : 8 + Math.min(node.degree, 8) * 1.6;
        const fill = node.kind === "ghost" ? "var(--muted-foreground)" : groupColor(node.group, groups);
        return (
          <g key={node.id} transform={`translate(${point.x} ${point.y})`} role="button" tabIndex={0}
            aria-pressed={selected === node.id} aria-label={node.title}
            onClick={() => onSelect(node.id)}
            onDoubleClick={() => onOpen(node)}
            onKeyDown={(event) => { if (event.key === "Enter") onOpen(node); }}
          >
            {node.kind === "folder"
              ? <rect x={-radius} y={-radius} width={radius * 2} height={radius * 2} rx={4} fill={fill} stroke={selected === node.id ? "var(--accent)" : "transparent"} strokeWidth={3} />
              : <circle r={radius} fill={fill} fillOpacity={node.kind === "ghost" ? 0.35 : 0.9} stroke={selected === node.id ? "var(--accent)" : node.kind === "ghost" ? "var(--muted-foreground)" : "transparent"} strokeDasharray={node.kind === "ghost" ? "3 2" : undefined} strokeWidth={selected === node.id ? 3 : 1.5} />}
            <text y={radius + 14} textAnchor="middle" fill="var(--foreground)" fontSize={11}>{node.title.slice(0, 28)}</text>
          </g>
        );
      })}
    </svg>
  );
}
