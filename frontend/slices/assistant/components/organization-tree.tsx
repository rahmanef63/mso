"use client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OrganizationChart, OrganizationSeat, OrganizationSeatRuntime } from "@/lib/contracts/organization";

type Props = { chart: OrganizationChart; runtime: OrganizationSeatRuntime[]; unitId: string; onEdit: (seat: OrganizationSeat) => void };
const statusClass: Record<OrganizationSeatRuntime["status"], string> = { ready: "bg-emerald-500", busy: "bg-amber-500", offline: "bg-muted-foreground", unresolved: "bg-destructive", unbound: "bg-sky-500", vacant: "bg-border" };
export function OrganizationTree({ chart, runtime, unitId, onEdit }: Props) {
  const seats = chart.seats.filter((seat) => !unitId || seat.unitId === unitId).sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  const ids = new Set(seats.map((seat) => seat.id)), roots = seats.filter((seat) => !seat.reportsToSeatId || !ids.has(seat.reportsToSeatId));
  const byParent = new Map<string, OrganizationSeat[]>(); for (const seat of seats) if (seat.reportsToSeatId && ids.has(seat.reportsToSeatId)) byParent.set(seat.reportsToSeatId, [...(byParent.get(seat.reportsToSeatId) ?? []), seat]);
  const runtimeById = new Map(runtime.map((row) => [row.seatId, row])), unitById = new Map(chart.units.map((row) => [row.id, row]));
  if (!seats.length) return <div className="grid min-h-64 place-items-center rounded-xl border border-dashed text-sm text-muted-foreground">No seats in this unit yet.</div>;
  return <div className="min-w-max p-4"><div className="flex items-start justify-center gap-8">{roots.map((seat) => <Branch key={seat.id} seat={seat} childrenByParent={byParent} runtimeById={runtimeById} unitById={unitById} onEdit={onEdit} />)}</div></div>;
}
function Branch({ seat, childrenByParent, runtimeById, unitById, onEdit }: { seat: OrganizationSeat; childrenByParent: Map<string, OrganizationSeat[]>; runtimeById: Map<string, OrganizationSeatRuntime>; unitById: Map<string, { name: string }>; onEdit: (seat: OrganizationSeat) => void }) {
  const children = (childrenByParent.get(seat.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title)), state = runtimeById.get(seat.id);
  return <div className="flex min-w-[220px] flex-col items-center">
    <Button variant="ghost" className="h-auto w-[220px] whitespace-normal rounded-xl border bg-card p-0 text-left shadow-sm hover:bg-accent" onClick={() => onEdit(seat)}>
      <div className="w-full p-3"><div className="flex items-start gap-2"><span className={cn("mt-1 size-2.5 shrink-0 rounded-full", statusClass[state?.status ?? "vacant"])} /><div className="min-w-0 flex-1"><div className="font-semibold leading-tight">{seat.title}</div><div className="mt-0.5 text-[11px] text-muted-foreground">{seat.name}</div></div></div>
        <div className="mt-2 flex flex-wrap gap-1"><Badge variant="secondary" className="text-[9px]">{seat.role}</Badge><Badge variant="outline" className="text-[9px]">{unitById.get(seat.unitId)?.name ?? seat.unitId}</Badge><Badge variant="outline" className="text-[9px]">{seat.seatMode}</Badge>{seat.target.kind !== "none" ? <Badge variant="outline" className="max-w-[180px] truncate text-[9px]">{state?.label ?? seat.target.kind}</Badge> : null}</div>
      </div>
    </Button>
    {children.length ? <><div className="h-5 w-px bg-border"/><div className="relative flex items-start gap-4 pt-5 before:absolute before:left-[calc(50%-((100%-220px)/2))] before:right-[calc(50%-((100%-220px)/2))] before:top-0 before:h-px before:bg-border">{children.map((child) => <div key={child.id} className="relative before:absolute before:left-1/2 before:top-[-20px] before:h-5 before:w-px before:bg-border"><Branch seat={child} childrenByParent={childrenByParent} runtimeById={runtimeById} unitById={unitById} onEdit={onEdit}/></div>)}</div></> : null}
  </div>;
}
