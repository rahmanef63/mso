"use client";
import { useCallback, useEffect, useState } from "react";
import { Building2, Plus, RefreshCw, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { OrganizationSeat, OrganizationUnit } from "@/lib/contracts/organization";
import { getOrganization, mutateOrganization, type OrganizationPayload } from "../lib/organization-api";
import { OrganizationEditor } from "./organization-editor";
import { OrganizationTree } from "./organization-tree";

type Draft = { kind: "unit"; item?: OrganizationUnit } | { kind: "seat"; item?: OrganizationSeat } | null;
export function OrganizationView() {
  const [data, setData] = useState<OrganizationPayload | null>(null), [selected, setSelected] = useState("__all__"), [draft, setDraft] = useState<Draft>(null), [error, setError] = useState("");
  const load = useCallback(async () => { try { const next = await getOrganization(); setData(next); setSelected((current) => current === "__all__" || next.chart.units.some((u)=>u.id===current) ? current : "__all__"); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Organization unavailable"); } }, []);
  useEffect(() => {
    let alive = true;
    void getOrganization().then((next) => {
      if (!alive) return;
      setData(next); setSelected((current) => current === "__all__" || next.chart.units.some((u) => u.id === current) ? current : "__all__"); setError("");
    }).catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : "Organization unavailable"); });
    return () => { alive = false; };
  }, []);
  const current = data?.chart.units.find((u) => u.id === selected);
  const mutate = async (action: string, record: Record<string, unknown>) => { if (!data) return; const key = action.startsWith("unit_") ? "unit" : "seat", next = await mutateOrganization({ action, expected_revision: data.chart.revision, [key]: record }); setData(next); };
  const remove = async (kind: "unit"|"seat", id: string) => { if (!data) return; const next = await mutateOrganization({ action: `${kind}_delete`, expected_revision: data.chart.revision, id }); setData(next); setDraft(null); if (kind === "unit" && id === selected) setSelected("__all__"); };
  if (!data) return <div className="grid h-full place-items-center p-6 text-sm text-muted-foreground">{error || "Loading organization…"}</div>;
  return <div className="grid h-full min-h-0 grid-cols-1 overflow-hidden lg:grid-cols-[240px_minmax(0,1fr)]">
    <aside className="flex min-h-0 flex-col border-b bg-card/20 lg:border-b-0 lg:border-r"><div className="flex items-center gap-2 p-3"><div><div className="font-semibold">Organization</div><div className="text-[11px] text-muted-foreground">{data.chart.units.length} units · {data.chart.seats.length} seats</div></div><Button size="icon" variant="ghost" className="ml-auto" onClick={()=>void load()}><RefreshCw className="size-3.5"/></Button><Button size="icon" onClick={()=>setDraft({kind:"unit"})}><Plus className="size-3.5"/></Button></div><ScrollArea className="max-h-40 flex-1 lg:max-h-none"><div className="space-y-1 p-2"><button className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${selected==="__all__"?"bg-accent font-medium":"hover:bg-accent/60"}`} onClick={()=>setSelected("__all__")}><Users className="size-4 shrink-0"/><span className="min-w-0 flex-1 truncate">All organization</span><Badge variant="outline" className="text-[9px]">{data.chart.seats.length}</Badge></button>{data.chart.units.slice().sort((a,b)=>a.sortOrder-b.sortOrder||a.name.localeCompare(b.name)).map((unit)=><button key={unit.id} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${unit.id===selected?"bg-accent font-medium":"hover:bg-accent/60"}`} onClick={()=>setSelected(unit.id)}><Building2 className="size-4 shrink-0"/><span className="min-w-0 flex-1 truncate">{unit.name}</span><Badge variant="outline" className="text-[9px]">{data.chart.seats.filter((s)=>s.unitId===unit.id).length}</Badge></button>)}</div></ScrollArea></aside>
    <section className="flex min-h-0 min-w-0 flex-col"><div className="flex flex-wrap items-center gap-2 border-b px-4 py-3"><div className="min-w-0"><div className="flex items-center gap-2"><h2 className="truncate font-semibold">{current?.name ?? data.chart.name}</h2>{current?<Badge variant="secondary">{current.kind}</Badge>:null}</div><p className="text-xs text-muted-foreground">{current?.description || (selected==="__all__"?"Complete reporting hierarchy across every organization unit.":"Choose or create an organization unit.")}</p></div><div className="ml-auto flex gap-2">{current?<Button size="sm" variant="outline" onClick={()=>setDraft({kind:"unit",item:current})}>Edit unit</Button>:null}{current?<Button size="sm" onClick={()=>setDraft({kind:"seat"})}><Users className="mr-1 size-3.5"/>Add seat</Button>:null}</div></div>
      {error?<div className="border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</div>:null}<ScrollArea className="flex-1"><div className="min-h-full min-w-full overflow-auto">{selected==="__all__"||current?<OrganizationTree chart={data.chart} runtime={data.runtime} unitId={current?.id??""} onEdit={(seat)=>setDraft({kind:"seat",item:seat})}/>:<div className="grid min-h-64 place-items-center text-sm text-muted-foreground">Create the first organization unit.</div>}</div></ScrollArea><div className="border-t px-4 py-2 text-[10px] text-muted-foreground">Seat status resolves existing project agents, durable local sessions, or registered A2A peers. Org metadata grants no extra capability.</div>
    </section><OrganizationEditor draft={draft} chart={data.chart} onClose={()=>setDraft(null)} onSave={mutate} onDelete={remove}/>
  </div>;
}
