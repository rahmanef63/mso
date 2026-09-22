"use client";
import { useEffect, useState } from "react";
import { RotateCcw, Square, Trash2 } from "lucide-react";
import type { WorkflowGraph, WorkflowGraphRun } from "@/lib/contracts/workflow-graph";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { deleteRun, listRuns, retryRun, runStatus, stopRun } from "../lib/api";

export function WorkflowRunHistory({graph,onSelect}:{graph:WorkflowGraph;onSelect:(run:WorkflowGraphRun)=>void}){
 const[rows,setRows]=useState<Awaited<ReturnType<typeof listRuns>>["runs"]>([]),[loading,setLoading]=useState(false),[busyId,setBusyId]=useState(""),[error,setError]=useState("");
 const load=async()=>{setLoading(true);setError("");try{setRows((await listRuns(graph.id)).runs);}catch(cause){setError(cause instanceof Error?cause.message:"Could not load executions");}finally{setLoading(false);}};
 useEffect(()=>{let cancelled=false;void Promise.resolve().then(()=>listRuns(graph.id)).then((value)=>{if(!cancelled)setRows(value.runs);}).catch((cause:unknown)=>{if(!cancelled)setError(cause instanceof Error?cause.message:"Could not load executions");}).finally(()=>{if(!cancelled)setLoading(false);});return()=>{cancelled=true;};},[graph.id]);
 const action=async(id:string,fn:()=>Promise<unknown>)=>{setBusyId(id);setError("");try{await fn();await load();}catch(cause){setError(cause instanceof Error?cause.message:"Execution action failed");}finally{setBusyId("");}};
 return <ScrollArea className="h-full"><div className="space-y-2 p-3">
  <div className="flex items-center justify-between"><div><div className="text-xs font-semibold">Executions</div><div className="text-[10px] text-muted-foreground">Inspect, stop, retry, or remove persisted run receipts.</div></div><Button size="sm" variant="ghost" disabled={loading} onClick={()=>void load()}>Refresh</Button></div>
  {error?<p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">{error}</p>:null}
  {rows.length===0&&!loading?<p className="text-xs text-muted-foreground">No executions yet.</p>:null}
  {rows.map((row)=><div key={row.id} className="rounded-xl border bg-card p-2.5">
    <button type="button" className="w-full text-left" onClick={()=>void runStatus(row.id).then(onSelect)}>
      <div className="flex items-center justify-between gap-2"><span className="truncate text-xs font-medium">{new Date(row.startedAt).toLocaleString()}</span><Badge variant="outline">{row.state}</Badge></div>
      <div className="mt-1 text-[10px] text-muted-foreground">{row.trigger?.type??"manual"}{row.failedNodeName?` · ${row.failedNodeName}`:""}</div>
    </button>
    <div className="mt-2 flex flex-wrap gap-1 border-t pt-2">
      {row.state==="running"?<Button size="sm" variant="outline" className="h-7 px-2 text-[10px]" disabled={busyId===row.id} onClick={()=>void action(row.id,()=>stopRun(row.id))}><Square className="mr-1 size-3"/>Stop</Button>:<Button size="sm" variant="outline" className="h-7 px-2 text-[10px]" disabled={busyId===row.id} onClick={()=>void action(row.id,async()=>{const next=await retryRun(row.id);onSelect(next);return next;})}><RotateCcw className="mr-1 size-3"/>Retry</Button>}
      {row.state!=="running"?<Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] text-muted-foreground" disabled={busyId===row.id} onClick={()=>void action(row.id,()=>deleteRun(row.id))}><Trash2 className="mr-1 size-3"/>Delete receipt</Button>:null}
    </div>
  </div>)}
 </div></ScrollArea>;
}
