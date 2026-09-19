"use client";

import { useMemo } from "react";
import { Building2 } from "lucide-react";
import { Handle, MarkerType, Position, type Edge, type Node, type NodeProps } from "@xyflow/react";
import type { OrganizationChart, OrganizationSeat, OrganizationSeatRuntime, OrganizationUnit } from "@/lib/contracts/organization";
import { Badge } from "@/components/ui/badge";
import { graphRoutedEdgeTypes } from "@/components/shared/graph-routed-edge";
import { GraphCanvas } from "@/components/shared/graph-canvas";
import { useContainer } from "@/features/appshell";
import { cn } from "@/lib/utils";
import { organizationSeatLayout, organizationUnitLayout } from "../lib/canvas-layout";

interface UnitData extends Record<string, unknown> { unit: OrganizationUnit; seatCount: number }
interface SeatData extends Record<string, unknown> { seat: OrganizationSeat; runtime?: OrganizationSeatRuntime; unitName: string; external: boolean }
type UnitNode = Node<UnitData, "unit">;
type SeatNode = Node<SeatData, "seat">;
type OrganizationNode = UnitNode | SeatNode;

const statusClass: Record<OrganizationSeatRuntime["status"], string> = {
  ready: "bg-success", busy: "bg-warning", offline: "bg-muted-foreground", unresolved: "bg-destructive", unbound: "bg-info", vacant: "bg-border",
};

function UnitCard({ data, selected }: NodeProps<UnitNode>) {
  return <div className={cn("relative w-[230px] rounded-xl border bg-card p-3 shadow-sm", selected && "ring-2 ring-ring")}><Handle type="target" position={Position.Top} id="input" className="!size-2 !border-0 !bg-muted-foreground/50"/><Handle type="source" position={Position.Bottom} id="output" className="!size-2 !border-0 !bg-muted-foreground/50"/>
    <div className="flex items-start gap-2"><Building2 className="mt-0.5 size-4 shrink-0 text-muted-foreground"/><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{data.unit.name}</div><div className="mt-0.5 line-clamp-2 break-words text-[10px] text-muted-foreground">{data.unit.description || data.unit.kind}</div></div></div>
    <div className="mt-2 flex gap-1"><Badge variant="secondary" className="text-[9px]">{data.unit.kind}</Badge><Badge variant="outline" className="text-[9px]">{data.seatCount} seats</Badge>{data.unit.projectFlow?.nodes.length ? <Badge variant="outline" className="text-[9px]">{data.unit.projectFlow.nodes.length} nodes</Badge> : null}</div>
  </div>;
}
function SeatCard({ data, selected }: NodeProps<SeatNode>) {
  const status = data.runtime?.status ?? "vacant";
  return <div className={cn("relative w-[238px] rounded-xl border bg-card p-3 shadow-sm", selected && "ring-2 ring-ring", data.external && "opacity-75")}><Handle type="target" position={Position.Top} id="input" className="!size-2 !border-0 !bg-muted-foreground/50"/><Handle type="source" position={Position.Bottom} id="output" className="!size-2 !border-0 !bg-muted-foreground/50"/>
    <div className="flex items-start gap-2"><span className={cn("mt-1 size-2.5 shrink-0 rounded-full", statusClass[status])}/><div className="min-w-0 flex-1"><div className="text-xs font-semibold leading-tight">{data.seat.title}</div><div className="mt-0.5 truncate text-[10px] text-muted-foreground">{data.seat.name}</div></div></div>
    <div className="mt-2 flex flex-wrap gap-1"><Badge variant="secondary" className="text-[9px]">{data.seat.role}</Badge><Badge variant="outline" className="max-w-[140px] truncate text-[9px]">{data.unitName}</Badge>{data.external?<Badge variant="outline" className="text-[9px]">reporting parent</Badge>:null}</div>
  </div>;
}
const nodeTypes = { unit: UnitCard, seat: SeatCard };

