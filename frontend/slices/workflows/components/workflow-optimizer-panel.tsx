"use client";

import { useState } from "react";
import type { WorkflowGraph } from "@/lib/contracts/workflow-graph";
import type { WorkflowOptimizationPreview } from "@/lib/workflow/graph-optimizer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { optimizeGraphClone, optimizeGraphPreview, type WorkflowOptimizeOptions } from "../lib/api";

const inputClass = "h-8 text-xs";

export function WorkflowOptimizerPanel({ graph, onCloned }: {
  graph: WorkflowGraph;
  onCloned: (graph: WorkflowGraph) => void;
}) {
  const [mode, setMode] = useState<"deterministic" | "jev">("deterministic");
  const [user, setUser] = useState("");
  const [connection, setConnection] = useState("");
  const [applyReview, setApplyReview] = useState(false);
  const [preview, setPreview] = useState<WorkflowOptimizationPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const options = (): WorkflowOptimizeOptions => ({
    mode,
    applyReview,
    ...(mode === "jev" ? {
      jev: user.trim() && connection.trim()
        ? { user: user.trim(), connection: connection.trim() }
        : { variable: "JEV" },
    } : {}),
  });

  const hasUser = Boolean(user.trim());
  const hasConnection = Boolean(connection.trim());
  const valid = mode === "deterministic" || hasUser === hasConnection;
  const analyze = async () => {
    setBusy(true); setMessage("");
    try { setPreview(await optimizeGraphPreview(graph, options())); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Optimization failed"); }
    finally { setBusy(false); }
  };
  const createDraft = async () => {
    setBusy(true); setMessage("");
    try {
      const result = await optimizeGraphClone(graph, options());
      setPreview(result.optimization);
      onCloned(result.graph);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not create optimized draft"); }
    finally { setBusy(false); }
  };

  return <div className="flex h-full min-h-0 flex-col overflow-y-auto p-3 text-sm">
    <div className="space-y-1">
      <div className="font-semibold">Flow Optimizer</div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Analyze first. The source workflow is never overwritten; Apply creates a new draft.
      </p>
    </div>

    <div className="mt-4 space-y-3 rounded-lg border bg-card/40 p-3">
      <label className="grid gap-1 text-xs font-medium">
        Decision mode
        <select className="h-8 rounded-md border bg-background px-2 text-xs" value={mode} onChange={(event) => { setMode(event.target.value as "deterministic" | "jev"); setPreview(null); }}>
          <option value="deterministic">MSO deterministic</option>
          <option value="jev">Jev decision kernel</option>
        </select>
      </label>
      {mode === "jev" ? <div className="grid gap-2">
        <div className="rounded-md border border-dashed p-2 text-[11px] leading-relaxed text-muted-foreground">
          Uses Integrations variable <b className="text-foreground">JEV</b> by default. The variable only points to a named MCP connection; endpoint and token remain private in Integrations.
        </div>
        <details className="rounded-md border p-2">
          <summary className="cursor-pointer text-xs font-medium">Override JEV connection</summary>
          <div className="mt-2 grid gap-2">
            <Input className={inputClass} value={user} onChange={(event) => setUser(event.target.value)} placeholder="Credential user ID"/>
            <Input className={inputClass} value={connection} onChange={(event) => setConnection(event.target.value)} placeholder="MCP connection ID"/>
            {hasUser !== hasConnection ? <p className="text-[11px] text-destructive">Fill both override fields, or leave both empty to use JEV.</p> : null}
          </div>
        </details>
      </div> : null}
      <label className="flex items-start gap-2 text-xs">
        <input className="mt-0.5" type="checkbox" checked={applyReview} onChange={(event) => { setApplyReview(event.target.checked); setPreview(null); }}/>
        <span><b>Include review transformations</b><span className="mt-0.5 block font-normal text-muted-foreground">Allows structural compaction such as repeated read-only calls → one sequential Loop node. Safe presentation-only groups do not need this.</span></span>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy || !valid} onClick={() => void analyze()}>{busy ? "Analyzing…" : "Analyze"}</Button>
        <Button size="sm" disabled={busy || !valid} onClick={() => void createDraft()}>Create optimized draft</Button>
      </div>
      {message ? <p className="text-xs text-destructive">{message}</p> : null}
    </div>

    {preview ? <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{preview.provider}</Badge>
        <Badge variant="outline">{preview.summary.selectedCount}/{preview.summary.candidateCount} selected</Badge>
        <Badge variant="outline">{preview.summary.nodeReduction} node reduction</Badge>
      </div>
      {preview.fallbackReason ? <div className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">Jev unavailable; deterministic fallback used: {preview.fallbackReason}</div> : null}
      {preview.shadow ? <div className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">Shadow agreement vs deterministic baseline: <b className="text-foreground">{Math.round(preview.shadow.agreement * 100)}%</b>{preview.shadow.disagreements.length ? ` · disagreements: ${preview.shadow.disagreements.join(", ")}` : " · no decision disagreement"}</div> : null}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md border p-2"><div className="text-muted-foreground">Nodes</div><div className="mt-1 font-medium">{preview.summary.beforeNodes} → {preview.summary.afterNodes}</div></div>
        <div className="rounded-md border p-2"><div className="text-muted-foreground">Visual groups</div><div className="mt-1 font-medium">+{preview.summary.visualGroupsAdded}</div></div>
      </div>
      <div className="space-y-2">
        {preview.candidates.length ? preview.candidates.map((candidate) => <div key={candidate.id} className="rounded-md border p-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 font-medium">{candidate.title}</div>
            <div className="flex shrink-0 gap-1"><Badge variant="outline">{candidate.risk}</Badge>{candidate.probability !== undefined ? <Badge variant="outline">{Math.round(candidate.probability * 100)}%</Badge> : null}</div>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{candidate.description}</p>
          <p className="mt-1 text-[11px]">{candidate.selected ? "Selected" : candidate.reason ?? "Not selected"}</p>
        </div>) : <p className="text-xs text-muted-foreground">No safe compaction candidate found for this graph.</p>}
      </div>
    </div> : null}
  </div>;
}
