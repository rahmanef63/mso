"use client";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { WorkspaceDocument, WorkspaceNode } from "../../lib/workspace-model";
import { GraphCanvas } from "./graph-canvas";
import { GraphInspector } from "./graph-inspector";
import { viewGraph } from "../lib/view-model";
import type { GraphLayoutName } from "../lib/layout";

export interface WorkspaceGraphProps {
  graph: WorkspaceDocument; busy: boolean; error: string; organization: boolean;
  selected: string | null; onSelect:(id:string)=>void; onOpen:(node:WorkspaceNode)=>void; onReload:()=>void;
}
export function MemoryGraphScreen({graph, busy, error, organization, selected, onSelect, onOpen, onReload}: WorkspaceGraphProps) {
  const [query,setQuery]=useState(""), [layout,setLayout]=useState<GraphLayoutName>(organization?"layered":"web");
  const [local,setLocal]=useState(false), [depth,setDepth]=useState(2), [showGhosts,setShowGhosts]=useState(true), [showTags,setShowTags]=useState(false), [showOrphans,setShowOrphans]=useState(true);
  const [directory,setDirectory]=useState(organization), [hiddenGroups,setHiddenGroups]=useState<string[]>([]);
  const visible=useMemo(()=>viewGraph(graph,{query,showGhosts,showTags,showOrphans,local,depth,focusId:selected,hiddenGroups}),[graph,query,showGhosts,showTags,showOrphans,local,depth,selected,hiddenGroups]);
  const current=graph.nodes.find(node=>node.id===selected)??null;
  const open=(node:WorkspaceNode)=>onOpen(graph.nodes.find(item=>item.id===node.id)??node);
  const select=(id:string)=>{if(id===selected){const node=graph.nodes.find(item=>item.id===id);if(node)open(node);}onSelect(id);};
  return <div data-slot="workspace-graph-view" className="@container flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-3 py-1 [@media(max-height:520px)]:flex-nowrap">
      <Input aria-label="Search graph" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search titles" className="h-8 min-w-24 flex-1"/>
      <Button size="sm" variant="outline" disabled={busy} onClick={onReload}>Load</Button>
      {organization?<Button size="sm" variant="outline" onClick={()=>setDirectory(value=>!value)}>{directory?"Map":"Directory"}</Button>:(["web","radial","layered"] as const).map(name=><Button key={name} size="sm" variant={layout===name?"secondary":"ghost"} onClick={()=>setLayout(name)}>{name}</Button>)}
      <Button size="sm" variant={local?"secondary":"ghost"} onClick={()=>setLocal(value=>!value)}>Local</Button>
      {local?<Input aria-label="Neighbourhood hops" type="number" min={1} max={4} value={depth} onChange={event=>setDepth(Math.max(1,Math.min(4,Number(event.target.value)||1)))} className="h-8 w-14"/>:null}
    </div>
    <p role="status" className="shrink-0 border-b px-3 py-1 text-xs text-muted-foreground">{busy?"Loading connections…":`${visible.nodes.length} nodes${graph.truncated?" · partial":""}`}</p>
    <details className="shrink-0 border-b px-3 py-1 text-xs"><summary className="cursor-pointer">Display options</summary><div className="flex max-h-28 flex-wrap gap-3 overflow-auto py-2">
      {[["Ghosts",showGhosts,setShowGhosts],["Tags",showTags,setShowTags],["Orphans",showOrphans,setShowOrphans]].map(([label,checked,set])=><label key={String(label)} className="flex items-center gap-1"><input type="checkbox" checked={Boolean(checked)} onChange={event=>(set as (value:boolean)=>void)(event.target.checked)}/>{String(label)}</label>)}
      {[...new Set(graph.nodes.map(node=>node.group))].slice(0,12).map(group=><button key={group} type="button" aria-pressed={!hiddenGroups.includes(group)} onClick={()=>setHiddenGroups(values=>values.includes(group)?values.filter(value=>value!==group):[...values,group])} className="rounded border px-2 py-1">{group}</button>)}
    </div>{graph.warnings.length ? <p className="max-h-20 overflow-auto py-1 text-muted-foreground">{graph.warnings.join(" · ")}</p> : null}</details>
    {error?<p role="alert" className="px-3 py-2 text-sm text-destructive">{error}</p>:null}
    <div className="flex min-h-0 flex-1 flex-col @min-[560px]:flex-row">
      <div className="min-h-0 min-w-0 flex-1">
        {directory?<div aria-label="Knowledge structure" className="h-full overflow-y-auto p-3">{[...new Set(visible.nodes.map(node=>node.group))].map(group=><section key={group} className="mb-3 rounded-lg border p-2"><h3 className="mb-1 text-sm font-semibold">{group}</h3>{visible.nodes.filter(node=>node.group===group&&(node.kind!=="folder"||node.targetApp==="organization")).map(node=><button key={node.id} data-node-id={node.id} type="button" aria-pressed={selected===node.id} onClick={()=>select(node.id)} onDoubleClick={()=>open(node)} className="block min-h-10 w-full rounded px-2 py-2 text-left text-sm hover:bg-muted"><span className="block truncate">{node.title}</span><span className="text-xs text-muted-foreground">{node.kind} · {node.degree} links</span></button>)}</section>)}</div>:<GraphCanvas nodes={visible.nodes} edges={visible.edges} layout={layout} selected={selected} onSelect={select} onOpen={open}/>}
        {!visible.nodes.length&&!busy?<p className="p-3 text-sm text-muted-foreground">No matching knowledge.</p>:null}
      </div>
      <div className="max-h-36 shrink-0 overflow-auto border-t @min-[560px]:max-h-none @min-[560px]:w-64 @min-[560px]:border-t-0 @min-[560px]:border-l"><GraphInspector node={current} onOpen={open}/></div>
    </div>
  </div>;
}
