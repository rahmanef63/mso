"use client";
import { useEffect, useState } from "react";
import type { WorkflowGraph, WorkflowGraphRun } from "@/lib/contracts/workflow-graph";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { listRuns, runStatus } from "../lib/api";
export function WorkflowRunHistory({graph,onSelect}:{graph:WorkflowGraph;onSelect:(run:WorkflowGraphRun)=>void}){
 const[rows,setRows]=useState<Awaited<ReturnType<typeof listRuns>>["runs"]>([]),[loading,setLoading]=useState(false);
 const load=async()=>{setLoading(true);try{setRows((await listRuns(graph.id)).runs);}finally{setLoading(false);}};
 useEffect(()=>{let cancelled=false;void Promise.resolve().then(()=>listRuns(graph.id)).then((value)=>{if(!cancelled)setRows(value.runs);}).finally(()=>{if(!cancelled)setLoading(false);});return()=>{cancelled=true;};},[graph.id]);
 return <ScrollArea className="h-full"><div className="space-y-2 p-3"><div className="flex items-center justify-between"><span className="text-xs font-semibold">Execution history</span><Button size="sm" variant="ghost" disabled={loading} onClick={()=>void load()}>Refresh</Button></div>{rows.length===0&&<p className="text-xs text-muted-foreground">No executions yet.</p>}{rows.map((row)=><button key={row.id} type="button" className="w-full rounded-lg border p-2 text-left" onClick={()=>void runStatus(row.id).then(onSelect)}><div className="flex items-center justify-between gap-2"><span className="truncate text-xs font-medium">{new Date(row.startedAt).toLocaleString()}</span><Badge variant="outline">{row.state}</Badge></div><div className="mt-1 text-[10px] text-muted-foreground">{row.trigger?.type??"manual"}{row.failedNodeName?` · ${row.failedNodeName}`:""}</div></button>)}</div></ScrollArea>;
}
