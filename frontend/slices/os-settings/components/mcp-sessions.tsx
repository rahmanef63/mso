"use client";
import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SettingsBlock } from "@/features/shell-settings";
import type { SessionPage } from "@/lib/contracts/session-monitor";
import { McpSessionDetail } from "./mcp-session-detail";
import { McpSessionGuide } from "./mcp-session-guide";
import { SessionPaging, sessionTime } from "./mcp-session-paging";
import { useSessionMonitor } from "./use-session-monitor";
export function McpSessions() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [includeOffline, setIncludeOffline] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [guide, setGuide] = useState(false);
  const top = useRef<HTMLDivElement>(null);
  const { data, error, reload } = useSessionMonitor<SessionPage>(`page=${page}&includeOffline=${includeOffline ? 1 : 0}&q=${encodeURIComponent(query)}`);
  function focusTop() { requestAnimationFrame(() => { top.current?.focus(); top.current?.scrollIntoView({ block: "nearest" }); }); }
  function back() { setSelected(null); focusTop(); }
  return <div ref={top} tabIndex={-1} className="min-w-0 space-y-4 outline-none">
    {guide ? <McpSessionGuide sessionId={selected || undefined} onBack={() => { setGuide(false); focusTop(); }} />
      : selected ? <McpSessionDetail key={selected} id={selected} onBack={back} onGuide={() => { setGuide(true); focusTop(); }} />
      : <>
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-base font-semibold">Sessions</h3><Button variant="outline" onClick={() => { setGuide(true); focusTop(); }}>Handover guide</Button></div>
        <p className="text-sm text-muted-foreground">Saved conversations from MCP clients, MSO CLI, and Alfa. History stays available after disconnecting. Active shows recent presence; receiving messages requires a connected receiver.</p>
        <form className="flex gap-2" onSubmit={event => { event.preventDefault(); setQuery(search.trim()); setPage(1); }}><Input type="search" aria-label="Search saved sessions" placeholder="Search title, session, or project" maxLength={200} value={search} onChange={event => { setSearch(event.target.value); if (!event.target.value) { setQuery(""); setPage(1); } }} /><Button type="submit" variant="outline">Search</Button></form>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Session filter">
          {[true, false].map(all => <Button key={String(all)} variant={includeOffline === all ? "secondary" : "ghost"} aria-pressed={includeOffline === all}
            onClick={() => { setIncludeOffline(all); setPage(1); }}>{all ? "All stored" : "Active"}</Button>)}
          <Button variant="ghost" onClick={reload}>Refresh sessions</Button>
        </div>
        {error && <SettingsBlock><p role="alert">{error}</p><Button onClick={reload}>Try again</Button></SettingsBlock>}
        {!data ? !error && <p role="status">Loading sessions…</p> : <>
            <p className="text-xs text-muted-foreground">{data.total} {includeOffline ? "stored" : "active"} · {data.activeCount} active · Checked {sessionTime(data.observedAt)}</p>
            {data.sessions.length ? <div aria-label="Session cards" className="flex min-w-0 flex-col divide-y divide-border">
              {data.sessions.map(session => <Button key={session.id} id={`session-card-${session.id}`} variant="ghost"
                aria-label={`Open session ${session.name}: ${session.title}`} onClick={() => { setSelected(session.id); focusTop(); }}
                className="h-auto min-w-0 flex-col items-start justify-start gap-1 whitespace-normal rounded-none py-3 text-left">
                <span className="flex w-full flex-wrap justify-between gap-2 text-xs font-normal"><span>{session.source === "mcp" ? "External MCP" : session.source === "cli" ? "MSO CLI" : "Alfa"}</span><span>{session.status}</span></span>
                <span className="line-clamp-2 w-full break-words text-sm font-semibold [overflow-wrap:anywhere]">{session.title}</span>
                <span className="break-all text-xs font-normal">@{session.name} · {session.eventCount} events</span>
                <span className="text-xs font-normal text-muted-foreground">{session.receiverConnected ? "Receiver connected" : "No receiver connected"}</span>
                <span className="text-xs font-normal text-muted-foreground">Last seen {sessionTime(session.lastSeenAt)}</span>
              </Button>)}
            </div> : <SettingsBlock><p className="text-sm">{query ? "No sessions match this search. Try the session ID or a shorter title." : includeOffline ? "No stored sessions yet. Connect an MCP client or start an MSO CLI agent." : "No active sessions right now. Open All stored to inspect earlier sessions."}</p></SettingsBlock>}
            <SessionPaging {...data} label="Sessions" onPage={next => { setPage(next); focusTop(); }} />
            {includeOffline && <p className="text-xs text-muted-foreground">Shows all readable saved sessions; archived transcripts are separate. Plain terminal shells without an MSO agent session are not listed.</p>}
          </>}
      </>}
  </div>;
}
