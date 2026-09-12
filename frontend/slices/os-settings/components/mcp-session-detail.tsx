"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SettingsBlock } from "@/features/shell-settings";
import type { SessionDetail } from "@/lib/contracts/session-monitor";
import { McpCopyField } from "./mcp-copy-field";
import { SessionPaging, sessionTime } from "./mcp-session-paging";
import { useSessionMonitor } from "./use-session-monitor";
export function McpSessionDetail({ id, onBack, onGuide }: { id: string; onBack: () => void; onGuide: () => void }) {
  const [page, setPage] = useState(1);
  const { data, error, reload } = useSessionMonitor<SessionDetail>(`id=${encodeURIComponent(id)}&page=${page}`);
  return <div className="min-w-0 space-y-4">
    <div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={onBack}>Back to sessions</Button><Button variant="outline" onClick={onGuide}>Handover guide</Button></div>
    {error && <SettingsBlock><p role="alert">{error}</p><Button onClick={reload}>Try again</Button></SettingsBlock>}
    {!data ? !error && <p role="status">Loading session…</p> : <>
        <SettingsBlock className="min-w-0 space-y-3">
          <h3 tabIndex={-1} className="break-words text-base font-semibold">{data.session.title}</h3>
          <p className="text-sm">@{data.session.name} · {data.session.source === "mcp" ? "External MCP" : data.session.source === "cli" ? "MSO CLI" : "Alfa"} · {data.session.status}</p>
          <p className="text-sm text-muted-foreground">{data.session.receiverConnected ? "Receiver connected" : "No receiver connected"} · Last seen {sessionTime(data.session.lastSeenAt)}</p>
          <McpCopyField label="Session ID" value={id} />
          {data.session.cwd && <p className="break-all text-sm">Project directory: {data.session.cwd}</p>}
          {data.session.resumedFrom && <McpCopyField label="Resumed from" value={data.session.resumedFrom} />}
          {data.session.parentSessionId && <McpCopyField label="Parent session" value={data.session.parentSessionId} />}
        </SettingsBlock>
        <section aria-label="Session activity log" className="min-w-0 space-y-3">
          <h3 className="text-sm font-semibold">Activity log</h3>
          <p className="text-sm text-muted-foreground">Newest first. Recorded tool and workflow events only; raw arguments, outputs, and private conversations are not shown. Older events may have been compacted ({data.session.archiveCount} archives).</p>
          {data.events.length ? <ol className="space-y-2">{data.events.map((event, index) => <li key={event.at + ":" + index} className="min-w-0 border-b border-border py-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="break-all text-sm font-medium">{(event.tool || event.kind).replaceAll("_", " ")}</span><span className="text-xs">{event.state || event.kind}</span></div>
            <time dateTime={event.at} className="text-xs text-muted-foreground">{sessionTime(event.at)}</time>
            {event.detail && <p className="mt-2 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{event.detail}</p>}
            {event.workflowId && <p className="mt-1 break-all text-xs text-muted-foreground">Workflow: {event.workflowId}</p>}
          </li>)}</ol> : <p className="text-sm">No recorded activity yet.</p>}
          <SessionPaging {...data} label="Events" onPage={setPage} />
        </section>
      </>}
  </div>;
}
