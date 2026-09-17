"use client";

import { useEffect, useMemo, useState } from "react";
import { Database, FolderKanban, Search, Sparkles, Workflow, Wrench } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { listWorkflowDirectory, type WorkflowDirectory } from "../lib/api";

type View = keyof WorkflowDirectory;
type DirectoryRow = WorkflowDirectory[View][number];
const VIEWS = ["tools", "workflows", "sessions", "projects", "skills"] as const;
const ICONS = { tools: Wrench, workflows: Workflow, sessions: Database, projects: FolderKanban, skills: Sparkles };
function rowTitle(row: DirectoryRow): string {
  return "title" in row ? row.label || `${row.name}-${row.title}` : row.name;
}
function rowKey(row: DirectoryRow): string { return "id" in row ? row.id : row.name; }
function searchText(row: DirectoryRow): string {
  return [rowTitle(row), "description" in row ? row.description : "", "scope" in row ? row.scope : "",
    "status" in row ? row.status : "", "source" in row ? row.source : "", "trust" in row ? row.trust : "",
    "packageName" in row ? row.packageName : "", "branch" in row ? row.branch : "",
    "cwd" in row ? row.cwd : ""].join(" ").toLowerCase();
}

export function WorkflowDirectoryPanel() {
  const [view, setView] = useState<View>("tools");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<WorkflowDirectory | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void listWorkflowDirectory().then(value => { if (alive) setData(value); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : "Directory unavailable"); });
    return () => { alive = false; };
  }, []);
  const q = query.toLowerCase().trim();
  const rows = useMemo<DirectoryRow[]>(() => (data?.[view] ?? []).filter(row => !q || searchText(row).includes(q)), [data, q, view]);
  const Icon = ICONS[view];
  return <div className="flex h-full min-h-0 flex-col">
    <div className="space-y-2 border-b p-2">
      <div className="grid grid-cols-5 gap-1">{VIEWS.map(item => <button key={item} type="button"
        className={`rounded-md px-2 py-1.5 text-[10px] capitalize ${view === item ? "bg-accent font-semibold" : "text-muted-foreground hover:bg-accent/60"}`}
        onClick={() => setView(item)}>{item}</button>)}</div>
      <div className="relative"><Search className="absolute left-2 top-2.5 size-3 text-muted-foreground"/>
        <Input className="h-8 pl-7" placeholder={`Search ${view}…`} value={query} onChange={e => setQuery(e.target.value)}/></div>
    </div>
    <ScrollArea className="min-h-0 flex-1"><div className="space-y-1 p-2">
      {error ? <p className="p-2 text-xs text-destructive">{error}</p> : null}
      {rows.map(row => <div key={rowKey(row)} className="rounded-lg border p-2">
        <div className="flex items-center gap-2"><Icon className="size-3.5 text-muted-foreground"/>
          <div className="min-w-0 flex-1 truncate text-xs font-semibold">{rowTitle(row)}</div>
          {"scope" in row ? <span className="text-[9px] uppercase text-muted-foreground">{row.scope}</span> : null}</div>
        {"description" in row ? <p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">{row.description}</p> : null}
        {"nodeCount" in row ? <p className="mt-1 text-[10px] text-muted-foreground">{row.status} · {row.nodeCount} nodes</p> : null}
        {"source" in row ? <p className="mt-1 truncate text-[10px] text-muted-foreground">{row.source} · {"trust" in row ? row.trust : row.title}</p> : null}
        {"branch" in row ? <p className="mt-1 truncate text-[10px] text-muted-foreground">{row.branch ?? "no git"}{row.packageName ? ` · ${row.packageName}` : ""}</p> : null}
      </div>)}
      {rows.length === 0 && !error ? <p className="p-3 text-xs text-muted-foreground">No matching {view}.</p> : null}
    </div></ScrollArea>
  </div>;
}
