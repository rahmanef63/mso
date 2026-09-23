"use client";

import { useMemo, useState } from "react";
import { BriefcaseBusiness, Building2, Search } from "lucide-react";
import type { OrganizationChart, OrganizationSeat, OrganizationSeatRuntime } from "@/lib/contracts/organization";
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
  const online = runtime.filter((row) => row.status === "ready" || row.status === "busy").length;

  return <div data-slot="organization-unit-directory" className="flex h-full min-h-0 flex-col bg-background/40">
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
      <div className="relative min-w-56 max-w-xl flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"/>
        <Input aria-label="Search organization units" className="h-8 pl-8 text-xs" placeholder="Search units, companies, teams, clients…" value={query} onChange={(event) => setQuery(event.target.value)}/>
      </div>
      <div className="shrink-0 text-[10px] text-muted-foreground">{chart.units.length} units · {chart.seats.length} seats · {online} online</div>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      {units.length ? <div className="grid gap-2 @min-[620px]:grid-cols-2 @min-[1100px]:grid-cols-3">
        {units.map((unit) => {
          const seats = chart.seats.filter((seat) => seat.unitId === unit.id);
          const active = seats.filter((seat) => {
            const status = runtimeBySeat.get(seat.id)?.status;
            return status === "ready" || status === "busy";
          }).length;
          const projects = unit.projectFlow?.nodes.filter((node) => node.kind === "project").length ?? 0;
          const activities = unit.projectFlow?.nodes.length ?? 0;
          return <button key={unit.id} type="button" onClick={() => onUnitSelect(unit.id)} className="group min-w-0 rounded-lg border bg-card p-3 text-left transition hover:border-foreground/20 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <div className="flex items-start gap-2.5">
              <div className="grid size-8 shrink-0 place-items-center rounded-md bg-muted/55"><Building2 className="size-3.5 text-muted-foreground"/></div>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-baseline gap-2">
                  <h4 className="min-w-0 flex-1 truncate text-sm font-semibold">{unit.name}</h4>
                  <span className="shrink-0 text-[9px] uppercase tracking-wide text-muted-foreground">{unit.kind}</span>
                </div>
                {unit.description ? <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{unit.description}</p> : null}
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                  <span>{seats.length} seats</span>
                  <span>{active} online</span>
                  <span>{projects || activities} {projects ? "projects" : "nodes"}</span>
                </div>
              </div>
            </div>
          </button>;
        })}
      </div> : <div className="grid h-44 place-items-center rounded-lg border border-dashed text-center text-xs text-muted-foreground">No units match this search.</div>}
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
    <div className="shrink-0 border-b px-3 py-2">
      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"/>
        <Input aria-label="Search organization seats" className="h-8 pl-8 text-xs" placeholder="Search seats, roles, or people…" value={query} onChange={(event) => setQuery(event.target.value)}/>
      </div>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      {seats.length ? <div className="grid gap-2 @min-[720px]:grid-cols-2 @min-[1180px]:grid-cols-3">
        {seats.map((seat) => {
          const runtimeRow = runtimeBySeat.get(seat.id);
          const status = runtimeRow?.status ?? "vacant";
          return <button key={seat.id} type="button" onClick={() => onSeatSelect(seat)} onDoubleClick={() => onSeatOpen(seat)} className="min-w-0 rounded-lg border bg-card p-3 text-left transition hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <div className="flex items-start gap-2.5">
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", runtimeDot[status])}/>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-baseline gap-2">
                  <div className="min-w-0 flex-1 truncate text-sm font-semibold">{seat.title}</div>
                  <span className="shrink-0 text-[9px] text-muted-foreground">{status}</span>
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">{seat.name}</div>
                {seat.description ? <p className="mt-1.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{seat.description}</p> : null}
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                  <span>{seat.role}</span>
                  <span>{seat.seatMode}</span>
                  <span className="inline-flex min-w-0 items-center gap-1"><BriefcaseBusiness className="size-3"/><span className="max-w-40 truncate">{runtimeRow?.label || "No target"}</span></span>
                </div>
              </div>
            </div>
          </button>;
        })}
      </div> : <div className="grid h-44 place-items-center rounded-lg border border-dashed text-center text-xs text-muted-foreground">No seats match this search.</div>}
    </div>
  </div>;
}
