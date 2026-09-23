"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Building2, LayoutGrid, Network, Pencil, Plus, RefreshCw, Users, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { OrganizationSeat, OrganizationUnit } from "@/lib/contracts/organization";
import { getOrganization, mutateOrganization, type OrganizationPayload } from "../lib/organization-api";
import { OrganizationCanvas } from "./organization-canvas";
import { OrganizationEditor } from "./organization-editor";
import { OrganizationSeatDirectory, OrganizationUnitDirectory } from "./organization-directory";
import { ProjectFlow } from "./project-flow";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Draft = { kind: "unit"; item?: OrganizationUnit } | { kind: "seat"; item?: OrganizationSeat; unitId?: string } | null;
type CanvasMode = "directory" | "map";

export function OrganizationView() {
  const [data, setData] = useState<OrganizationPayload | null>(null);
  const [selectedUnit, setSelectedUnit] = useState("__all__");
  const [tab, setTab] = useState("projects");
  const [overviewMode, setOverviewMode] = useState<CanvasMode>("directory");
  const [seatMode, setSeatMode] = useState<CanvasMode>("directory");
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const next = await getOrganization();
      setData(next);
      setSelectedUnit((current) => current === "__all__" || next.chart.units.some((unit) => unit.id === current) ? current : "__all__");
      setSelectedSeatId((current) => current && next.chart.seats.some((seat) => seat.id === current) ? current : null);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Organization unavailable");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void getOrganization().then((next) => {
      if (!alive) return;
      setData(next);
      setSelectedUnit((current) => current === "__all__" || next.chart.units.some((unit) => unit.id === current) ? current : "__all__");
      setSelectedSeatId((current) => current && next.chart.seats.some((seat) => seat.id === current) ? current : null);
      setError("");
    }).catch((cause: unknown) => { if (alive) setError(cause instanceof Error ? cause.message : "Organization unavailable"); });
    return () => { alive = false; };
  }, []);

  const currentUnit = data?.chart.units.find((unit) => unit.id === selectedUnit);
  const selectedSeat = data?.chart.seats.find((seat) => seat.id === selectedSeatId) ?? null;
  const selectedRuntime = data?.runtime.find((row) => row.seatId === selectedSeatId);
  const units = useMemo(() => data?.chart.units.slice().sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)) ?? [], [data]);

  const save = async (action: string, record: Record<string, unknown>) => {
    if (!data) return;
    const key = action.startsWith("unit_") ? "unit" : "seat";
    const next = await mutateOrganization({ action, expected_revision: data.chart.revision, [key]: record });
    setData(next);
    if (key === "seat" && typeof record.id === "string") setSelectedSeatId(record.id);
  };
  const remove = async (kind: "unit" | "seat", id: string) => {
    if (!data) return;
    const next = await mutateOrganization({ action: `${kind}_delete`, expected_revision: data.chart.revision, id });
    setData(next); setDraft(null);
    if (kind === "unit" && id === selectedUnit) setSelectedUnit("__all__");
    if (kind === "seat" && id === selectedSeatId) setSelectedSeatId(null);
  };
  const chooseUnit = (id: string) => {
    setSelectedUnit(id);
    setSelectedSeatId(null);
    setTab("projects");
    setSeatMode("directory");
  };

  if (!data) return <div className="grid h-full place-items-center p-6 text-sm text-muted-foreground">{error || "Loading organization…"}</div>;

  return (
    <div data-slot="organization-feature" className="@container grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden @min-[760px]:grid-cols-[236px_minmax(0,1fr)] @min-[760px]:grid-rows-1">
      <aside className="min-w-0 border-b bg-card/25 @min-[760px]:flex @min-[760px]:min-h-0 @min-[760px]:flex-col @min-[760px]:border-b-0 @min-[760px]:border-r">
        <div className="flex min-w-0 items-center gap-2 border-b/0 px-3 py-2.5 @min-[760px]:py-3">
          <div className="min-w-0 flex-1"><div className="truncate font-semibold">Organization</div><div className="text-[11px] text-muted-foreground">{data.chart.units.length} units · {data.chart.seats.length} seats</div></div>
          <Button size="icon" variant="ghost" className="size-8 shrink-0" onClick={() => void load()} aria-label="Refresh organization"><RefreshCw className="size-3.5"/></Button>
          <Button size="icon" className="size-8 shrink-0" onClick={() => setDraft({ kind: "unit" })} aria-label="New organization unit"><Plus className="size-3.5"/></Button>
        </div>

        <div className="px-3 pb-2.5 @min-[760px]:hidden">
          <label className="sr-only" htmlFor="organization-unit-picker">Organization unit</label>
          <select id="organization-unit-picker" aria-label="Organization unit" className="h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-sm" value={selectedUnit} onChange={(event) => chooseUnit(event.target.value)}>
            <option value="__all__">All organization · {data.chart.seats.length}</option>
            {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} · {data.chart.seats.filter((seat) => seat.unitId === unit.id).length}</option>)}
          </select>
        </div>

        <nav aria-label="Organization units" className="hidden min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2 @min-[760px]:block">
          <UnitButton active={selectedUnit === "__all__"} icon={<Users className="size-4"/>} label="All organization" count={data.chart.seats.length} onClick={() => chooseUnit("__all__")}/>
          {units.map((unit) => <UnitButton key={unit.id} active={selectedUnit === unit.id} icon={<Building2 className="size-4"/>} label={unit.name} count={data.chart.seats.filter((seat) => seat.unitId === unit.id).length} onClick={() => chooseUnit(unit.id)}/>)}
        </nav>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        <div className="grid min-h-12 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b px-3 py-1.5">
          <div className="flex min-w-0 items-start gap-1.5">
            {currentUnit ? <Button size="icon" variant="ghost" className="size-8 shrink-0" onClick={() => chooseUnit("__all__")} aria-label="Back to organization overview"><ArrowLeft className="size-4"/></Button> : null}
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2"><h2 className="truncate text-sm font-semibold">{currentUnit?.name ?? data.chart.name}</h2>{currentUnit ? <Badge variant="secondary" className="shrink-0">{currentUnit.kind}</Badge> : null}</div>
              <p className="mt-0.5 hidden max-w-3xl text-[11px] leading-snug text-muted-foreground @min-[520px]:line-clamp-2">{currentUnit?.description || "Directory first for fast scanning. The map remains available when you need reporting or relationship topology."}</p>
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            {currentUnit ? <Button size="sm" variant="outline" className="h-8 px-2" onClick={() => setDraft({ kind: "unit", item: currentUnit })}><Pencil className="size-3 @min-[480px]:mr-1"/><span className="hidden @min-[480px]:inline">Unit</span></Button> : <ModeSwitch value={overviewMode} onChange={setOverviewMode}/>}
            {currentUnit ? <Button size="sm" className="h-8 px-2" onClick={() => setDraft({ kind: "seat", unitId: currentUnit.id })}><Users className="size-3 @min-[480px]:mr-1"/><span className="hidden @min-[480px]:inline">Seat</span></Button> : null}
          </div>
        </div>

        {error ? <div className="shrink-0 border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</div> : null}

        {currentUnit ? <Tabs key={currentUnit.id} className="flex min-h-0 flex-1 flex-col gap-0">
          <div className="flex min-w-0 shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
            <TabsList className="w-fit shrink-0"><TabsTrigger active={tab === "projects"} onClick={() => setTab("projects")}>Projects</TabsTrigger><TabsTrigger active={tab === "seats"} onClick={() => setTab("seats")}>Seats</TabsTrigger></TabsList>
            {tab === "seats" ? <ModeSwitch value={seatMode} onChange={setSeatMode}/> : null}
          </div>
          {tab === "projects" ? <div className="relative min-h-0 flex-1 overflow-hidden"><ProjectFlow unit={currentUnit} onSave={async (action, record) => { const next = await mutateOrganization({ action, expected_revision: data.chart.revision, data: record }); setData(next); }}/></div> : <div className="relative min-h-0 flex-1 overflow-hidden">
            {seatMode === "directory" ? <OrganizationSeatDirectory chart={data.chart} runtime={data.runtime} unitId={currentUnit.id} onSeatSelect={(seat) => setSelectedSeatId(seat?.id ?? null)} onSeatOpen={(seat) => setDraft({ kind: "seat", item: seat })}/> : <OrganizationCanvas chart={data.chart} runtime={data.runtime} unitId={currentUnit.id} selectedSeatId={selectedSeatId} onUnitSelect={chooseUnit} onSeatSelect={(seat) => setSelectedSeatId(seat?.id ?? null)} onSeatOpen={(seat) => setDraft({ kind: "seat", item: seat })}/>}
            {selectedSeat ? <SeatInspector seat={selectedSeat} runtimeLabel={selectedRuntime?.label} runtimeStatus={selectedRuntime?.status} onClose={() => setSelectedSeatId(null)} onEdit={() => setDraft({ kind: "seat", item: selectedSeat })}/> : null}
          </div>}
        </Tabs> : <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
            {overviewMode === "directory" ? <OrganizationUnitDirectory chart={data.chart} runtime={data.runtime} onUnitSelect={chooseUnit}/> : <OrganizationCanvas chart={data.chart} runtime={data.runtime} unitId="" selectedSeatId={null} onUnitSelect={chooseUnit} onSeatSelect={() => {}} onSeatOpen={() => {}}/>}
          </div>
        </div>}
      </section>
      <OrganizationEditor draft={draft} chart={data.chart} onClose={() => setDraft(null)} onSave={save} onDelete={remove}/>
    </div>
  );
}

