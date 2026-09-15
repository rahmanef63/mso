"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Play, Plus, RefreshCw, Save, Trash2, Workflow } from "lucide-react";
import type { AppProps } from "@/features/appshell";
import type { WorkflowGraph, WorkflowGraphNode, WorkflowGraphNodeType, WorkflowGraphRun } from "@/lib/contracts/workflow-graph";
import { AppFrame, openWindow } from "@/features/appshell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WorkflowCanvas } from "./components/workflow-canvas";
import { WorkflowInspector } from "./components/workflow-inspector";
import { WorkflowRunPanel } from "./components/workflow-run-panel";
import { cloneGraph, createGraph, deleteGraph, getGraph, listGraphs, resolveNode, runGraph, runStatus, updateGraph } from "./lib/api";

function starterGraph(name = "New Workflow") {
  return {
    name, description: "Private workflow graph.", status: "draft" as const, inputs: {}, metadata: { provenance: "user" as const },
    nodes: [
      { id: "manual", name: "Manual Trigger", type: "manual" as const, position: { x: 80, y: 160 }, config: {} },
      { id: "output", name: "Output", type: "output" as const, position: { x: 420, y: 160 }, config: {} },
    ],
    edges: [{ id: "edge-start", source: "manual", target: "output" }],
  };
}

