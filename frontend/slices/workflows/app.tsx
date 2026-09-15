"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, PanelLeft, PanelRight, Play, RefreshCw, Save, Trash2, Workflow } from "lucide-react";
import type { AppProps, ToolbarItem } from "@/features/appshell";
import type { WorkflowGraph, WorkflowGraphNode, WorkflowGraphNodeType, WorkflowGraphRun } from "@/lib/contracts/workflow-graph";
import { AppFrame, ResponsiveDialog, ResponsiveToolbar, openWindow, useContainer, useResponsive } from "@/features/appshell";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { WorkflowCanvas } from "./components/workflow-canvas";
import { WorkflowCreateDialog } from "./components/workflow-create-dialog";
import { WorkflowDetails, type WorkflowPanel } from "./components/workflow-details";
import { WorkflowLibrary } from "./components/workflow-library";
import { WorkflowNodePalette } from "./components/workflow-node-palette";
import { tidyWorkflowNodes } from "./lib/canvas-layout";
import { cloneGraph, createFromTemplate, createGraph, deleteGraph, getGraph, listGraphs, resolveNode, runGraph, runStatus, updateGraph } from "./lib/api";

type Definition = Omit<WorkflowGraph, "version" | "id" | "revision" | "createdAt" | "updatedAt">;
function starterGraph(): Definition { return { name: "New Workflow", description: "Private workflow graph.", status: "draft", inputs: {}, metadata: { provenance: "user" }, nodes: [{ id: "manual", name: "Manual Trigger", type: "manual", position: { x: 80, y: 160 }, config: {} }, { id: "output", name: "Output", type: "output", position: { x: 420, y: 160 }, config: {} }], edges: [{ id: "edge-start", source: "manual", target: "output" }] }; }

