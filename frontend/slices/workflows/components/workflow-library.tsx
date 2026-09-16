"use client";

import { FolderOpen } from "lucide-react";
import type { WorkflowGraph } from "@/lib/contracts/workflow-graph";
import { workflowMatchesQuery, workflowTagQuery } from "@/lib/workflow/search";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
  const filtered = graphs.filter((graph) => workflowMatchesQuery(graph, search));
  return <div className="flex h-full min-h-0 flex-col bg-card/20">
    <div className="space-y-2 border-b p-2"><Input className="h-8" aria-label="Search workflows" placeholder="deploy tag:qa status:active" value={search} onChange={(event) => onSearch(event.target.value)}/><WorkflowCreateDialog onBlank={onBlank} onTemplate={onTemplate} onAI={onAI}/></div>
    <ScrollArea className="min-h-0 flex-1"><div className="space-y-1 p-2">
      {filtered.length === 0 ? <div className="p-3 text-xs text-muted-foreground">No matching private workflows.</div> : null}
      {filtered.map((graph) => <div key={graph.id} className={`rounded-lg border text-xs ${activeId === graph.id ? "bg-accent" : "bg-card"}`}>
        <button type="button" onClick={() => onSelect(graph.id)} className="w-full rounded-lg p-2 text-left transition-colors hover:bg-accent/60" aria-pressed={activeId === graph.id}>
          <div className="flex items-center gap-2"><FolderOpen className="size-3.5 shrink-0 text-muted-foreground"/><div className="min-w-0 flex-1 truncate font-medium">{graph.name}</div></div>
          {graph.description ? <p className="mt-1 line-clamp-2 break-words text-muted-foreground">{graph.description}</p> : null}
          <div className="mt-1 flex flex-wrap gap-1 break-all text-[10px] text-muted-foreground"><span>{graph.status} · {graph.nodes.length} nodes</span>{graph.metadata.folder ? <span>· {graph.metadata.folder}</span> : null}{graph.metadata.project ? <span>· {graph.metadata.project}</span> : null}</div>
        </button>
        {graph.metadata.tags?.length ? <div className="flex flex-wrap gap-1 px-2 pb-2">{graph.metadata.tags.map((tag, index) => <Button key={`${tag}-${index}`} type="button" variant="secondary" size="sm" className="h-auto max-w-full whitespace-normal break-all px-2 py-1 text-[10px]" aria-label={`Filter workflows by tag ${tag}`} onClick={() => onSearch(workflowTagQuery(tag))}>{tag}</Button>)}</div> : null}
      </div>)}
    </div></ScrollArea>
  </div>;
}
