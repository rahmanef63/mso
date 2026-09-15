"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Building2, Pencil, Plus, RefreshCw, Users, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { OrganizationSeat, OrganizationUnit } from "@/lib/contracts/organization";
import { getOrganization, mutateOrganization, type OrganizationPayload } from "../lib/organization-api";
import { OrganizationCanvas } from "./organization-canvas";
import { OrganizationEditor } from "./organization-editor";

type Draft = { kind: "unit"; item?: OrganizationUnit } | { kind: "seat"; item?: OrganizationSeat } | null;

export function OrganizationView() {
  const [data, setData] = useState<OrganizationPayload | null>(null);
  const [selectedUnit, setSelectedUnit] = useState("__all__");
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
  const chooseUnit = (id: string) => { setSelectedUnit(id); setSelectedSeatId(null); };

  if (!data) return <div className="grid h-full place-items-center p-6 text-sm text-muted-foreground">{error || "Loading organization…"}</div>;

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden lg:grid-cols-[220px_minmax(0,1fr)] lg:grid-rows-1">
      <aside className="border-b bg-card/20 lg:flex lg:min-h-0 lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2 p-3">
          <div className="min-w-0"><div className="font-semibold">Organization</div><div className="text-[11px] text-muted-foreground">{data.chart.units.length} units · {data.chart.seats.length} seats</div></div>
          <Button size="icon" variant="ghost" className="ml-auto" onClick={() => void load()} aria-label="Refresh organization"><RefreshCw className="size-3.5"/></Button>
          <Button size="icon" onClick={() => setDraft({ kind: "unit" })} aria-label="New organization unit"><Plus className="size-3.5"/></Button>
        </div>
        <div className="flex gap-1 overflow-x-auto px-2 pb-2 lg:block lg:flex-1 lg:space-y-1 lg:overflow-y-auto">
          <UnitButton active={selectedUnit === "__all__"} icon={<Users className="size-4"/>} label="All organization" count={data.chart.seats.length} onClick={() => chooseUnit("__all__")}/>
          {units.map((unit) => <UnitButton key={unit.id} active={selectedUnit === unit.id} icon={<Building2 className="size-4"/>} label={unit.name} count={data.chart.seats.filter((seat) => seat.unitId === unit.id).length} onClick={() => chooseUnit(unit.id)}/>) }
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col">
        <div className="flex min-h-12 flex-wrap items-center gap-2 border-b px-3 py-2">
          {currentUnit ? <Button size="icon" variant="ghost" onClick={() => chooseUnit("__all__")} aria-label="Back to organization overview"><ArrowLeft className="size-4"/></Button> : null}
          <div className="min-w-0"><div className="flex items-center gap-2"><h2 className="truncate text-sm font-semibold">{currentUnit?.name ?? data.chart.name}</h2>{currentUnit ? <Badge variant="secondary">{currentUnit.kind}</Badge> : <Badge variant="outline">overview</Badge>}</div><p className="max-w-2xl truncate text-[11px] text-muted-foreground">{currentUnit?.description || "Open a unit to inspect its reporting graph. Pan, zoom, fit, and use the minimap like a workflow canvas."}</p></div>
          <div className="ml-auto flex gap-1">{currentUnit ? <Button size="sm" variant="outline" onClick={() => setDraft({ kind: "unit", item: currentUnit })}><Pencil className="mr-1 size-3"/>Unit</Button> : null}{currentUnit ? <Button size="sm" onClick={() => setDraft({ kind: "seat" })}><Users className="mr-1 size-3"/>Seat</Button> : null}</div>
        </div>
        {error ? <div className="border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</div> : null}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <OrganizationCanvas chart={data.chart} runtime={data.runtime} unitId={currentUnit?.id ?? ""} selectedSeatId={selectedSeatId} onUnitSelect={chooseUnit} onSeatSelect={(seat) => setSelectedSeatId(seat?.id ?? null)} onSeatOpen={(seat) => setDraft({ kind: "seat", item: seat })}/>
          {selectedSeat ? <SeatInspector seat={selectedSeat} runtimeLabel={selectedRuntime?.label} runtimeStatus={selectedRuntime?.status} onClose={() => setSelectedSeatId(null)} onEdit={() => setDraft({ kind: "seat", item: selectedSeat })}/> : null}
        </div>
        <div className="border-t px-3 py-1.5 text-[10px] text-muted-foreground">V select · H pan · Space temporary pan · F fit · wheel/pinch zoom. Seat execution status remains capability-safe and does not grant authority.</div>
      </section>
      <OrganizationEditor draft={draft} chart={data.chart} onClose={() => setDraft(null)} onSave={save} onDelete={remove}/>
    </div>
  );
}

function UnitButton({ active, icon, label, count, onClick }: { active: boolean; icon: React.ReactNode; label: string; count: number; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm lg:w-full ${active ? "bg-accent font-medium" : "hover:bg-accent/60"}`}>{icon}<span className="max-w-40 truncate lg:min-w-0 lg:flex-1">{label}</span><Badge variant="outline" className="text-[9px]">{count}</Badge></button>;
}

function SeatInspector({ seat, runtimeLabel, runtimeStatus, onClose, onEdit }: { seat: OrganizationSeat; runtimeLabel?: string; runtimeStatus?: string; onClose: () => void; onEdit: () => void }) {
  return <div className="absolute right-3 top-3 z-10 w-[min(19rem,calc(100%-1.5rem))] rounded-xl border bg-popover/95 p-3 shadow-lg backdrop-blur"><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><div className="text-xs font-semibold">{seat.title}</div><div className="mt-0.5 truncate text-[11px] text-muted-foreground">{seat.name}</div></div><Button size="icon" variant="ghost" className="size-7" onClick={onClose} aria-label="Close seat details"><X className="size-3.5"/></Button></div><div className="mt-2 flex flex-wrap gap-1"><Badge variant="secondary" className="text-[9px]">{seat.role}</Badge><Badge variant="outline" className="text-[9px]">{seat.seatMode}</Badge><Badge variant="outline" className="text-[9px]">{runtimeStatus ?? seat.state}</Badge></div>{seat.description ? <p className="mt-2 text-[11px] text-muted-foreground">{seat.description}</p> : null}{runtimeLabel ? <p className="mt-2 truncate text-[10px] text-muted-foreground">Target: {runtimeLabel}</p> : null}<Button size="sm" className="mt-3 w-full" onClick={onEdit}><Pencil className="mr-1 size-3"/>Edit seat</Button></div>;
}
