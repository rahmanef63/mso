"use client";

import { useEffect, useState } from "react";
import { Activity, ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { SessionPage } from "@/lib/contracts/session-monitor";
import { listWorkflowSessions } from "../lib/api";

export function WorkflowSessionLibrary({ activeId, onSelect }: { activeId?: string; onSelect: (id: string) => void }) {
  const [search, setSearch] = useState(""), [query, setQuery] = useState(""), [page, setPage] = useState(1);
  const [data, setData] = useState<SessionPage | null>(null), [error, setError] = useState(""), [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    setError("");
    void listWorkflowSessions(page, query).then((value) => { if (alive) setData(value); }).catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : "Sessions unavailable"); });
    return () => { alive = false; };
  }, [page, query, nonce]);
  return <div className="flex h-full min-h-0 flex-col bg-card/20">
    <div className="space-y-2 border-b p-2">
      <form className="flex gap-1" onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(search.trim()); }}>
        <div className="relative min-w-0 flex-1"><Search className="absolute left-2 top-2.5 size-3 text-muted-foreground"/><Input className="h-8 pl-7" aria-label="Search sessions" placeholder="agent-context" value={search} onChange={(event) => { setSearch(event.target.value); if (!event.target.value) { setPage(1); setQuery(""); } }}/></div>
        <Button type="submit" variant="outline" size="icon" className="size-8" aria-label="Search sessions"><Search className="size-3.5"/></Button>
        <Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Refresh sessions" onClick={() => setNonce((value) => value + 1)}><RefreshCw className="size-3.5"/></Button>
      </form>
      <p className="text-[10px] text-muted-foreground">Read-only execution history. Labels use agent-context, while internal IDs stay hidden.</p>
    </div>
    <ScrollArea className="min-h-0 flex-1"><div className="space-y-1 p-2">
      {error ? <p className="p-2 text-xs text-destructive">{error}</p> : null}
      {!data && !error ? <p className="p-3 text-xs text-muted-foreground">Loading sessions…</p> : null}
      {data?.sessions.map((session) => <button key={session.id} type="button" onClick={() => onSelect(session.id)} aria-pressed={activeId === session.id} className={`w-full rounded-lg border p-2 text-left text-xs transition-colors hover:bg-accent/60 ${activeId === session.id ? "bg-accent" : "bg-card"}`}>
        <div className="flex items-center gap-2"><Activity className="size-3.5 shrink-0 text-muted-foreground"/><div className="min-w-0 flex-1 truncate font-medium">{session.label}</div><span className="shrink-0 text-[9px] uppercase text-muted-foreground">{session.status}</span></div>
        <p className="mt-1 line-clamp-2 break-words text-[10px] text-muted-foreground">{session.title}</p>
        <p className="mt-1 text-[10px] text-muted-foreground">{session.source} · {session.eventCount} events</p>
      </button>)}
      {data && data.sessions.length === 0 && !error ? <p className="p-3 text-xs text-muted-foreground">No matching sessions.</p> : null}
    </div></ScrollArea>
    {data && data.pages > 1 ? <div className="flex items-center justify-between border-t p-2 text-[10px] text-muted-foreground"><Button size="icon" variant="ghost" className="size-7" disabled={data.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft className="size-3.5"/></Button><span>{data.page} / {data.pages}</span><Button size="icon" variant="ghost" className="size-7" disabled={data.page >= data.pages} onClick={() => setPage((value) => Math.min(data.pages, value + 1))}><ChevronRight className="size-3.5"/></Button></div> : null}
  </div>;
}
