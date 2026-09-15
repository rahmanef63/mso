"use client";
import { useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import type { WorkflowGraphNodeType } from "@/lib/contracts/workflow-graph";
import type { WorkflowNodeCatalogItem } from "@/lib/workflow/node-catalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { listNodeCatalog } from "../lib/api";
export function WorkflowNodePalette({onAdd}:{onAdd:(type:WorkflowGraphNodeType,defaults:Record<string,unknown>)=>void}){
 const[open,setOpen]=useState(false),[query,setQuery]=useState(""),[items,setItems]=useState<WorkflowNodeCatalogItem[]>([]);
 useEffect(()=>{let cancelled=false;void listNodeCatalog().then((rows)=>{if(!cancelled)setItems(rows);}).catch(()=>undefined);return()=>{cancelled=true;};},[]);
 const filtered=useMemo(()=>{const q=query.toLowerCase().trim();return items.filter((item)=>!q||`${item.title} ${item.type} ${item.category} ${item.description}`.toLowerCase().includes(q));},[items,query]);
 return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button size="sm" variant="outline"><Plus className="mr-1 size-3"/>Node</Button></PopoverTrigger><PopoverContent align="start" className="w-80 p-2"><div className="relative mb-2"><Search className="absolute left-2 top-2.5 size-3 text-muted-foreground"/><Input className="pl-7" placeholder="Search nodes…" value={query} onChange={(e)=>setQuery(e.target.value)}/></div><ScrollArea className="h-80"><div className="space-y-1">{filtered.map((item)=><button key={item.type} type="button" className="w-full rounded-md border p-2 text-left hover:bg-accent" onClick={()=>{onAdd(item.type,item.defaults);setOpen(false);setQuery("");}}><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">{item.title}</span><span className="text-[10px] text-muted-foreground">{item.category}</span></div><p className="mt-1 text-[11px] text-muted-foreground">{item.description}</p></button>)}</div></ScrollArea></PopoverContent></Popover>;
}
