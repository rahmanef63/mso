"use client";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import type { WorkflowGraph } from "@/lib/contracts/workflow-graph";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { aiSuggest, listTemplates } from "../lib/api";
type Definition=Omit<WorkflowGraph,"version"|"id"|"revision"|"createdAt"|"updatedAt">;
export function WorkflowCreateDialog({onBlank,onTemplate,onAI}:{onBlank:()=>Promise<void>;onTemplate:(id:string)=>Promise<void>;onAI:(definition:Definition)=>Promise<void>}){
 const[open,setOpen]=useState(false),[tab,setTab]=useState<"blank"|"templates"|"ai">("templates"),[templates,setTemplates]=useState<Array<{id:string;title:string;description:string;tags:string[];nodeCount:number}>>([]),[prompt,setPrompt]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 useEffect(()=>{if(!open)return;let cancelled=false;void listTemplates().then((rows)=>{if(!cancelled)setTemplates(rows);}).catch(()=>undefined);return()=>{cancelled=true;};},[open]);
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError("");try{await fn();setOpen(false);}catch(e){setError(e instanceof Error?e.message:"Action failed");}finally{setBusy(false);}};
 return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm" variant="outline">New</Button></DialogTrigger><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Create workflow</DialogTitle><DialogDescription>Blank graph, reusable template, or AI-assisted draft. Secrets stay outside definitions.</DialogDescription></DialogHeader><Tabs><TabsList>{(["templates","blank","ai"] as const).map((value)=><TabsTrigger key={value} active={tab===value} onClick={()=>setTab(value)}>{value}</TabsTrigger>)}</TabsList></Tabs>{tab==="blank"&&<div className="rounded-lg border p-4"><p className="mb-3 text-sm text-muted-foreground">Start with Manual Trigger → Output.</p><Button disabled={busy} onClick={()=>void run(onBlank)}>Create blank</Button></div>}{tab==="templates"&&<ScrollArea className="h-72"><div className="grid gap-2 sm:grid-cols-2">{templates.map((item)=><button key={item.id} type="button" disabled={busy} onClick={()=>void run(()=>onTemplate(item.id))} className="rounded-lg border p-3 text-left hover:bg-accent"><div className="text-sm font-semibold">{item.title}</div><p className="mt-1 text-xs text-muted-foreground">{item.description}</p><div className="mt-2 text-[10px] text-muted-foreground">{item.nodeCount} nodes · {item.tags.join(" · ")}</div></button>)}</div></ScrollArea>}{tab==="ai"&&<div className="space-y-3"><Textarea className="min-h-32" placeholder="Describe the workflow, triggers, branches, project/integration actions, and expected output…" value={prompt} onChange={(e)=>setPrompt(e.target.value)}/><Button disabled={busy||!prompt.trim()} onClick={()=>void run(async()=>onAI(await aiSuggest(prompt)))}><Sparkles className="mr-2 size-4"/>Generate draft</Button></div>}{error&&<p className="text-xs text-destructive">{error}</p>}</DialogContent></Dialog>;
}
