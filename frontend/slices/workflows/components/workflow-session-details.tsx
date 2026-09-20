"use client";

import { useState } from "react";
import { BrainCircuit, Code2, Copy, ExternalLink, FileCode2, GitCompareArrows, History, Save, TerminalSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { SessionFlowAction, SessionFlowStep, SessionGraphView } from "@/lib/contracts/session-monitor";
import type { WorkflowGraphNode } from "@/lib/contracts/workflow-graph";
import { getSessionArtifactHistory, type SessionArtifactHistoryResponse, type WorkflowLearningRecipeSummary } from "../lib/api";

function value(config: Record<string, unknown>, key: string): string | undefined {
  const raw = config[key]; return typeof raw === "string" && raw ? raw : undefined;
}
function ArtifactRevisionInspector({ sessionId, action }: { sessionId: string; action: SessionFlowAction }) {
  const [result, setResult] = useState<SessionArtifactHistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!action.artifact) return null;
  const inspect = async () => {
    setLoading(true); setError(null);
    try { setResult(await getSessionArtifactHistory(sessionId, action.ref)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "artifact history unavailable"); }
    finally { setLoading(false); }
  };
  const history = result?.history;
  return <div data-slot="session-artifact-history" className="space-y-2">
    <Button type="button" size="sm" variant="outline" className="h-7 text-[10px]" disabled={loading} onClick={() => void inspect()}>
      <History className="size-3.5"/>{loading ? "Checking revision…" : result ? "Refresh revision" : "Inspect revision"}
    </Button>
    {error ? <p className="text-[10px] text-destructive">{error}</p> : null}
    {history ? <div className="space-y-1.5 rounded-md border bg-muted/20 p-2 text-[10px]">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="h-5 px-1.5 text-[9px]">{history.capture.state === "legacy" ? "legacy · no proof" : history.capture.exactAtCapture ? "exact capture" : "capture proof"}</Badge>
        {history.capture.sha256 ? <code className="text-[9px] text-muted-foreground">sha256 {history.capture.sha256.slice(0, 12)}</code> : null}
        {history.capture.gitHead ? <code className="text-[9px] text-muted-foreground">git {history.capture.gitHead.slice(0, 12)}</code> : null}
      </div>
      <p className="text-muted-foreground">{history.capture.state === "legacy" ? "This older action predates artifact capture proof, so MSO will not guess a historical snapshot." : history.historical.available ? "Historical identity is proven. Source previews below are redacted before display." : "Capture metadata exists, but an exact historical body is no longer provable."}</p>
      {history.current.available ? <p className="text-muted-foreground">Current file · {history.current.matchesCapture ? "matches captured revision" : "changed since capture"} · {history.current.bytes ?? 0} bytes</p> : <p className="text-muted-foreground">Current file is unavailable.</p>}
      {history.historical.available ? <details data-slot="session-artifact-snapshot" className="rounded border bg-background/40">
        <summary className="cursor-pointer px-2 py-1.5 font-medium">Historical snapshot · exact · {history.historical.source}</summary>
        <div className="border-t p-2">{history.historical.truncated ? <p className="text-muted-foreground">Exact hash/size retained; preview omitted because the snapshot exceeds the preview limit.</p> : <pre className="max-h-56 overflow-auto whitespace-pre p-2 font-mono text-[10px] leading-4"><code>{history.historical.content ?? ""}</code></pre>}</div>
      </details> : null}
      {history.diff.available ? <details data-slot="session-artifact-diff" className="rounded border bg-background/40">
        <summary className="flex cursor-pointer items-center gap-1.5 px-2 py-1.5 font-medium"><GitCompareArrows className="size-3"/>Historical ↔ current · {history.diff.changed ? "changed" : "no changes"}</summary>
        <div className="border-t p-2"><pre className="max-h-64 overflow-auto whitespace-pre p-2 font-mono text-[10px] leading-4"><code>{history.diff.unifiedDiff || "No changes."}</code></pre></div>
      </details> : null}
    </div> : null}
  </div>;
}

