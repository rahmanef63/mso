"use client";

import { useEffect, useState } from "react";
import { Activity, BrainCircuit, ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { SessionPage } from "@/lib/contracts/session-monitor";
import { getJevPreservationStatus, listWorkflowSessions, optimizeAllSessionsWithJev, type JevPreservationStatus } from "../lib/api";

export function WorkflowSessionLibrary({ activeId, onSelect }: { activeId?: string; onSelect: (id: string) => void }) {
  const [search, setSearch] = useState(""), [query, setQuery] = useState(""), [page, setPage] = useState(1);
  const [data, setData] = useState<SessionPage | null>(null), [error, setError] = useState(""), [nonce, setNonce] = useState(0);
  const [preservation, setPreservation] = useState<JevPreservationStatus | null>(null), [preserving, setPreserving] = useState(false);
  useEffect(() => {
    let alive = true;
    void listWorkflowSessions(page, query).then((value) => { if (alive) { setError(""); setData(value); } }).catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : "Sessions unavailable"); });
    return () => { alive = false; };
  }, [page, query, nonce]);
  useEffect(() => { let alive=true; void getJevPreservationStatus().then((value)=>{if(alive)setPreservation(value);}).catch(()=>undefined); return()=>{alive=false;}; }, [nonce]);
  const optimizeAll = async () => { setPreserving(true); setError(""); try { const result=await optimizeAllSessionsWithJev(); setPreservation(await getJevPreservationStatus()); setNonce((value)=>value+1); if(result.failed) setError(`${result.failed} session(s) still require an OpenRouter JEV decision. Connect OpenRouter in Settings → AI or Integrations → AI Providers, then run this again.`); } catch(cause) { setError(cause instanceof Error?cause.message:"JEV preservation failed"); } finally { setPreserving(false); } };
  return <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card/20">
    <div className="shrink-0 space-y-2 border-b p-3">
      <form className="flex min-w-0 gap-1" onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(search.trim()); }}>
        <div className="relative min-w-0 flex-1"><Search className="absolute left-2 top-2.5 size-3 text-muted-foreground"/><Input className="h-8 min-w-0 pl-7" aria-label="Search sessions" placeholder="Search agent, context, project…" value={search} onChange={(event) => { setSearch(event.target.value); if (!event.target.value) { setPage(1); setQuery(""); } }}/></div>
        <Button type="submit" variant="outline" size="icon" className="size-8 shrink-0" aria-label="Search sessions"><Search className="size-3.5"/></Button>
        <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Refresh sessions" onClick={() => setNonce((value) => value + 1)}><RefreshCw className="size-3.5"/></Button>
      </form>
      <p className="text-[10px] leading-4 text-muted-foreground">Readable execution flows. Session labels use agent-context; internal IDs stay hidden.</p>
      <Button type="button" variant="outline" size="sm" className="h-8 w-full justify-start text-[10px]" disabled={preserving || preservation?.pending === 0} onClick={() => void optimizeAll()}><BrainCircuit className="size-3.5"/>{preserving ? "Optimizing sessions with JEV…" : "Optimize all before cleanup"}</Button>
      {preservation ? <p className="text-[10px] leading-4 text-muted-foreground">JEV {preservation.preservedLive + preservation.preservedArchives}/{preservation.liveSessions + preservation.archives} preserved · {preservation.model}{preservation.openrouterConnected ? " · OpenRouter ready" : " · connect OpenRouter in Settings → AI or Integrations → AI Providers"}</p> : null}
    </div>
    <ScrollArea className="min-h-0 min-w-0 flex-1"><div className="space-y-1.5 p-2.5">
      {error ? <p className="p-2 text-xs text-destructive">{error}</p> : null}
      {!data && !error ? <p className="p-3 text-xs text-muted-foreground">Loading sessions…</p> : null}
      {data?.sessions.map((session) => <button key={session.id} type="button" onClick={() => onSelect(session.id)} aria-pressed={activeId === session.id} title={session.label} className={`w-full min-w-0 rounded-lg border p-2.5 text-left text-xs transition-colors hover:bg-accent/60 ${activeId === session.id ? "bg-accent ring-1 ring-ring/30" : "bg-card"}`}>
        <div className="flex min-w-0 items-start gap-2"><Activity className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"/><div className="min-w-0 flex-1 break-words font-medium leading-4 [overflow-wrap:anywhere]">{session.label}</div><span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] uppercase text-muted-foreground">{session.status}</span></div>
        <p className="mt-1.5 line-clamp-3 break-words pl-5.5 text-[10px] leading-4 text-muted-foreground [overflow-wrap:anywhere]">{session.title}</p>
        <p className="mt-1 pl-5.5 text-[10px] text-muted-foreground">{session.source} · {session.eventCount} events</p>
      </button>)}
      {data && data.sessions.length === 0 && !error ? <p className="p-3 text-xs text-muted-foreground">No matching sessions.</p> : null}
    </div></ScrollArea>
    {data && data.pages > 1 ? <div className="flex shrink-0 items-center justify-between border-t px-2 py-1.5 text-[10px] text-muted-foreground"><Button size="icon" variant="ghost" className="size-7" disabled={data.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft className="size-3.5"/></Button><span className="truncate px-2">Page {data.page} of {data.pages} · {data.total} sessions</span><Button size="icon" variant="ghost" className="size-7" disabled={data.page >= data.pages} onClick={() => setPage((value) => Math.min(data.pages, value + 1))}><ChevronRight className="size-3.5"/></Button></div> : null}
  </div>;
}
