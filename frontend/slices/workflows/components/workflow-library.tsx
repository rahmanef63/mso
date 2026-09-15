"use client";

import { FolderOpen } from "lucide-react";
import type { WorkflowGraph } from "@/lib/contracts/workflow-graph";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WorkflowCreateDialog } from "./workflow-create-dialog";

type Definition = Omit<WorkflowGraph, "version" | "id" | "revision" | "createdAt" | "updatedAt">;

export function WorkflowLibrary({ graphs, activeId, search, onSearch, onSelect, onBlank, onTemplate, onAI }: {
  graphs: WorkflowGraph[];
  activeId?: string;
  search: string;
  onSearch: (value: string) => void;
  onSelect: (id: string) => void;
  onBlank: () => Promise<void>;
  onTemplate: (id: string) => Promise<void>;
  onAI: (definition: Definition) => Promise<void>;
}) {
  const query = search.toLowerCase().trim();
  const filtered = graphs.filter((graph) => !query || `${graph.name} ${graph.metadata.folder ?? ""} ${(graph.metadata.tags ?? []).join(" ")}`.toLowerCase().includes(query));
  return <div className="flex h-full min-h-0 flex-col bg-card/20">
    <div className="space-y-2 border-b p-2"><Input className="h-8" placeholder="Search workflows…" value={search} onChange={(event) => onSearch(event.target.value)}/><WorkflowCreateDialog onBlank={onBlank} onTemplate={onTemplate} onAI={onAI}/></div>
    <ScrollArea className="min-h-0 flex-1"><div className="space-y-1 p-2">{filtered.length === 0 ? <div className="p-3 text-xs text-muted-foreground">No matching private workflows.</div> : null}{filtered.map((graph) => <button key={graph.id} type="button" onClick={() => onSelect(graph.id)} className={`w-full rounded-lg border p-2 text-left text-xs transition-colors ${activeId === graph.id ? "bg-accent" : "bg-card hover:bg-accent/60"}`}><div className="flex items-center gap-2"><FolderOpen className="size-3.5 shrink-0 text-muted-foreground"/><div className="min-w-0 flex-1 truncate font-medium">{graph.name}</div></div><div className="mt-1 flex flex-wrap gap-1 pl-5 text-[10px] text-muted-foreground"><span>{graph.status} · {graph.nodes.length} nodes</span>{graph.metadata.folder ? <span>· {graph.metadata.folder}</span> : null}</div></button>)}</div></ScrollArea>
  </div>;
}
