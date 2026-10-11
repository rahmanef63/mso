"use client";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AgentVaultNote } from "@/lib/contracts/agent-vault";
import type { MemoryGraphDocument } from "@/lib/memory-graph/types";

/** Reuse Memory's bounded link projection on demand; no graph renderer in the reader bundle. */
export function VaultConnections({ graph, error, onLoad, notes, selectedPath, vaultRoot, onOpen }: {
  graph: MemoryGraphDocument | null; error: string; onLoad: () => void; notes: AgentVaultNote[]; selectedPath: string; vaultRoot: string; onOpen: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (open) onLoad(); }, [open, onLoad]);
  const backlinks = useMemo(() => {
    if (!graph) return [];
    const target = graph.nodes.find(node => node.path === `${vaultRoot}/${selectedPath}`);
    const sources = new Set(graph.edges.filter(edge => edge.target === target?.id && edge.resolved && ["wikilink", "mention"].includes(edge.kind)).map(edge => edge.source));
    const paths = new Set(graph.nodes.filter(node => sources.has(node.id)).map(node => node.path));
    return notes.filter(note => paths.has(`${vaultRoot}/${note.path}`));
  }, [graph, notes, selectedPath, vaultRoot]);
  return <section className="mt-6 border-t pt-3" aria-label="Note backlinks">
    <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>Backlinks{graph ? ` · ${backlinks.length}` : ""}</Button>
    {open ? <div className="mt-2 space-y-2 text-xs">
      {error ? <p role="alert" className="text-destructive">{error}</p> : !graph ? <p role="status" className="text-muted-foreground">Loading connections…</p> : backlinks.length ? backlinks.map(note => <Button key={note.path} size="sm" variant="outline" className="mr-2 max-w-full" onClick={() => onOpen(note.path)}><span className="truncate">{note.title}</span></Button>) : <p className="text-muted-foreground">No backlinks in this snapshot.</p>}
      {graph?.truncated || graph?.warnings.length ? <p className="text-muted-foreground">Connections may be partial. {graph.warnings.join(" · ")}</p> : null}
    </div> : null}
  </section>;
}
