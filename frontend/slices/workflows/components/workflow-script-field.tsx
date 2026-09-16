"use client";

import { useEffect, useMemo, useState } from "react";
import { FileCode2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { listWorkflowScripts, type WorkflowScriptSummary } from "../lib/api";

export function WorkflowScriptField({ project, value, onChange }: { project: string; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(""), [scripts, setScripts] = useState<WorkflowScriptSummary[]>([]), [loadedProject, setLoadedProject] = useState(""), [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    if (!project.trim()) return;
    const requestedProject = project.trim();
    void listWorkflowScripts(requestedProject).then((rows) => { if (!cancelled) { setScripts(rows); setLoadedProject(requestedProject); setError(""); } }).catch((reason: unknown) => { if (!cancelled) { setScripts([]); setLoadedProject(requestedProject); setError(reason instanceof Error ? reason.message : "Could not load scripts"); } });
    return () => { cancelled = true; };
  }, [project]);
  const projectReady = Boolean(project.trim()) && loadedProject === project.trim();
  const filtered = useMemo(() => { if (!projectReady) return []; const q = query.toLowerCase().trim(); return scripts.filter((script) => !q || `${script.id} ${script.intent} ${script.status} ${script.tools.join(" ")}`.toLowerCase().includes(q)); }, [projectReady, query, scripts]);
  const selected = projectReady ? scripts.find((script) => script.id === value) : undefined;
  return <div className="space-y-2">
    <div className="space-y-1"><span className="text-muted-foreground">Script ID</span><Input value={value} placeholder="script_<recipe-id>" onChange={(event) => onChange(event.target.value)}/></div>
    <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button type="button" variant="outline" className="w-full justify-start" disabled={!project.trim()}><FileCode2 className="mr-2 size-3.5"/>{selected ? selected.intent : project.trim() ? "Choose saved RASMIC script" : "Set project first"}</Button></PopoverTrigger><PopoverContent align="start" className="w-96 max-w-[calc(100vw-2rem)] p-2"><div className="relative mb-2"><Search className="absolute left-2 top-2.5 size-3 text-muted-foreground"/><Input className="pl-7" placeholder="Search script id, intent, tool…" value={query} onChange={(event) => setQuery(event.target.value)}/></div><ScrollArea className="h-72"><div className="space-y-1">{filtered.map((script) => <button key={script.id} type="button" className="w-full rounded-md border p-2 text-left hover:bg-accent" onClick={() => { onChange(script.id); setOpen(false); setQuery(""); }}><div className="flex items-center justify-between gap-2"><span className="truncate font-mono text-[11px] font-semibold">{script.id}</span><Badge variant="outline" className="shrink-0 text-[9px]">{script.status}</Badge></div><p className="mt-1 line-clamp-2 text-[11px]">{script.intent}</p><p className="mt-1 text-[10px] text-muted-foreground">{script.stepCount} steps{script.tools.length ? ` · ${script.tools.join(" · ")}` : ""}</p></button>)}{projectReady && !filtered.length && !error ? <p className="p-3 text-xs text-muted-foreground">No saved scripts match this project/query.</p> : null}{projectReady && error ? <p className="p-3 text-xs text-destructive">{error}</p> : null}{project.trim() && !projectReady ? <p className="p-3 text-xs text-muted-foreground">Loading scripts…</p> : null}</div></ScrollArea></PopoverContent></Popover>
    {selected ? <div className="rounded-md border p-2 text-[10px] text-muted-foreground"><div className="flex items-center gap-2"><Badge variant="outline">{selected.status}</Badge><span>{selected.stepCount} validated steps</span></div><p className="mt-1">{selected.intent}</p></div> : null}
    <p className="text-[10px] text-muted-foreground">Saved with the workflow as a script reference. Execution uses MSO&apos;s validated RASMIC runner; arbitrary browser shell/JS is not executed.</p>
  </div>;
}
