"use client";

import { Code2, Copy, ExternalLink, FileCode2, TerminalSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { SessionFlowAction, SessionFlowStep, SessionGraphView } from "@/lib/contracts/session-monitor";
import type { WorkflowGraphNode } from "@/lib/contracts/workflow-graph";

function value(config: Record<string, unknown>, key: string): string | undefined {
  const raw = config[key]; return typeof raw === "string" && raw ? raw : undefined;
}
function actionReceipt(action: SessionFlowAction, onOpenTerminal: () => void, onOpenCode: (path: string) => void) {
  return <details key={action.ref} data-slot="session-action" data-action-ref={action.ref} className="group rounded-lg border bg-background/35">
    <summary data-slot="session-action-summary" aria-label={`Inspect action ${action.ref}: ${action.title}`} className="flex cursor-pointer list-none items-start gap-2 p-2.5 text-xs marker:hidden">
      <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold">{action.ref}</code>
      <div className="min-w-0 flex-1"><div className="break-words font-medium leading-4">{action.title}</div><div className="mt-0.5 text-[10px] text-muted-foreground">{action.tool || action.kind}{action.state ? ` · ${action.state}` : ""}</div></div>
    </summary>
    <div className="space-y-2 border-t p-2.5">
      {action.detail ? <div><div className="text-[10px] uppercase text-muted-foreground">Detail</div><p className="mt-1 whitespace-pre-wrap break-words text-[11px] [overflow-wrap:anywhere]">{action.detail}</p></div> : null}
      {action.code ? <div className="overflow-hidden rounded-md border bg-muted/30"><div className="flex items-center gap-2 border-b px-2 py-1 text-[10px] text-muted-foreground"><Code2 className="size-3"/><span>{action.code.kind} · {action.code.language}</span><Button type="button" variant="ghost" size="icon" className="ml-auto size-6" aria-label={`Copy ${action.ref} code`} onClick={() => void navigator.clipboard?.writeText(action.code!.content)}><Copy className="size-3"/></Button></div><pre className="max-h-56 overflow-auto whitespace-pre p-2.5 font-mono text-[10px] leading-4"><code>{action.code.content}</code></pre></div> : null}
      <div className="flex flex-wrap gap-1.5">
        {action.terminalContext ? <Button type="button" size="sm" variant="outline" className="h-7 text-[10px]" onClick={onOpenTerminal}><TerminalSquare className="size-3.5"/>Open terminal here<ExternalLink className="size-3"/></Button> : null}
        {action.artifact ? <Button type="button" size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => onOpenCode(action.artifact!.path)}><FileCode2 className="size-3.5"/>Open {action.artifact.label} in Code<ExternalLink className="size-3"/></Button> : null}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-muted-foreground"><span>{new Date(action.at).toLocaleString()}</span><span>{action.eventRef}</span>{action.artifact ? <span className="break-all">{action.artifact.path}</span> : null}</div>
    </div>
  </details>;
}

export function WorkflowSessionDetails({ view, node, onOpenTerminal, onOpenCode }: { view: SessionGraphView; node: WorkflowGraphNode | null; onOpenTerminal: () => void; onOpenCode: (path: string) => void }) {
  const ref = node ? value(node.config, "ref") : undefined;
  const step: SessionFlowStep | undefined = ref ? view.steps.find((item) => item.ref === ref) : undefined;
  return <div className="flex h-full min-h-0 flex-col bg-card/20">
    <div className="border-b p-3">
      <div className="break-words text-sm font-semibold">{view.session.label}</div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] uppercase text-muted-foreground"><span>{view.session.source}</span><span>·</span><span>{view.session.status}</span><Badge variant="outline" className="h-5 px-1.5 text-[9px] normal-case">{view.steps.length} semantic steps</Badge></div>
      <p className="mt-2 text-xs text-muted-foreground">Canvas shows intent-level steps. Click a step to inspect its grouped actions, commands, code, artifacts, and raw execution receipt.</p>
      {view.omittedEvents ? <p className="mt-2 text-[10px] text-muted-foreground">Projection uses the latest {view.shownEvents} of {view.totalEvents} events to stay fast. Raw session history remains the source of truth.</p> : null}
    </div>
    <ScrollArea className="min-h-0 flex-1"><div className="space-y-3 p-3">
      {!node || node.id === "session-root" ? <><div><div className="text-[10px] uppercase text-muted-foreground">Flow</div><div className="mt-1 text-sm font-semibold">{view.session.title}</div></div><div className="space-y-1.5">{view.steps.map((item) => <div key={item.ref} className="rounded-lg border bg-background/35 p-2"><div className="flex items-center gap-2"><code className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold">{item.ref}</code><span className="text-xs font-medium">{item.title}</span><span className="ml-auto text-[10px] text-muted-foreground">{item.actions.length} actions</span></div><p className="mt-1 text-[10px] text-muted-foreground">{item.summary}</p></div>)}</div></> : step ? <>
        <div><div className="flex items-center gap-2"><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold">{step.ref}</code><Badge variant="outline" className="text-[9px] capitalize">{step.category}</Badge></div><div className="mt-2 break-words text-sm font-semibold">{step.title}</div><p className="mt-1 text-xs text-muted-foreground">{step.summary}</p></div>
        <div className="border-t pt-3"><div className="mb-2 flex items-center justify-between"><div className="text-[10px] font-semibold uppercase text-muted-foreground">Actions</div><span className="text-[10px] text-muted-foreground">{step.actions.length}</span></div><div className="space-y-1.5">{step.actions.map((action) => actionReceipt(action, onOpenTerminal, onOpenCode))}</div></div>
      </> : <p className="text-xs text-muted-foreground">Select a semantic step to inspect its actions.</p>}
      {view.session.cwd ? <div className="border-t pt-3"><div className="text-[10px] uppercase text-muted-foreground">Session context</div><p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{view.session.cwd}</p></div> : null}
    </div></ScrollArea>
    <div className="border-t p-3 text-[10px] text-muted-foreground">Use references such as <code>S3.A4</code> when discussing a specific action. MSO keeps internal session IDs hidden from this surface.</div>
  </div>;
}