export function OrganizationCanvas({ chart, runtime, unitId, selectedSeatId, onUnitSelect, onSeatSelect, onSeatOpen }: {
  chart: OrganizationChart;
  runtime: OrganizationSeatRuntime[];
  unitId: string;
  selectedSeatId: string | null;
  onUnitSelect: (id: string) => void;
  onSeatSelect: (seat: OrganizationSeat | null) => void;
  onSeatOpen: (seat: OrganizationSeat) => void;
}) {
  const [canvasRef, pane] = useContainer<HTMLDivElement>();
  const layoutOptions = useMemo(() => pane === "xs" || pane === "sm"
    ? { maxColumns: 2, xGap: 248, yGap: 154, startX: 42, startY: 42 }
    : pane === "md"
      ? { maxColumns: 3, xGap: 258, yGap: 162, startX: 56, startY: 52 }
      : { maxColumns: 5, xGap: 270, yGap: 176, startX: 80, startY: 70 }, [pane]);
  const runtimeById = useMemo(() => new Map(runtime.map((row) => [row.seatId, row])), [runtime]);
  const unitById = useMemo(() => new Map(chart.units.map((unit) => [unit.id, unit])), [chart.units]);
  const nodes = useMemo<OrganizationNode[]>(() => {
    if (!unitId) return organizationUnitLayout(chart, layoutOptions).map(({ item, position }) => ({ id: item.id, type: "unit", position, width: 230, height: 96, data: { unit: item, seatCount: chart.seats.filter((seat) => seat.unitId === item.id).length } }));
    return organizationSeatLayout(chart, unitId, layoutOptions).map(({ item, position, external }) => ({ id: item.id, type: "seat", position, width: 238, height: 96, selected: item.id === selectedSeatId, data: { seat: item, runtime: runtimeById.get(item.id), unitName: unitById.get(item.unitId)?.name ?? item.unitId, external } }));
  }, [chart, layoutOptions, runtimeById, selectedSeatId, unitById, unitId]);
  const visible = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
  const edges = useMemo<Edge[]>(() => {
    if (!unitId) return chart.units.filter((unit) => unit.parentUnitId && visible.has(unit.parentUnitId)).map((unit) => ({ id: `unit-${unit.parentUnitId}-${unit.id}`, source: unit.parentUnitId!, target: unit.id, type: "routed", markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: "var(--muted-foreground)" }, style: { stroke: "var(--muted-foreground)", strokeWidth: 1.6 } }));
    return chart.seats.filter((seat) => visible.has(seat.id) && seat.reportsToSeatId && visible.has(seat.reportsToSeatId)).map((seat) => {
      const parent = chart.seats.find((row) => row.id === seat.reportsToSeatId), crossUnit = Boolean(parent && parent.unitId !== seat.unitId), busy = runtimeById.get(seat.id)?.status === "busy" || runtimeById.get(seat.reportsToSeatId!)?.status === "busy", stroke = busy ? "var(--warning)" : "var(--muted-foreground)";
      return { id: `seat-${seat.reportsToSeatId}-${seat.id}`, source: seat.reportsToSeatId!, target: seat.id, type: "routed", animated: busy, markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: stroke }, style: { stroke, strokeWidth: busy ? 2.4 : 1.6, strokeDasharray: crossUnit ? "7 5" : undefined } };
    });
  }, [chart.seats, chart.units, runtimeById, unitId, visible]);

  return (
    <div ref={canvasRef} className="h-full min-h-0 w-full min-w-0">
      <GraphCanvas<OrganizationNode, Edge>
        key={unitId || "unit-overview"}
        ariaLabel={unitId ? "Organization seats canvas" : "Organization units canvas"}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes} edgeTypes={graphRoutedEdgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        deleteKeyCode={null}
        onPaneClick={() => onSeatSelect(null)}
        onNodeClick={(_, node) => node.type === "unit" ? onUnitSelect(node.id) : onSeatSelect((node as SeatNode).data.seat)}
        onNodeDoubleClick={(_, node) => { if (node.type === "seat") onSeatOpen((node as SeatNode).data.seat); }}
        fitPadding={pane === "xs" || pane === "sm" ? 0.12 : pane === "md" ? 0.18 : 0.26}
        miniMapNodeColor={(node) => node.type === "unit" ? "var(--info)" : (() => {
          const status = (node as SeatNode).data.runtime?.status ?? "vacant";
          return status === "busy" ? "var(--warning)" : status === "ready" ? "var(--success)" : status === "unresolved" ? "var(--destructive)" : "var(--text-dim)";
        })()}
        miniMapNodeStrokeColor={(node) => node.selected ? "var(--accent)" : "var(--border)"}
      />
    </div>
  );
}
