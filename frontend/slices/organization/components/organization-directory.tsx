"use client";

import { useMemo, useState } from "react";
import { BriefcaseBusiness, Building2, Search, UserRound, Users } from "lucide-react";
import type { OrganizationChart, OrganizationSeat, OrganizationSeatRuntime } from "@/lib/contracts/organization";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const runtimeDot: Record<OrganizationSeatRuntime["status"], string> = {
  ready: "bg-success",
  busy: "bg-warning",
  offline: "bg-muted-foreground",
  unresolved: "bg-destructive",
  unbound: "bg-info",
  vacant: "bg-border",
};

export function OrganizationUnitDirectory({
  chart,
  runtime,
  onUnitSelect,
}: {
  chart: OrganizationChart;
  runtime: OrganizationSeatRuntime[];
  onUnitSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const runtimeBySeat = useMemo(() => new Map(runtime.map((row) => [row.seatId, row])), [runtime]);
  const units = useMemo(() => {
    const q = query.trim().toLowerCase();
    return chart.units
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .filter((unit) => !q || `${unit.name} ${unit.description} ${unit.kind}`.toLowerCase().includes(q));
  }, [chart.units, query]);

  return <div data-slot="organization-unit-directory" className="flex h-full min-h-0 flex-col bg-background/40">
    <div className="grid shrink-0 gap-3 border-b p-3 @min-[760px]:grid-cols-[minmax(0,1fr)_auto] @min-[760px]:items-center">
      <div>
        <h3 className="text-sm font-semibold">Organization overview</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">Scan units first. Open a unit for projects, seats, reporting lines, and execution bindings.</p>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Metric value={chart.units.length} label="Units" icon={<Building2 className="size-3.5"/>}/>
        <Metric value={chart.seats.length} label="Seats" icon={<Users className="size-3.5"/>}/>
        <Metric value={runtime.filter((row) => row.status === "ready" || row.status === "busy").length} label="Online" icon={<UserRound className="size-3.5"/>}/>
      </div>
    </div>
    <div className="shrink-0 border-b p-3">
      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/>
        <Input aria-label="Search organization units" className="h-9 pl-9" placeholder="Search units, companies, teams, or clients…" value={query} onChange={(event) => setQuery(event.target.value)}/>
      </div>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      {units.length ? <div className="grid gap-3 @min-[620px]:grid-cols-2 @min-[1100px]:grid-cols-3">
        {units.map((unit) => {
          const seats = chart.seats.filter((seat) => seat.unitId === unit.id);
          const active = seats.filter((seat) => {
            const status = runtimeBySeat.get(seat.id)?.status;
            return status === "ready" || status === "busy";
          }).length;
          const projects = unit.projectFlow?.nodes.filter((node) => node.kind === "project").length ?? 0;
          const activities = unit.projectFlow?.nodes.length ?? 0;
          return <button key={unit.id} type="button" onClick={() => onUnitSelect(unit.id)} className="group min-w-0 rounded-xl border bg-card p-4 text-left shadow-sm transition hover:border-foreground/20 hover:bg-accent/35 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <div className="flex items-start gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-lg border bg-muted/50"><Building2 className="size-4 text-muted-foreground"/></div>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2"><h4 className="truncate text-sm font-semibold">{unit.name}</h4><Badge variant="secondary" className="shrink-0 text-[9px]">{unit.kind}</Badge></div>
                <p className="mt-1 line-clamp-2 min-h-8 text-xs leading-4 text-muted-foreground">{unit.description || "No description yet."}</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <MiniMetric value={seats.length} label="seats"/>
              <MiniMetric value={active} label="online"/>
              <MiniMetric value={projects || activities} label={projects ? "projects" : "nodes"}/>
            </div>
          </button>;
        })}
      </div> : <div className="grid h-52 place-items-center rounded-xl border border-dashed text-center text-sm text-muted-foreground">No units match this search.</div>}
    </div>
  </div>;
}

export function OrganizationSeatDirectory({
  chart,
  runtime,
  unitId,
  onSeatSelect,
  onSeatOpen,
}: {
  chart: OrganizationChart;
  runtime: OrganizationSeatRuntime[];
  unitId: string;
  onSeatSelect: (seat: OrganizationSeat | null) => void;
  onSeatOpen: (seat: OrganizationSeat) => void;
}) {
  const [query, setQuery] = useState("");
  const runtimeBySeat = useMemo(() => new Map(runtime.map((row) => [row.seatId, row])), [runtime]);
  const seats = useMemo(() => {
    const q = query.trim().toLowerCase();
    return chart.seats
      .filter((seat) => seat.unitId === unitId)
      .sort((a, b) => a.title.localeCompare(b.title) || a.name.localeCompare(b.name))
      .filter((seat) => !q || `${seat.title} ${seat.name} ${seat.role} ${seat.description}`.toLowerCase().includes(q));
  }, [chart.seats, query, unitId]);

  return <div data-slot="organization-seat-directory" className="flex h-full min-h-0 flex-col">
    <div className="shrink-0 border-b p-3">
      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/>
        <Input aria-label="Search organization seats" className="h-9 pl-9" placeholder="Search seats, roles, or people…" value={query} onChange={(event) => setQuery(event.target.value)}/>
      </div>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      {seats.length ? <div className="grid gap-2 @min-[720px]:grid-cols-2 @min-[1180px]:grid-cols-3">
        {seats.map((seat) => {
          const runtimeRow = runtimeBySeat.get(seat.id);
          const status = runtimeRow?.status ?? "vacant";
          return <button key={seat.id} type="button" onClick={() => onSeatSelect(seat)} onDoubleClick={() => onSeatOpen(seat)} className="min-w-0 rounded-xl border bg-card p-3 text-left shadow-sm transition hover:bg-accent/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <div className="flex items-start gap-2.5">
              <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", runtimeDot[status])}/>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{seat.title}</div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">{seat.name}</div>
              </div>
              <Badge variant="outline" className="shrink-0 text-[9px]">{status}</Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-1"><Badge variant="secondary" className="text-[9px]">{seat.role}</Badge><Badge variant="outline" className="text-[9px]">{seat.seatMode}</Badge><Badge variant="outline" className="text-[9px]">{seat.state}</Badge></div>
            {seat.description ? <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{seat.description}</p> : null}
            <div className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground"><BriefcaseBusiness className="size-3"/><span className="truncate">{runtimeRow?.label || "No execution target bound"}</span></div>
          </button>;
        })}
      </div> : <div className="grid h-48 place-items-center rounded-xl border border-dashed text-center text-sm text-muted-foreground">No seats match this search.</div>}
    </div>
  </div>;
}

function Metric({ value, label, icon }: { value: number; label: string; icon: React.ReactNode }) {
  return <div className="min-w-16 rounded-lg border bg-card px-2.5 py-2"><div className="flex items-center justify-center gap-1 text-sm font-semibold">{icon}{value}</div><div className="mt-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div></div>;
}

function MiniMetric({ value, label }: { value: number; label: string }) {
  return <div className="rounded-lg bg-muted/45 px-2 py-2 text-center"><div className="text-sm font-semibold">{value}</div><div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div></div>;
}
