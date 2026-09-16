"use client";

import { ExternalLink, TerminalSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { SessionGraphView } from "@/lib/contracts/session-monitor";
import type { WorkflowGraphNode } from "@/lib/contracts/workflow-graph";

function value(config: Record<string, unknown>, key: string): string | undefined {
  const raw = config[key];
  return typeof raw === "string" && raw ? raw : undefined;
}

export function WorkflowSessionDetails({ view, node, onOpenTerminal }: { view: SessionGraphView; node: WorkflowGraphNode | null; onOpenTerminal: () => void }) {
  const config = node?.config ?? {};
  const terminalContext = config.terminalContext === true;
  return <div className="flex h-full min-h-0 flex-col bg-card/20">
    <div className="border-b p-3">
      <div className="truncate text-sm font-semibold">{view.session.label}</div>
      <div className="mt-1 text-[10px] uppercase text-muted-foreground">{view.session.source} · {view.session.status}</div>
      <p className="mt-2 text-xs text-muted-foreground">Read-only session projection. Tool payloads and raw transcripts are not duplicated into the graph.</p>
      {view.omittedEvents ? <p className="mt-2 text-[10px] text-muted-foreground">Showing the latest {view.shownEvents} of {view.totalEvents} events for canvas performance.</p> : null}
    </div>
    <ScrollArea className="min-h-0 flex-1"><div className="space-y-3 p-3">
      {!node ? <p className="text-xs text-muted-foreground">Select a node to inspect its recorded activity.</p> : <>
        <div><div className="text-[10px] uppercase text-muted-foreground">Node</div><div className="break-words text-sm font-semibold">{node.name}</div></div>
        {value(config, "state") ? <div><div className="text-[10px] uppercase text-muted-foreground">State</div><div className="text-xs">{value(config, "state")}</div></div> : null}
        {value(config, "at") ? <div><div className="text-[10px] uppercase text-muted-foreground">Time</div><time className="text-xs" dateTime={value(config, "at")}>{new Date(value(config, "at")!).toLocaleString()}</time></div> : null}
        {value(config, "detail") ? <div><div className="text-[10px] uppercase text-muted-foreground">Detail</div><p className="whitespace-pre-wrap break-words text-xs [overflow-wrap:anywhere]">{value(config, "detail")}</p></div> : null}
        {view.session.cwd ? <div><div className="text-[10px] uppercase text-muted-foreground">Context</div><p className="break-all text-xs text-muted-foreground">{view.session.cwd}</p></div> : null}
        {terminalContext ? <Button className="w-full" variant="outline" onClick={onOpenTerminal}><TerminalSquare className="size-4"/>Open terminal here<ExternalLink className="ml-auto size-3.5"/></Button> : null}
      </>}
    </div></ScrollArea>
    <div className="border-t p-3 text-[10px] text-muted-foreground">Successful MCP/Alfa workflows continue through MSO&apos;s existing learned-from-session automation pipeline; this view does not duplicate that state.</div>
  </div>;
}