export default function WorkflowsApp(_props: AppProps) {
  const { isMobile } = useResponsive();
  const [appRef, pane] = useContainer<HTMLDivElement>();
  const overlayPane = isMobile || pane !== "lg";
  const [graphs, setGraphs] = useState<WorkflowGraph[]>([]), [graph, setGraph] = useState<WorkflowGraph | null>(null), [selected, setSelected] = useState<string | null>(null), [run, setRun] = useState<WorkflowGraphRun | null>(null);
  const [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [message, setMessage] = useState(""), [panel, setPanel] = useState<WorkflowPanel>("inspector"), [search, setSearch] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(false), [detailsOpen, setDetailsOpen] = useState(false), [showLibrary, setShowLibrary] = useState(true), [showDetails, setShowDetails] = useState(true);
  const node = useMemo(() => graph?.nodes.find((item) => item.id === selected) ?? null, [graph, selected]);
  const runStates = useMemo(() => new Map(run?.nodes.map((item) => [item.id, item.state]) ?? []), [run]);
  const runEdgeStates = useMemo(() => new Map(run?.edges?.map((item) => [item.id, item.state]) ?? []), [run]);

  const load = async (selectId?: string, force=false) => { const list = await listGraphs(force); setGraphs(list); const id = selectId ?? graph?.id ?? list[0]?.id; if (id) { setGraph(await getGraph(id, force)); setDirty(false); } else { setGraph(null); setDirty(false); } };
  useEffect(() => { let cancelled = false; void listGraphs().then(async (list) => { if (cancelled) return; setGraphs(list); if (list[0]) { const first = await getGraph(list[0].id); if (!cancelled) setGraph(first); } }).catch((error: unknown) => { if (!cancelled) setMessage(error instanceof Error ? error.message : "Could not load workflows"); }); return () => { cancelled = true; }; }, []);
  useEffect(() => { if (!run || run.state !== "running") return; const timer = setInterval(() => { void runStatus(run.id).then(setRun).catch(() => undefined); }, 1600); return () => clearInterval(timer); }, [run]);
  useEffect(() => {
    if (overlayPane) return;
    const frame = requestAnimationFrame(() => { setLibraryOpen(false); setDetailsOpen(false); });
    return () => cancelAnimationFrame(frame);
  }, [overlayPane]);
  const wrap = async (fn: () => Promise<void>) => { setBusy(true); setMessage(""); try { await fn(); } catch (error) { setMessage(error instanceof Error ? error.message : "Action failed"); } finally { setBusy(false); } };
  const mutate = (next: WorkflowGraph) => { setGraph(next); setDirty(true); };
  const selectGraph = async (id: string) => { setGraph(await getGraph(id)); setSelected(null); setRun(null); setDirty(false); setPanel("inspector"); setLibraryOpen(false); };
  const createBlank = () => wrap(async () => { const next = await createGraph(starterGraph()); await load(next.id); setSelected("manual"); setLibraryOpen(false); });
  const createTemplate = (id: string) => wrap(async () => { const next = await createFromTemplate(id); await load(next.id); setSelected(next.nodes[0]?.id ?? null); setLibraryOpen(false); });
  const createAI = (definition: Definition) => wrap(async () => { const next = await createGraph(definition); await load(next.id); setSelected(next.nodes[0]?.id ?? null); setLibraryOpen(false); });
  const saveCurrent = async () => { if (!graph) throw new Error("No workflow selected"); if (!dirty) return graph; const next = await updateGraph(graph); setGraph(next); setDirty(false); setGraphs(await listGraphs()); return next; };
  const save = () => graph && wrap(async () => { await saveCurrent(); setMessage("Saved"); });
  const duplicate = () => graph && wrap(async () => { const next = await cloneGraph(graph.id); await load(next.id); });
  const remove = () => graph && wrap(async () => { await deleteGraph(graph); setSelected(null); setRun(null); const list = await listGraphs(); setGraphs(list); setGraph(list[0] ? await getGraph(list[0].id) : null); setDirty(false); });
  const execute = () => graph && wrap(async () => { const saved = await saveCurrent(); setRun(await runGraph(saved.id)); setPanel("run"); if (overlayPane) setDetailsOpen(true); });
  const updateNode = (next: WorkflowGraphNode) => graph && mutate({ ...graph, nodes: graph.nodes.map((item) => item.id === next.id ? next : item) });
  const deleteNodes = (ids: string[]) => { if (!graph || !ids.length) return; const removed = new Set(ids); mutate({ ...graph, nodes: graph.nodes.filter((item) => !removed.has(item.id)), edges: graph.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)) }); if (selected && removed.has(selected)) setSelected(null); };
  const deleteEdges = (ids: string[]) => { if (!graph || !ids.length) return; const removed = new Set(ids); mutate({ ...graph, edges: graph.edges.filter((edge) => !removed.has(edge.id)) }); };
  const addNode = (type: WorkflowGraphNodeType, defaults: Record<string, unknown>) => { if (!graph) return; const id = `${type}-${crypto.randomUUID().slice(0, 8)}`; const next: WorkflowGraphNode = { id, name: type.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase()), type, position: { x: 220 + graph.nodes.length * 36, y: 240 + (graph.nodes.length % 4) * 110 }, config: structuredClone(defaults) }; mutate({ ...graph, nodes: [...graph.nodes, next] }); chooseNode(id); };
  const connect = (source: string, target: string, sourceHandle?: string) => { if (!graph || graph.edges.some((edge) => edge.source === source && edge.target === target && edge.sourceHandle === sourceHandle)) return; mutate({ ...graph, edges: [...graph.edges, { id: `edge-${crypto.randomUUID().slice(0, 8)}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) }] }); };
  const openNode = async (id: string) => { if (!graph) return; const resolved = await resolveNode(graph.id, id); openWindow("files-manager", resolved.name, undefined, { path: resolved.path }, { multi: true }); };
  const chooseNode = (id: string | null) => { setSelected(id); if (!id) return; setPanel("inspector"); if (overlayPane) setDetailsOpen(true); };
  const tidy = () => graph && mutate({ ...graph, nodes: tidyWorkflowNodes(graph) });
  const toggleLibrary = () => overlayPane ? setLibraryOpen(true) : setShowLibrary((value) => !value);
  const toggleDetails = () => overlayPane ? setDetailsOpen(true) : setShowDetails((value) => !value);

  const library = <WorkflowLibrary graphs={graphs} activeId={graph?.id} search={search} onSearch={setSearch} onSelect={(id) => void wrap(() => selectGraph(id))} onBlank={async () => { await createBlank(); }} onTemplate={async (id) => { await createTemplate(id); }} onAI={async (definition) => { await createAI(definition); }}/>;
  const details = graph ? <WorkflowDetails graph={graph} graphs={graphs} node={node} run={run} panel={panel} onPanel={setPanel} onNode={updateNode} onDeleteNode={(id) => deleteNodes([id])} onGraph={mutate} onRunSelect={(selectedRun) => { setRun(selectedRun); setPanel("run"); }} onRestored={(next) => { setGraph(next); setDirty(false); void listGraphs().then(setGraphs); }}/> : null;
  const toolbarItems: ToolbarItem[] = [
    { id: "library", label: "Workflow library", icon: PanelLeft, onClick: toggleLibrary, primary: true },
    { id: "refresh", label: "Refresh", icon: RefreshCw, onClick: () => void load(undefined, true), disabled: busy },
    ...(graph ? [
      { id: "duplicate", label: "Duplicate", icon: Copy, onClick: () => void duplicate(), disabled: busy },
      { id: "save", label: "Save", icon: Save, onClick: () => void save(), disabled: busy || !dirty },
      { id: "run", label: "Run", icon: Play, onClick: () => void execute(), disabled: busy, primary: true },
      { id: "details", label: "Details", icon: PanelRight, onClick: toggleDetails },
      { id: "delete", label: "Delete", icon: Trash2, onClick: () => void remove(), disabled: busy },
    ] satisfies ToolbarItem[] : []),
  ];
  const showLibraryPanel = !overlayPane && showLibrary;
  const showDetailsPanel = !overlayPane && showDetails && Boolean(graph);

  return <div ref={appRef} data-slot="workflows-feature" className="@container h-full min-h-0 min-w-0">
    <AppFrame safeArea={false} className="h-full min-w-0" toolbar={<div className="flex h-11 min-w-0 items-center gap-1 px-2 @min-[700px]:gap-2 @min-[700px]:px-3"><Workflow className="hidden size-4 shrink-0 @min-[700px]:block"/><span className="hidden shrink-0 text-sm font-semibold @min-[700px]:inline">Workflows</span>{dirty ? <Badge variant="outline" className="hidden shrink-0 @min-[520px]:inline-flex">Unsaved</Badge> : null}{graph ? <Input aria-label="Workflow name" className="h-8 min-w-[7rem] max-w-56 flex-1 @max-[600px]:max-w-none" value={graph.name} onChange={(event) => mutate({ ...graph, name: event.target.value })}/> : <div className="min-w-0 flex-1"/>}<WorkflowCreateDialog compact={overlayPane} onBlank={async () => { await createBlank(); }} onTemplate={async (id) => { await createTemplate(id); }} onAI={async (definition) => { await createAI(definition); }}/><ResponsiveToolbar items={toolbarItems} compact={overlayPane} className="ml-auto shrink-0"/></div>}>
      <div className={`grid h-full min-h-0 min-w-0 ${showLibraryPanel ? "grid-cols-[220px_minmax(0,1fr)]" : "grid-cols-1"}`}>
        {showLibraryPanel ? <aside className="min-h-0 min-w-0 border-r">{library}</aside> : null}
        <main className="flex min-h-0 min-w-0 overflow-hidden">{graph ? <div className="flex min-h-0 min-w-0 flex-1 flex-col"><div className="flex min-h-10 min-w-0 shrink-0 flex-wrap items-center gap-1.5 border-b px-2 py-1 @min-[520px]:flex-nowrap @min-[520px]:gap-2"><label className="flex shrink-0 items-center gap-1.5 text-[10px] font-medium"><Switch checked={graph.status === "active"} disabled={graph.status === "archived"} onCheckedChange={(checked) => mutate({ ...graph, status: checked ? "active" : "draft" })}/><span>Active</span></label><select aria-label="Workflow lifecycle" className="h-7 min-w-0 max-w-24 rounded border bg-background px-2 text-xs" value={graph.status} onChange={(event) => mutate({ ...graph, status: event.target.value as WorkflowGraph["status"] })}><option value="draft">Draft</option><option value="active">Active</option><option value="archived">Archived</option></select><WorkflowNodePalette onAdd={addNode}/><span className="hidden min-w-0 truncate text-[10px] text-muted-foreground @min-[900px]:inline">Drag output → input. V Select · H Pan · +/- Zoom · F Fit · Space temporary pan.</span>{message ? <span className="w-full min-w-0 truncate text-[11px] text-muted-foreground @min-[520px]:ml-auto @min-[520px]:w-auto @min-[520px]:max-w-72">{message}</span> : null}</div><div className="min-h-0 min-w-0 flex-1 overflow-hidden"><WorkflowCanvas key={graph.id} graph={graph} selectedId={selected} onSelect={chooseNode} nodeStates={runStates} edgeStates={runEdgeStates} onOpen={(id) => void openNode(id)} onConnect={connect} onMove={(id, position) => mutate({ ...graph, nodes: graph.nodes.map((item) => item.id === id ? { ...item, position } : item) })} onDeleteNodes={deleteNodes} onDeleteEdges={deleteEdges} onTidy={tidy}/></div></div> : <div className="flex h-full min-w-0 flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">Create or select a workflow.</div>}{showDetailsPanel ? <aside className="w-[320px] shrink-0 border-l @min-[1200px]:w-[360px]">{details}</aside> : null}</main>
      </div>
      {overlayPane ? <><ResponsiveDialog open={libraryOpen} onOpenChange={setLibraryOpen} variant="panel" size="lg" mobileVariant="drawer-right" sheetSide="left"><ResponsiveDialog.Header><ResponsiveDialog.Title>Workflows</ResponsiveDialog.Title><ResponsiveDialog.Description>Select or create a workflow without leaving the canvas.</ResponsiveDialog.Description></ResponsiveDialog.Header><ResponsiveDialog.Body className="p-0">{library}</ResponsiveDialog.Body></ResponsiveDialog><ResponsiveDialog open={detailsOpen && Boolean(graph)} onOpenChange={setDetailsOpen} variant="panel" size="lg" mobileVariant="drawer-right" sheetSide="right"><ResponsiveDialog.Header><ResponsiveDialog.Title>{node?.name ?? graph?.name ?? "Workflow details"}</ResponsiveDialog.Title><ResponsiveDialog.Description>Inspect configuration, runs, versions, variables, and the directory without shrinking the canvas.</ResponsiveDialog.Description></ResponsiveDialog.Header><ResponsiveDialog.Body className="p-0">{details}</ResponsiveDialog.Body></ResponsiveDialog></> : null}
    </AppFrame>
  </div>;
}
