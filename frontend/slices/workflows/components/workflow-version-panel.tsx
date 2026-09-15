"use client";
import { useEffect, useState } from "react";
import type { WorkflowGraph } from "@/lib/contracts/workflow-graph";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { listVersions, restoreVersion } from "../lib/api";
export function WorkflowVersionPanel({graph,onRestored}:{graph:WorkflowGraph;onRestored:(graph:WorkflowGraph)=>void}){
 const[rows,setRows]=useState<Awaited<ReturnType<typeof listVersions>>>([]),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const load=async()=>setRows(await listVersions(graph.id));useEffect(()=>{let cancelled=false;void listVersions(graph.id).then((value)=>{if(!cancelled)setRows(value);});return()=>{cancelled=true;};},[graph.id]);
 const restore=async(revision:string)=>{setBusy(true);setError("");try{const next=await restoreVersion(graph,revision);onRestored(next);await load();}catch(e){setError(e instanceof Error?e.message:"Restore failed");}finally{setBusy(false);}};
 return <ScrollArea className="h-full"><div className="space-y-2 p-3"><div className="text-xs font-semibold">Version history</div>{error&&<p className="text-xs text-destructive">{error}</p>}{rows.map((row)=><div key={`${row.savedAt}-${row.revision}`} className="rounded-lg border p-2"><div className="text-xs font-medium">{new Date(row.savedAt).toLocaleString()}</div><div className="mt-1 text-[10px] text-muted-foreground">{row.reason} · {row.nodeCount} nodes · {row.revision.slice(0,8)}</div>{row.revision!==graph.revision&&<Button className="mt-2" size="sm" variant="outline" disabled={busy} onClick={()=>void restore(row.revision)}>Restore</Button>}</div>)}</div></ScrollArea>;
}
