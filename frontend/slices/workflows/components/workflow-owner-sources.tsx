"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { WorkflowDiscoveryPage, WorkflowDiscoveryRow } from "@/lib/contracts/workflow-discovery";
import type { WorkflowGraph } from "@/lib/contracts/workflow-graph";

export function WorkflowOwnerSources({ onSelect, onCopied }: { onSelect: (id: string) => void; onCopied: (graph: WorkflowGraph) => void }) {
  const [offset, setOffset] = useState(0), [query, setQuery] = useState("");
  const [result, setResult] = useState<{ offset: number; page?: WorkflowDiscoveryPage; error?: string } | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const page = result?.offset === offset ? result.page : undefined;
  useEffect(() => {
    let alive = true;
    void fetch(`/api/v1/workflows?owner_view=1&owner_offset=${offset}`, { cache: "no-store" }).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Owner sources unavailable"); return body as WorkflowDiscoveryPage;
    }).then(value => { if (alive) setResult({ offset, page: value }); }, (cause: unknown) => {
      if (alive) setResult({ offset, error: cause instanceof Error ? cause.message : "Owner sources unavailable" });
    });
    return () => { alive = false; };
  }, [offset]);
  const copy = async (row: WorkflowDiscoveryRow) => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/workflows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "owner_clone", origin_owner: row.owner, graph_id: row.id, expected_revision: row.revision, confirm: true }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Copy failed"); onCopied(body.graph);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Copy failed"); }
    finally { setBusy(false); }
  };
  return <div className="flex h-full min-h-0 flex-col gap-2 p-3">
    <h3 className="text-sm font-semibold">Owner sources</h3>
    <p className="text-xs text-muted-foreground">Discover saved workflows from browser and MCP identities. Foreign sources are read-only. Copying creates an inactive draft with action nodes disabled for review; the original is unchanged.</p>
    <Input aria-label="Search owner workflows" placeholder="Search this source page" value={query} onChange={event => setQuery(event.target.value)} />
    {error || result?.error ? <p role="alert" className="text-xs text-destructive-text">{error || result?.error}</p> : null}
    {!page && !result?.error ? <p className="text-xs text-muted-foreground">Loading sources…</p> : null}
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
      {page?.scan.warnings.map(warning => <p key={warning} className="text-xs text-destructive-text">{warning}</p>)}
      {page?.graphs.filter(row => `${row.name} ${row.project ?? ""}`.toLowerCase().includes(query.toLowerCase())).map(row => <div key={`${row.owner}:${row.id}`} className="space-y-1.5 rounded-md border p-2">
        <p className="text-xs font-medium">{row.name}</p>
        <p className="break-all text-[10px] text-muted-foreground">{row.originPrincipal} · {row.status} · {row.nodeCount} nodes</p>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => row.readOnly ? void copy(row) : onSelect(row.id)}>{row.readOnly ? "Copy as review-only draft" : "Open own workflow"}</Button>
      </div>)}
      {page && !page.graphs.length ? <p className="text-xs text-muted-foreground">No saved graphs in this source page.</p> : null}
    </div>
    {page ? <div className="space-y-1 text-xs text-muted-foreground"><p>{page.scan.ownersScanned} identities on this page / {page.scan.totalOwners} discovered</p><div className="flex gap-2"><Button size="sm" variant="outline" disabled={offset === 0 || busy} onClick={() => setOffset(value => Math.max(0, value - 4))}>Previous</Button><Button size="sm" variant="outline" disabled={page.scan.nextOwnerOffset === undefined || busy} onClick={() => setOffset(page.scan.nextOwnerOffset ?? offset)}>Next</Button></div></div> : null}
  </div>;
}
