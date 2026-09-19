"use client";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Boxes } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CustomCanvasNode } from "./graph-custom-projection";

export function GraphCustomCard({ data, selected }: NodeProps<CustomCanvasNode>) {
  const inputs = data.ports.filter((port) => port.side === "in"), outputs = data.ports.filter((port) => port.side === "out");
  return <div className={cn("relative w-60 rounded-xl border-2 border-primary/50 bg-card p-3 shadow-sm", selected && "ring-2 ring-ring")} style={{ minHeight: Math.max(104, 48 + Math.max(inputs.length, outputs.length) * 18) }}>
    <div className="flex items-start gap-2"><Boxes className="size-4 shrink-0 text-primary"/><div className="min-w-0"><div className="line-clamp-2 break-words text-sm font-semibold">{data.group.name}</div><div className="mt-2 text-xs text-muted-foreground">Custom node · {data.group.nodeIds.length} members</div><div className="mt-1 text-[10px] text-muted-foreground">Double-click to expand</div></div></div>
    {inputs.map((port, index) => <Handle key={port.id} id={port.id} type="target" position={Position.Left} isConnectable={false} title={port.label} style={{ top: 42 + index * 18 }} className="!size-2.5 !bg-primary"/>)}
    {outputs.map((port, index) => <Handle key={port.id} id={port.id} type="source" position={Position.Right} isConnectable={false} title={port.label} style={{ top: 42 + index * 18 }} className="!size-2.5 !bg-primary"/>)}
  </div>;
}