function actionReceipt(action: SessionFlowAction, sessionId: string, onOpenTerminal: () => void, onOpenCode: (path: string) => void) {
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
      {action.artifact ? <ArtifactRevisionInspector sessionId={sessionId} action={action}/> : null}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-muted-foreground"><span>{new Date(action.at).toLocaleString()}</span><span>{action.eventRef}</span>{action.artifact ? <span className="break-all">{action.artifact.relativePath} · revision {action.artifact.revisionRef}</span> : null}</div>
    </div>
  </details>;
}

function actionGroups(step: SessionFlowStep, sessionId: string, onOpenTerminal: () => void, onOpenCode: (path: string) => void) {
  return step.groups.map((group) => {
    const refs = new Set(group.actionRefs);
    const actions = step.actions.filter((action) => refs.has(action.ref));
    return <details key={group.ref} data-slot="session-action-group" data-action-group-ref={group.ref} className="rounded-lg border bg-muted/15">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-2 text-xs marker:hidden">
        <span className="min-w-0 flex-1 truncate font-medium">{group.title}</span>
        <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[9px]">{group.count}</Badge>
      </summary>
      <div className="space-y-1.5 border-t p-2">{actions.map((action) => actionReceipt(action, sessionId, onOpenTerminal, onOpenCode))}</div>
    </details>;
  });
}

function SelfImprove({ recipes }: { recipes: WorkflowLearningRecipeSummary[] }) {
  return <div data-slot="session-self-improve" className="border-t pt-3">
    <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase text-muted-foreground"><BrainCircuit className="size-3.5"/>Self-improve</div>
    {recipes.length ? <div className="space-y-2">{recipes.slice(0, 4).map((recipe) => <div key={recipe.id} className="rounded-lg border bg-background/35 p-2.5">
      <div className="flex flex-wrap items-center gap-1.5"><Badge variant="outline" className="h-5 text-[9px] capitalize">{recipe.stage}</Badge><span className="min-w-0 flex-1 truncate text-xs font-medium">{recipe.intent}</span></div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground"><span>{recipe.attempts} attempts</span><span>{recipe.successRate}% success</span>{recipe.fastestDurationMs != null ? <span>fastest {Math.max(1, Math.round(recipe.fastestDurationMs / 1000))}s</span> : null}</div>
      <div className="mt-1.5 flex flex-wrap gap-1">{recipe.sourceSessions.filter((source, index, rows) => rows.findIndex((row) => row.actionRef === source.actionRef) === index).slice(0, 8).map((source) => <code key={`${source.actionRef}-${source.eventRef}`} className="rounded bg-muted px-1.5 py-0.5 text-[9px]">{source.actionRef}</code>)}</div>
      <p className="mt-1.5 text-[9px] text-muted-foreground">{recipe.stage === "tested" ? "Tested automation is reusable when current evidence matches." : recipe.stage === "verified" ? "Verified route; current task still requires independent verification." : recipe.stage === "candidate" ? "Repeated route; use as a planning shortcut, not a guarantee." : "Observed route; more successful runs are needed."}{recipe.forge.eligible ? " Skill/tool promotion remains explicit through Tool Forge." : ""}</p>
    </div>)}</div> : <p className="rounded-lg border border-dashed p-2.5 text-[10px] text-muted-foreground">No learned recipe is linked to this session yet. A verified <code>workflow_finish</code> can attach future recipe steps to their <code>Sx.Ay</code> receipts.</p>}
  </div>;
}

