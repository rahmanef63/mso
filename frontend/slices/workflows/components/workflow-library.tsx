"use client";

import { CircleDot, FolderOpen, Search, Workflow } from "lucide-react";
import type { WorkflowGraph } from "@/lib/contracts/workflow-graph";
import type { WorkflowDefinition } from "../lib/portability";
import { workflowMatchesQuery, workflowTagQuery } from "@/lib/workflow/search";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WorkflowCreateDialog } from "./workflow-create-dialog";

export function WorkflowLibrary({ graphs, activeId, search, onSearch, onSelect, onBlank, onTemplate, onAI, onImport }: {
  graphs: WorkflowGraph[];
  activeId?: string;
  search: string;
  onSearch: (value: string) => void;
  onSelect: (id: string) => void;
  onBlank: () => Promise<void>;
  onTemplate: (id: string) => Promise<void>;
  onAI: (definition: WorkflowDefinition) => Promise<void>;
  onImport: (definition: WorkflowDefinition) => Promise<void>;
}) {
  const filtered = graphs.filter((graph) => workflowMatchesQuery(graph, search));
  const activeCount = graphs.filter((graph) => graph.status === "active").length;
  return <div className="flex h-full min-h-0 flex-col bg-card/20">
    <div className="space-y-2.5 border-b p-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1"><div className="text-xs font-semibold">Automation library</div><div className="mt-0.5 text-[10px] text-muted-foreground">{graphs.length} workflows · {activeCount} active</div></div>
        <WorkflowCreateDialog onBlank={onBlank} onTemplate={onTemplate} onAI={onAI} onImport={onImport}/>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"/>
        <Input className="h-8 pl-8 text-xs" aria-label="Search workflows" placeholder="Search or use tag:, status:, project:…" value={search} onChange={(event) => onSearch(event.target.value)}/>
      </div>
    </div>
    <ScrollArea className="min-h-0 flex-1"><div className="space-y-2 p-2.5">
      {filtered.length === 0 ? <div className="grid min-h-32 place-items-center rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">No workflows match this filter.</div> : null}
      {filtered.map((graph) => <div key={graph.id} className={`overflow-hidden rounded-xl border text-xs shadow-sm transition ${activeId === graph.id ? "border-foreground/20 bg-accent/75" : "bg-card hover:bg-accent/35"}`}>
        <button type="button" onClick={() => onSelect(graph.id)} className="w-full p-3 text-left" aria-pressed={activeId === graph.id}>
          <div className="flex items-start gap-2.5">
            <div className="grid size-8 shrink-0 place-items-center rounded-lg border bg-muted/40"><Workflow className="size-3.5 text-muted-foreground"/></div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5"><div className="min-w-0 flex-1 truncate font-semibold">{graph.name}</div><Badge variant={graph.status === "active" ? "secondary" : "outline"} className="shrink-0 text-[9px]">{graph.status}</Badge></div>
              {graph.description ? <p className="mt-1 line-clamp-2 break-words text-[11px] leading-4 text-muted-foreground">{graph.description}</p> : null}
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><CircleDot className="size-3"/>{graph.nodes.length} nodes</span>
            {graph.metadata.folder ? <span className="inline-flex min-w-0 items-center gap-1"><FolderOpen className="size-3"/><span className="max-w-28 truncate">{graph.metadata.folder}</span></span> : null}
            {graph.metadata.project ? <span className="max-w-28 truncate">project: {graph.metadata.project}</span> : null}
          </div>
        </button>
        {graph.metadata.tags?.length ? <div className="flex flex-wrap gap-1 border-t px-3 py-2">{graph.metadata.tags.map((tag, index) => <Button key={`${tag}-${index}`} type="button" variant="ghost" size="sm" className="h-6 max-w-full rounded-md px-1.5 text-[9px]" aria-label={`Filter workflows by tag ${tag}`} onClick={() => onSearch(workflowTagQuery(tag))}>#{tag}</Button>)}</div> : null}
      </div>)}
    </div></ScrollArea>
  </div>;
}
