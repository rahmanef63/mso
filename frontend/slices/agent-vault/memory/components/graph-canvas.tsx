"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
    const minX = Math.min(...xs) - 164, minY = Math.min(...ys) - 60;
    return { x: minX, y: minY, w: Math.max(...xs) - minX + 164, h: Math.max(...ys) - minY + 140 };
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
  const canvas = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = canvas.current;
    if (!svg?.parentElement || !nodes.length) return;
    const node = nodes.find(item => item.id === selected) ?? nodes.reduce((a, b) => a.degree >= b.degree ? a : b);
    const reveal = () => [...svg.querySelectorAll<SVGGElement>("[data-node-id]")].find(item => item.dataset.nodeId === node.id)?.scrollIntoView({ block: "center", inline: "center" });
    const observer = new ResizeObserver(reveal);
    observer.observe(svg.parentElement); reveal();
    return () => observer.disconnect();
  }, [nodes, selected]);
  const [view, setView] = useState(bounds);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  return (
    <div className="relative h-full min-h-0 overflow-auto bg-background" style={{ scrollPaddingTop: 44 }}>
      <div className="sticky left-0 top-0 z-10 flex w-fit gap-1 bg-background/90 p-1">
        <Button size="sm" variant="outline" aria-label="Zoom in graph" onClick={() => setView(current => ({ ...current, w: current.w * 0.8, h: current.h * 0.8 }))}>+</Button>
        <Button size="sm" variant="outline" aria-label="Zoom out graph" onClick={() => setView(current => ({ ...current, w: current.w * 1.25, h: current.h * 1.25 }))}>-</Button>
        <Button size="sm" variant="outline" onClick={() => setView(bounds)}>Reset zoom</Button>
      </div>
    <svg
      ref={canvas}
      className="block min-h-full min-w-full"
      style={{ width: bounds.w * 12 / 11, height: bounds.h * 12 / 11 }}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      role="application"
      aria-label="Memory graph"
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget || event.pointerType === "touch") return;
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
      onPointerCancel={() => { drag.current = null; }}
      onWheel={(event) => {
        if (!event.ctrlKey && !event.metaKey) return;
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
          <g key={node.id} data-node-id={node.id} transform={`translate(${point.x} ${point.y})`} role="button" tabIndex={0}
            aria-pressed={selected === node.id} aria-label={node.title}
            onFocus={(event) => event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })}
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
    </div>
  );
}
