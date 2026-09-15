"use client";
import { useEffect, useMemo, useState } from "react";
import { Search, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { listWorkflowDirectory, type WorkflowDirectory } from "../lib/api";

const BLOCKED = new Set(["workflow_start", "workflow_finish", "workflow_cancel", "flow_run", "flow_status", "workflow_graph"]);
export function WorkflowToolDirectoryField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(""), [directory, setDirectory] = useState<WorkflowDirectory | null>(null);
  useEffect(() => { if (!open) return; let alive = true; void listWorkflowDirectory().then((value) => { if (alive) setDirectory(value); }); return () => { alive = false; }; }, [open]);
  const tools = useMemo(() => { const q = query.toLowerCase().trim(); return (directory?.tools ?? []).filter((tool) => !BLOCKED.has(tool.name) && (!q || `${tool.name} ${tool.description} ${tool.scope}`.toLowerCase().includes(q))); }, [directory, query]);
  const selected = directory?.tools.find((tool) => tool.name === value);
  return <div className="space-y-1"><span className="text-muted-foreground">MSO tool</span><Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button type="button" variant="outline" className="w-full justify-start font-mono text-xs"><Wrench className="mr-2 size-3.5"/>{value || "Choose from MSO directory"}</Button></PopoverTrigger><PopoverContent align="start" className="w-96 max-w-[calc(100vw-2rem)] p-2"><div className="relative mb-2"><Search className="absolute left-2 top-2.5 size-3 text-muted-foreground"/><Input className="pl-7" placeholder="Search tools, memory, session…" value={query} onChange={(e)=>setQuery(e.target.value)}/></div><ScrollArea className="h-72"><div className="space-y-1">{tools.map((tool)=><button key={tool.name} type="button" className="w-full rounded-md border p-2 text-left hover:bg-accent" onClick={()=>{onChange(tool.name);setOpen(false);setQuery("");}}><div className="flex items-center justify-between gap-2"><span className="font-mono text-[11px] font-semibold">{tool.name}</span><span className="text-[9px] uppercase text-muted-foreground">{tool.scope}</span></div><p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">{tool.description}</p></button>)}{tools.length===0?<p className="p-3 text-xs text-muted-foreground">No matching executable tools.</p>:null}</div></ScrollArea></PopoverContent></Popover>{selected?<p className="text-[10px] text-muted-foreground">{selected.description}</p>:null}</div>;
}
