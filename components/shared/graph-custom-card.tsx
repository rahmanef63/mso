"use client";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { CustomCanvasNode } from "./graph-custom-projection";
import { GraphNodeShell } from "./graph-node-shell";

export function GraphCustomCard({ data, selected }: NodeProps<CustomCanvasNode>) {
  const { group, ports } = data;
  const inputs = ports.filter((port) => port.side === "in"), outputs = ports.filter((port) => port.side === "out");
  return <GraphNodeShell selected={selected} className="w-60 border-2 border-primary/50" style={{ minHeight: Math.max(104, 48 + Math.max(inputs.length, outputs.length) * 18) }}>
    <div className="truncate text-xs font-semibold">{group.name}</div>
    <div className="mt-1 text-[10px] text-muted-foreground">{group.nodeIds.length} nodes · collapsed</div>
    {inputs.map((port, index) => <Handle key={port.id} type="target" position={Position.Left} id={port.id} className="!size-3 !bg-muted-foreground" style={{ top: 48 + index * 18 }} />)}
    {outputs.map((port, index) => <Handle key={port.id} type="source" position={Position.Right} id={port.id} className="!size-3 !bg-muted-foreground" style={{ top: 48 + index * 18 }} />)}
  </GraphNodeShell>;
}
