"use client";

import { useMemo } from "react";
import { Building2 } from "lucide-react";
import type { Edge, Node, NodeProps } from "@xyflow/react";
import type { OrganizationChart, OrganizationSeat, OrganizationSeatRuntime, OrganizationUnit } from "@/lib/contracts/organization";
import { Badge } from "@/components/ui/badge";
import { GraphCanvas } from "@/components/shared/graph-canvas";
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
  return <div className={cn("w-[230px] rounded-xl border bg-card p-3 shadow-sm", selected && "ring-2 ring-ring")}>
    <div className="flex items-start gap-2"><Building2 className="mt-0.5 size-4 shrink-0 text-muted-foreground"/><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{data.unit.name}</div><div className="mt-0.5 text-[10px] text-muted-foreground">{data.unit.description || data.unit.kind}</div></div></div>
    <div className="mt-2 flex gap-1"><Badge variant="secondary" className="text-[9px]">{data.unit.kind}</Badge><Badge variant="outline" className="text-[9px]">{data.seatCount} seats</Badge></div>
  </div>;
}
function SeatCard({ data, selected }: NodeProps<SeatNode>) {
  const status = data.runtime?.status ?? "vacant";
  return <div className={cn("w-[238px] rounded-xl border bg-card p-3 shadow-sm", selected && "ring-2 ring-ring", data.external && "opacity-75")}>
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
  const runtimeById = useMemo(() => new Map(runtime.map((row) => [row.seatId, row])), [runtime]);
  const unitById = useMemo(() => new Map(chart.units.map((unit) => [unit.id, unit])), [chart.units]);
  const nodes = useMemo<OrganizationNode[]>(() => {
    if (!unitId) return organizationUnitLayout(chart).map(({ item, position }) => ({ id: item.id, type: "unit", position, data: { unit: item, seatCount: chart.seats.filter((seat) => seat.unitId === item.id).length } }));
    return organizationSeatLayout(chart, unitId).map(({ item, position, external }) => ({ id: item.id, type: "seat", position, selected: item.id === selectedSeatId, data: { seat: item, runtime: runtimeById.get(item.id), unitName: unitById.get(item.unitId)?.name ?? item.unitId, external } }));
  }, [chart, runtimeById, selectedSeatId, unitById, unitId]);
  const visible = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
  const edges = useMemo<Edge[]>(() => {
    if (!unitId) return chart.units.filter((unit) => unit.parentUnitId && visible.has(unit.parentUnitId)).map((unit) => ({ id: `unit-${unit.parentUnitId}-${unit.id}`, source: unit.parentUnitId!, target: unit.id, type: "smoothstep" }));
    return chart.seats.filter((seat) => visible.has(seat.id) && seat.reportsToSeatId && visible.has(seat.reportsToSeatId)).map((seat) => ({ id: `seat-${seat.reportsToSeatId}-${seat.id}`, source: seat.reportsToSeatId!, target: seat.id, type: "smoothstep" }));
  }, [chart.seats, chart.units, unitId, visible]);

  return <GraphCanvas<OrganizationNode, Edge>
    key={unitId || "unit-overview"}
    ariaLabel={unitId ? "Organization seats canvas" : "Organization units canvas"}
    nodes={nodes}
    edges={edges}
    nodeTypes={nodeTypes}
    nodesDraggable={false}
    nodesConnectable={false}
    edgesFocusable={false}
    deleteKeyCode={null}
    onPaneClick={() => onSeatSelect(null)}
    onNodeClick={(_, node) => node.type === "unit" ? onUnitSelect(node.id) : onSeatSelect((node as SeatNode).data.seat)}
    onNodeDoubleClick={(_, node) => { if (node.type === "seat") onSeatOpen((node as SeatNode).data.seat); }}
    fitPadding={0.28}
  />;
}