export function WorkflowSessionDetails({ view, node, onOpenTerminal, onOpenCode, onSaveDraft, savingDraft = false, learning = [] }: { view: SessionGraphView; node: WorkflowGraphNode | null; onOpenTerminal: () => void; onOpenCode: (path: string) => void; onSaveDraft: (stepRef?: string) => void; savingDraft?: boolean; learning?: WorkflowLearningRecipeSummary[] }) {
  const ref = node ? value(node.config, "ref") : undefined;
  const step: SessionFlowStep | undefined = ref ? view.steps.find((item) => item.ref === ref) : undefined;
  const linked = learning.filter((recipe) => recipe.sourceSessions.some((source) => source.label === view.session.label));
  return <div className="flex h-full min-h-0 flex-col bg-card/20">
    <div className="border-b p-3">
      <div className="break-words text-sm font-semibold">{view.session.label}</div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] uppercase text-muted-foreground"><span>{view.session.source}</span><span>·</span><span>{view.session.status}</span><Badge variant="outline" className="h-5 px-1.5 text-[9px] normal-case">{view.steps.length} semantic steps</Badge></div>
      <p className="mt-2 text-xs text-muted-foreground">Canvas shows intent-level steps. Click a step to inspect its grouped actions, commands, code, artifacts, and raw execution receipt.</p>
      {view.omittedEvents ? <p className="mt-2 text-[10px] text-muted-foreground">Projection uses the latest {view.shownEvents} of {view.totalEvents} events to stay fast. Raw session history remains the source of truth.</p> : null}
    </div>
    <ScrollArea className="min-h-0 flex-1"><div className="space-y-3 p-3">
      {!node || node.id === "session-root" ? <><div><div className="text-[10px] uppercase text-muted-foreground">Flow</div><div className="mt-1 text-sm font-semibold">{view.session.title}</div><Button data-slot="save-session-workflow-draft" type="button" size="sm" variant="outline" className="mt-2 h-7 text-[10px]" disabled={savingDraft} onClick={() => onSaveDraft()}><Save className="size-3.5"/>Save session as workflow draft</Button><p className="mt-1.5 max-w-sm text-[10px] text-muted-foreground">Saved Session workflows can be reused by workflow ID in Subflow or Repeat Until nodes.</p></div><div className="space-y-1.5">{view.steps.map((item) => <div key={item.ref} className="rounded-lg border bg-background/35 p-2"><div className="flex items-center gap-2"><code className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold">{item.ref}</code><span className="text-xs font-medium">{item.title}</span><span className="ml-auto text-[10px] text-muted-foreground">{item.actions.length} actions</span></div><p className="mt-1 text-[10px] text-muted-foreground">{item.summary}</p></div>)}</div></> : step ? <>
        <div><div className="flex items-center gap-2"><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold">{step.ref}</code><Badge variant="outline" className="text-[9px] capitalize">{step.category}</Badge></div><div className="mt-2 break-words text-sm font-semibold">{step.title}</div><p className="mt-1 text-xs text-muted-foreground">{step.summary}</p><Button data-slot="save-step-workflow-draft" type="button" size="sm" variant="outline" className="mt-2 h-7 text-[10px]" disabled={savingDraft} onClick={() => onSaveDraft(step.ref)}><Save className="size-3.5"/>Save {step.ref} as workflow draft</Button></div>
        <div className="border-t pt-3"><div className="mb-2 flex items-center justify-between"><div className="text-[10px] font-semibold uppercase text-muted-foreground">Action groups</div><span className="text-[10px] text-muted-foreground">{step.groups.length} groups · {step.actions.length} actions</span></div><div className="space-y-1.5">{actionGroups(step, view.session.id, onOpenTerminal, onOpenCode)}</div></div>
      </> : <p className="text-xs text-muted-foreground">Select a semantic step to inspect its actions.</p>}
      <SelfImprove recipes={linked}/>
      {view.session.cwd ? <div className="border-t pt-3"><div className="text-[10px] uppercase text-muted-foreground">Session context</div><p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{view.session.cwd}</p></div> : null}
    </div></ScrollArea>
    <div className="border-t p-3 text-[10px] text-muted-foreground">Use references such as <code>S3.A4</code> when discussing a specific action. MSO keeps internal session IDs hidden from this surface.</div>
  </div>;
}
