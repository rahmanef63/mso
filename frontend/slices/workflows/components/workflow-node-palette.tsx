"use client";
import { useEffect, useMemo, useState } from "react";
import { Bot, Braces, GitBranch, Plus, Search, Sparkles, Wrench, Zap } from "lucide-react";
import type { WorkflowGraphNodeType } from "@/lib/contracts/workflow-graph";
import type { WorkflowNodeCatalogItem } from "@/lib/workflow/node-catalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { listNodeCatalog } from "../lib/api";

type Context = "all" | "after-node";
type Props = {
  onAdd: (type: WorkflowGraphNodeType, defaults: Record<string, unknown>) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  context?: Context;
};

const categoryOrder = ["Triggers", "Actions", "AI", "Flow", "Context"] as const;
function categoryIcon(category: string) {
  if (category === "Triggers") return Zap;
  if (category === "Actions") return Wrench;
  if (category === "AI") return Bot;
  if (category === "Flow") return GitBranch;
  if (category === "Context") return Braces;
  return Sparkles;
}

export function WorkflowNodePalette({ onAdd, open: openProp, onOpenChange, context = "all" }: Props) {
  const [internalOpen, setInternalOpen] = useState(false), [query, setQuery] = useState(""), [category, setCategory] = useState("All");
  const [items, setItems] = useState<WorkflowNodeCatalogItem[]>([]);
  const open = openProp ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setInternalOpen(next);
    onOpenChange?.(next);
    if (!next) { setQuery(""); setCategory("All"); }
  };
  useEffect(() => {
    let cancelled = false;
    void listNodeCatalog().then((rows) => { if (!cancelled) setItems(rows); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  const available = useMemo(() => items.filter((item) => context !== "after-node" || item.category !== "Triggers"), [context, items]);
  const categories = useMemo(() => ["All", ...categoryOrder.filter((name) => available.some((item) => item.category === name))], [available]);
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return available.filter((item) => (category === "All" || item.category === category) && (!q || `${item.title} ${item.type} ${item.category} ${item.description}`.toLowerCase().includes(q)));
  }, [available, category, query]);
  const add = (item: WorkflowNodeCatalogItem) => {
    onAdd(item.type, item.defaults);
    setOpen(false);
  };
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button size="sm" variant="outline"><Plus className="mr-1 size-3"/>Add node</Button></PopoverTrigger>
    <PopoverContent align="start" className="w-[min(92vw,34rem)] p-0">
      <div className="border-b p-3">
        <div className="mb-2"><div className="text-sm font-semibold">{context === "after-node" ? "What happens next?" : "Add a node"}</div><p className="mt-0.5 text-[11px] text-muted-foreground">{context === "after-node" ? "Choose the next action or flow step. It will be connected automatically." : "Search MSO triggers, actions, AI, flow-control and context nodes."}</p></div>
        <div className="relative"><Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground"/><Input autoFocus className="pl-8" placeholder="Search nodes…" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && filtered[0]) add(filtered[0]); }}/></div>
      </div>
      <div className="grid min-h-72 grid-cols-[8.5rem_minmax(0,1fr)]">
        <div className="border-r p-2">
          {categories.map((name) => {
            const Icon = name === "All" ? Sparkles : categoryIcon(name);
            return <button key={name} type="button" className={cn("flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs", category === name ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground")} onClick={() => setCategory(name)}><Icon className="size-3.5 shrink-0"/><span className="truncate">{name}</span></button>;
          })}
        </div>
        <ScrollArea className="h-80"><div className="space-y-1 p-2">
          {filtered.map((item) => {
            const Icon = categoryIcon(item.category);
            return <button key={item.type} type="button" className="group flex w-full items-start gap-3 rounded-lg border border-transparent p-2.5 text-left hover:border-border hover:bg-accent/60" onClick={() => add(item)}>
              <span className="grid size-8 shrink-0 place-items-center rounded-lg border bg-background"><Icon className="size-4 text-muted-foreground group-hover:text-foreground"/></span>
              <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">{item.title}</span><span className="text-[9px] uppercase tracking-wide text-muted-foreground">{item.category}</span></span><span className="mt-1 block text-[11px] leading-4 text-muted-foreground">{item.description}</span></span>
            </button>;
          })}
          {!filtered.length ? <div className="px-3 py-8 text-center text-xs text-muted-foreground">No nodes match this search.</div> : null}
        </div></ScrollArea>
      </div>
      <div className="border-t px-3 py-2 text-[10px] text-muted-foreground">Tip: press Enter to add the first result. Use the + buttons on node outputs to insert and connect in one step.</div>
    </PopoverContent>
  </Popover>;
}