function ModeSwitch({ value, onChange }: { value: CanvasMode; onChange: (value: CanvasMode) => void }) {
  return <div className="flex shrink-0 rounded-lg border bg-muted/30 p-0.5" role="group" aria-label="Organization view">
    <button type="button" aria-pressed={value === "directory"} className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] ${value === "directory" ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"}`} onClick={() => onChange("directory")}><LayoutGrid className="size-3.5"/>Directory</button>
    <button type="button" aria-pressed={value === "map"} className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] ${value === "map" ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"}`} onClick={() => onChange("map")}><Network className="size-3.5"/>Map</button>
  </div>;
}

function UnitButton({ active, icon, label, count, onClick }: { active: boolean; icon: React.ReactNode; label: string; count: number; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${active ? "bg-accent font-medium" : "hover:bg-accent/60"}`}>{icon}<span className="min-w-0 flex-1 truncate">{label}</span><Badge variant="outline" className="shrink-0 text-[9px]">{count}</Badge></button>;
}

function SeatInspector({ seat, runtimeLabel, runtimeStatus, onClose, onEdit }: { seat: OrganizationSeat; runtimeLabel?: string; runtimeStatus?: string; onClose: () => void; onEdit: () => void }) {
  return <div className="absolute inset-x-3 top-3 z-10 max-h-[calc(100%-1.5rem)] overflow-y-auto rounded-xl border bg-popover/95 p-3 shadow-lg backdrop-blur @min-[480px]:inset-x-auto @min-[480px]:right-3 @min-[480px]:w-[19rem]"><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><div className="text-xs font-semibold">{seat.title}</div><div className="mt-0.5 truncate text-[11px] text-muted-foreground">{seat.name}</div></div><Button size="icon" variant="ghost" className="size-7 shrink-0" onClick={onClose} aria-label="Close seat details"><X className="size-3.5"/></Button></div><div className="mt-2 flex flex-wrap gap-1"><Badge variant="secondary" className="text-[9px]">{seat.role}</Badge><Badge variant="outline" className="text-[9px]">{seat.seatMode}</Badge><Badge variant="outline" className="text-[9px]">{runtimeStatus ?? seat.state}</Badge></div>{seat.description ? <p className="mt-2 text-[11px] text-muted-foreground">{seat.description}</p> : null}{runtimeLabel ? <p className="mt-2 break-words text-[10px] text-muted-foreground">Target: {runtimeLabel}</p> : null}<Button size="sm" className="mt-3 w-full" onClick={onEdit}><Pencil className="mr-1 size-3"/>Edit seat</Button></div>;
}