export default function WorkflowsApp(_props: AppProps) {
  const [graphs, setGraphs] = useState<WorkflowGraph[]>([]), [graph, setGraph] = useState<WorkflowGraph | null>(null);
  const [selected, setSelected] = useState<string | null>(null), [run, setRun] = useState<WorkflowGraphRun | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [panel, setPanel] = useState<"inspector" | "runs">("inspector");
  const node = useMemo(() => graph?.nodes.find((item) => item.id === selected) ?? null, [graph, selected]);
  const runStates = useMemo(() => new Map(run?.nodes.map((item) => [item.id, item.state]) ?? []), [run]);
  const refresh = async (selectId?: string) => {
    const list = await listGraphs(); setGraphs(list);
    const id = selectId ?? graph?.id ?? list[0]?.id;
    if (id) setGraph(await getGraph(id)); else setGraph(null);
  };
  useEffect(() => {
    let cancelled = false;
    void listGraphs().then(async (list) => {
      if (cancelled) return;
      setGraphs(list);
      if (list[0]) setGraph(await getGraph(list[0].id));
    }).catch((error: unknown) => { if (!cancelled) setMessage(error instanceof Error ? error.message : "Could not load workflows"); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!run || run.state !== "running") return;
    const timer = setInterval(() => { void runStatus(run.id).then(setRun).catch(() => undefined); }, 1600); return () => clearInterval(timer);
  }, [run]);
  const wrap = async (fn: () => Promise<void>) => { setBusy(true); setMessage(""); try { await fn(); } catch (error) { setMessage(error instanceof Error ? error.message : "Action failed"); } finally { setBusy(false); } };
  const create = () => wrap(async () => { const next = await createGraph(starterGraph()); await refresh(next.id); setSelected("manual"); });
  const save = () => graph && wrap(async () => { const next = await updateGraph(graph); setGraph(next); setGraphs(await listGraphs()); setMessage("Saved"); });
  const duplicate = () => graph && wrap(async () => { const next = await cloneGraph(graph.id); await refresh(next.id); });
  const remove = () => graph && wrap(async () => { await deleteGraph(graph); setSelected(null); setRun(null); const list = await listGraphs(); setGraphs(list); setGraph(list[0] ? await getGraph(list[0].id) : null); });
  const execute = () => graph && wrap(async () => { const receipt = await runGraph(graph.id); setRun(receipt); setPanel("runs"); });
  const updateNode = (next: WorkflowGraphNode) => graph && setGraph({ ...graph, nodes: graph.nodes.map((item) => item.id === next.id ? next : item) });
  const deleteNode = (id: string) => { if (!graph) return; setGraph({ ...graph, nodes: graph.nodes.filter((item) => item.id !== id), edges: graph.edges.filter((edge) => edge.source !== id && edge.target !== id) }); setSelected(null); };
  const openNode = async (id: string) => {
    if (!graph) return;
    const resolved = await resolveNode(graph.id, id);
    openWindow("files-manager", resolved.name, undefined, { path: resolved.path }, { multi: true });
  };
  const addNode = (type: WorkflowGraphNodeType) => {
    if (!graph) return; const id = `${type}-${crypto.randomUUID().slice(0, 8)}`;
    const next: WorkflowGraphNode = { id, name: type.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase()), type, position: { x: 220 + graph.nodes.length * 32, y: 280 + (graph.nodes.length % 4) * 100 }, config: {} };
    setGraph({ ...graph, nodes: [...graph.nodes, next] }); setSelected(id); setPanel("inspector");
  };

  return <AppFrame safeArea={false} className="h-full" toolbar={<div className="flex h-11 items-center gap-2 border-b px-3">
    <Workflow className="size-4" /><span className="text-sm font-semibold">Workflows</span><div className="h-4 w-px bg-border" />
    {graph && <Input className="h-8 max-w-56" value={graph.name} onChange={(e) => setGraph({ ...graph, name: e.target.value })} />}
    <div className="ml-auto flex items-center gap-1"><Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={busy}><RefreshCw className="size-3" /></Button><Button size="sm" variant="outline" onClick={() => void create()} disabled={busy}><Plus className="mr-1 size-3" />New</Button>{graph && <><Button size="sm" variant="outline" onClick={() => void duplicate()} disabled={busy}><Copy className="size-3" /></Button><Button size="sm" variant="outline" onClick={() => void save()} disabled={busy}><Save className="mr-1 size-3" />Save</Button><Button size="sm" onClick={() => void execute()} disabled={busy}><Play className="mr-1 size-3" />Run</Button><Button size="sm" variant="ghost" onClick={() => void remove()} disabled={busy}><Trash2 className="size-3" /></Button></>}</div>
  </div>}>
    <div className="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)_300px]">
      <aside className="min-h-0 border-r bg-muted/10"><div className="border-b p-2"><Button className="w-full" size="sm" onClick={() => void create()}><Plus className="mr-1 size-3" />Create workflow</Button></div><ScrollArea className="h-[calc(100%-49px)]"><div className="space-y-1 p-2">{graphs.length === 0 && <div className="p-3 text-xs text-muted-foreground">No private workflows yet. Successful repeated sessions can also create learned drafts.</div>}{graphs.map((item) => <button key={item.id} type="button" onClick={() => void wrap(async () => { setGraph(await getGraph(item.id)); setSelected(null); setRun(null); })} className={`w-full rounded-lg border p-2 text-left text-xs ${graph?.id === item.id ? "bg-accent" : "bg-card"}`}><div className="truncate font-medium">{item.name}</div><div className="mt-1 text-[10px] text-muted-foreground">{item.status} · {item.nodes.length} nodes{item.metadata.provenance === "learned-from-session" ? " · learned" : ""}</div></button>)}</div></ScrollArea></aside>
      <main className="min-h-0 min-w-0 overflow-hidden">{graph ? <div className="flex h-full flex-col"><div className="flex h-10 items-center gap-2 border-b px-2"><select className="h-7 rounded border bg-background px-2 text-xs" value={graph.status} onChange={(e) => setGraph({ ...graph, status: e.target.value as WorkflowGraph["status"] })}><option value="draft">Draft</option><option value="active">Active</option><option value="archived">Archived</option></select><select className="h-7 rounded border bg-background px-2 text-xs" defaultValue="" onChange={(e) => { if (e.target.value) { addNode(e.target.value as WorkflowGraphNodeType); e.target.value = ""; } }}><option value="">+ Add node</option>{["tool","project_function","project_mcp","script","agent","subflow","condition","project","folder","skill","knowledge","output"].map((type) => <option key={type} value={type}>{type}</option>)}</select>{message && <span className="ml-auto truncate text-[11px] text-muted-foreground">{message}</span>}</div><div className="min-h-0 flex-1 overflow-auto"><WorkflowCanvas graph={graph} selectedId={selected} onSelect={setSelected} nodeStates={runStates} onOpen={(id) => void openNode(id)} onMove={(id, position) => setGraph({ ...graph, nodes: graph.nodes.map((item) => item.id === id ? { ...item, position } : item) })} /></div></div> : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Create or select a workflow.</div>}</main>
      <aside className="min-h-0 border-l"><div className="flex h-10 border-b"><button className={`flex-1 text-xs ${panel === "inspector" ? "font-semibold" : "text-muted-foreground"}`} onClick={() => setPanel("inspector")}>Inspector</button><button className={`flex-1 text-xs ${panel === "runs" ? "font-semibold" : "text-muted-foreground"}`} onClick={() => setPanel("runs")}>Run log</button></div><div className="h-[calc(100%-40px)]">{graph && panel === "inspector" ? <ScrollArea className="h-full"><WorkflowInspector key={node?.id ?? "none"} graph={graph} node={node} onNode={updateNode} onDeleteNode={deleteNode} onGraph={setGraph} /></ScrollArea> : <WorkflowRunPanel run={run} />}</div></aside>
    </div>
  </AppFrame>;
}
