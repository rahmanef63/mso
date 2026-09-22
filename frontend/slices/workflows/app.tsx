"use client";
import { pruneGraphCustomNodes } from "@/lib/contracts/graph-custom-nodes";

import { useEffect, useMemo, useState } from "react";
import { Activity, Copy, Download, PanelLeft, PanelRight, Play, RefreshCw, Save, Trash2, Workflow } from "lucide-react";
import type { AppProps, ToolbarItem } from "@/features/appshell";
import type { SessionGraphView } from "@/lib/contracts/session-monitor";
import type { WorkflowGraph, WorkflowGraphNode, WorkflowGraphNodeType, WorkflowGraphRun } from "@/lib/contracts/workflow-graph";
import { AppFrame, ResponsiveDialog, ResponsiveToolbar, openWindow, saveAs, useContainer, useResponsive } from "@/features/appshell";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { WorkflowCanvas } from "./components/workflow-canvas";
import { WorkflowCreateDialog } from "./components/workflow-create-dialog";
import { WorkflowDetails, type WorkflowPanel } from "./components/workflow-details";
import { WorkflowLibrary } from "./components/workflow-library";
import { WorkflowNodePalette } from "./components/workflow-node-palette";
import { WorkflowSessionDetails } from "./components/workflow-session-details";
import { WorkflowSessionLibrary } from "./components/workflow-session-library";
import { tidyWorkflowNodes } from "./lib/canvas-layout";
import { buildWorkflowPackage, workflowPackageFilename, type WorkflowDefinition } from "./lib/portability";
import { cloneGraph, createFromTemplate, createGraph, deleteGraph, getGraph, getSessionGraph, listGraphs, listWorkflowLearning, resolveNode, runGraph, runStatus, saveSessionWorkflowDraft, updateGraph, type WorkflowLearningRecipeSummary } from "./lib/api";

type LibraryMode = "automations" | "sessions";
function starterGraph(): WorkflowDefinition { return { name: "New Workflow", description: "Private workflow graph.", status: "draft", inputs: {}, metadata: { provenance: "user" }, nodes: [{ id: "manual", name: "Manual Trigger", type: "manual", position: { x: 80, y: 160 }, config: {} }, { id: "output", name: "Output", type: "output", position: { x: 420, y: 160 }, config: {} }], edges: [{ id: "edge-start", source: "manual", target: "output" }] }; }
function payloadSessionId(payload: unknown): string | undefined { if (!payload || typeof payload !== "object") return undefined; const row = payload as { view?: unknown; sessionId?: unknown }; return row.view === "sessions" && typeof row.sessionId === "string" ? row.sessionId : undefined; }

export default function WorkflowsApp(props: AppProps) {
  const { isMobile } = useResponsive();
  const [appRef, pane] = useContainer<HTMLDivElement>();
  const overlayPane = isMobile || pane !== "lg";
  const [graphs, setGraphs] = useState<WorkflowGraph[]>([]), [graph, setGraph] = useState<WorkflowGraph | null>(null), [selected, setSelected] = useState<string | null>(null), [run, setRun] = useState<WorkflowGraphRun | null>(null);
  const [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [message, setMessage] = useState(""), [panel, setPanel] = useState<WorkflowPanel>("inspector"), [search, setSearch] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(false), [detailsOpen, setDetailsOpen] = useState(false), [showLibrary, setShowLibrary] = useState(true), [showDetails, setShowDetails] = useState(true);
  const [libraryMode, setLibraryMode] = useState<LibraryMode>(() => payloadSessionId(props.payload) ? "sessions" : "automations");
  const [sessionView, setSessionView] = useState<SessionGraphView | null>(null), [sessionSelected, setSessionSelected] = useState<string | null>(null);
  const [learning, setLearning] = useState<WorkflowLearningRecipeSummary[]>([]);
  const node = useMemo(() => graph?.nodes.find((item) => item.id === selected) ?? null, [graph, selected]);
  const sessionNode = useMemo(() => sessionView?.graph.nodes.find((item) => item.id === sessionSelected) ?? null, [sessionSelected, sessionView]);
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
  useEffect(() => {
    const id = payloadSessionId(props.payload);
    if (!id) return;
    let alive = true;
    void Promise.all([getSessionGraph(id), listWorkflowLearning().catch(() => [])]).then(([next, recipes]) => { if (!alive) return; setLibraryMode("sessions"); setMessage(""); setSessionView(next); setLearning(recipes); setSessionSelected("session-root"); }).catch((error: unknown) => { if (alive) setMessage(error instanceof Error ? error.message : "Could not load session"); });
    return () => { alive = false; };
  }, [props.payload]);

  const wrap = async (fn: () => Promise<void>) => { setBusy(true); setMessage(""); try { await fn(); } catch (error) { setMessage(error instanceof Error ? error.message : "Action failed"); } finally { setBusy(false); } };
  const mutate = (next: WorkflowGraph) => { setGraph(next); setDirty(true); };
  const selectGraph = async (id: string) => { setLibraryMode("automations"); setGraph(await getGraph(id)); setSelected(null); setRun(null); setDirty(false); setPanel("inspector"); setLibraryOpen(false); };
  const selectSession = async (id: string) => { const [next, recipes] = await Promise.all([getSessionGraph(id), listWorkflowLearning().catch(() => [])]); setLibraryMode("sessions"); setSessionView(next); setLearning(recipes); setSessionSelected("session-root"); setLibraryOpen(false); setDetailsOpen(false); };
  const refreshSession = async () => { if (!sessionView) return; const [next, recipes] = await Promise.all([getSessionGraph(sessionView.session.id), listWorkflowLearning(true).catch(() => [])]); setSessionView(next); setLearning(recipes); if (sessionSelected && !next.graph.nodes.some((item) => item.id === sessionSelected)) setSessionSelected("session-root"); };
  const createBlank = () => wrap(async () => { const next = await createGraph(starterGraph()); setLibraryMode("automations"); await load(next.id); setSelected("manual"); setLibraryOpen(false); });
  const createTemplate = (id: string) => wrap(async () => { const next = await createFromTemplate(id); setLibraryMode("automations"); await load(next.id); setSelected(next.nodes[0]?.id ?? null); setLibraryOpen(false); });
  const createAI = (definition: WorkflowDefinition) => wrap(async () => { const next = await createGraph(definition); setLibraryMode("automations"); await load(next.id); setSelected(next.nodes[0]?.id ?? null); setLibraryOpen(false); });
  const createImported = (definition: WorkflowDefinition) => wrap(async () => { const next = await createGraph({ ...definition, metadata: { ...definition.metadata, provenance: "import" } }); setLibraryMode("automations"); await load(next.id); setSelected(next.nodes[0]?.id ?? null); setLibraryOpen(false); });
  const saveCurrent = async () => { if (!graph) throw new Error("No workflow selected"); if (!dirty) return graph; const next = await updateGraph(graph); setGraph(next); setDirty(false); setGraphs(await listGraphs()); return next; };
  const save = () => graph && wrap(async () => { await saveCurrent(); setMessage("Saved"); });
  const duplicate = () => graph && wrap(async () => { const next = await cloneGraph(graph.id); await load(next.id); });
  const exportCurrent = () => { if (!graph) return; const blob = new Blob([JSON.stringify(buildWorkflowPackage(graph), null, 2)], { type: "application/json" }); saveAs(URL.createObjectURL(blob), workflowPackageFilename(graph.name)); setMessage("Exported portable workflow package"); };
  const remove = () => graph && wrap(async () => { await deleteGraph(graph); setSelected(null); setRun(null); const list = await listGraphs(); setGraphs(list); setGraph(list[0] ? await getGraph(list[0].id) : null); setDirty(false); });
  const execute = () => graph && wrap(async () => { const saved = await saveCurrent(); setRun(await runGraph(saved.id)); setPanel("run"); if (overlayPane) setDetailsOpen(true); });
  const updateNode = (next: WorkflowGraphNode) => graph && mutate({ ...graph, nodes: graph.nodes.map((item) => item.id === next.id ? next : item) });
  const deleteNodes = (ids: string[]) => { if (!graph || !ids.length) return; const removed = new Set(ids); mutate({ ...graph, nodes: graph.nodes.filter((item) => !removed.has(item.id)), edges: graph.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)), metadata: { ...graph.metadata, ...(graph.metadata.customNodes ? { customNodes: pruneGraphCustomNodes(graph.metadata.customNodes, new Set(graph.nodes.filter((n) => !removed.has(n.id)).map((n) => n.id))) } : {}) } }); if (selected && removed.has(selected)) setSelected(null); };
  const deleteEdges = (ids: string[]) => { if (!graph || !ids.length) return; const removed = new Set(ids); mutate({ ...graph, edges: graph.edges.filter((edge) => !removed.has(edge.id)) }); };
  const addNode = (type: WorkflowGraphNodeType, defaults: Record<string, unknown>) => { if (!graph) return; const id = `${type}-${crypto.randomUUID().slice(0, 8)}`; const next: WorkflowGraphNode = { id, name: type.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase()), type, position: { x: 220 + graph.nodes.length * 36, y: 240 + (graph.nodes.length % 4) * 110 }, config: structuredClone(defaults) }; mutate({ ...graph, nodes: [...graph.nodes, next] }); chooseNode(id); };
  const connect = (source: string, target: string, sourceHandle?: string) => { if (!graph || graph.edges.some((edge) => edge.source === source && edge.target === target && edge.sourceHandle === sourceHandle)) return; mutate({ ...graph, edges: [...graph.edges, { id: `edge-${crypto.randomUUID().slice(0, 8)}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) }] }); };
  const openNode = async (id: string) => { if (!graph) return; const resolved = await resolveNode(graph.id, id); openWindow("files-manager", resolved.name, undefined, { path: resolved.path }, { multi: true }); };
  const openSessionTerminal = () => { if (!sessionView) return; setDetailsOpen(false); openWindow("os-terminal", "Terminal", undefined, { initialCwd: sessionView.session.cwd || "~" }, { multi: true }); };
  const openSessionCode = (path: string) => { setDetailsOpen(false); const name = path.split("/").filter(Boolean).at(-1) || "Code"; openWindow("code-editor", name, undefined, { path }, { multi: true }); };
  const saveSessionDraft = (stepRef?: string) => sessionView && void wrap(async () => {
    const next = await saveSessionWorkflowDraft(sessionView.session.id, stepRef);
    setGraphs(await listGraphs(true)); setGraph(next); setLibraryMode("automations"); setSelected(next.nodes[0]?.id ?? null); setDirty(false); setRun(null); setDetailsOpen(false); setMessage(`Saved ${stepRef ?? "session"} as review-first workflow draft`);
  });
  const chooseNode = (id: string | null) => { setSelected(id); if (!id) return; setPanel("inspector"); if (overlayPane) setDetailsOpen(true); };
  const chooseSessionNode = (id: string | null) => { setSessionSelected(id); if (id && overlayPane) setDetailsOpen(true); };
  const tidy = () => graph && mutate({ ...graph, nodes: tidyWorkflowNodes(graph) });
  const toggleLibrary = () => overlayPane ? setLibraryOpen(true) : setShowLibrary((value) => !value);
  const toggleDetails = () => overlayPane ? setDetailsOpen(true) : setShowDetails((value) => !value);

  const automationLibrary = <WorkflowLibrary graphs={graphs} activeId={graph?.id} search={search} onSearch={setSearch} onSelect={(id) => void wrap(() => selectGraph(id))} onBlank={async () => { await createBlank(); }} onTemplate={async (id) => { await createTemplate(id); }} onAI={async (definition) => { await createAI(definition); }} onImport={async (definition) => { await createImported(definition); }}/>;
  const library = <div className="flex h-full min-h-0 flex-col"><div className="grid grid-cols-2 gap-1 border-b p-2">{(["automations", "sessions"] as const).map((mode) => <button key={mode} type="button" className={`rounded-md px-2 py-1.5 text-xs capitalize ${libraryMode === mode ? "bg-accent font-semibold" : "text-muted-foreground hover:bg-accent/60"}`} onClick={() => setLibraryMode(mode)}>{mode}</button>)}</div><div className="min-h-0 flex-1">{libraryMode === "automations" ? automationLibrary : <WorkflowSessionLibrary activeId={sessionView?.session.id} onSelect={(id) => void wrap(() => selectSession(id))}/>}</div></div>;
  const details = libraryMode === "sessions" && sessionView ? <WorkflowSessionDetails view={sessionView} node={sessionNode} onOpenTerminal={openSessionTerminal} onOpenCode={openSessionCode} onSaveDraft={saveSessionDraft} savingDraft={busy} learning={learning}/> : graph ? <WorkflowDetails graph={graph} graphs={graphs} node={node} run={run} panel={panel} onPanel={setPanel} onNode={updateNode} onDeleteNode={(id) => deleteNodes([id])} onGraph={mutate} onRunSelect={(selectedRun) => { setRun(selectedRun); setPanel("run"); }} onRestored={(next) => { setGraph(next); setDirty(false); void listGraphs().then(setGraphs); }}/> : null;
  const toolbarItems: ToolbarItem[] = [
    { id: "library", label: "Workflow library", icon: PanelLeft, onClick: toggleLibrary, primary: true },
    { id: "refresh", label: "Refresh", icon: RefreshCw, onClick: () => void wrap(async () => { if (libraryMode === "sessions") await refreshSession(); else await load(undefined, true); }), disabled: busy },
    ...(libraryMode === "automations" && graph ? [
      { id: "duplicate", label: "Duplicate", icon: Copy, onClick: () => void duplicate(), disabled: busy },
      { id: "export", label: "Export", icon: Download, onClick: exportCurrent, disabled: busy },
      { id: "save", label: "Save", icon: Save, onClick: () => void save(), disabled: busy || !dirty, primary: true },
      { id: "run", label: "Run", icon: Play, onClick: () => void execute(), disabled: busy, primary: true },
      { id: "details", label: "Details", icon: PanelRight, onClick: toggleDetails },
      { id: "delete", label: "Delete", icon: Trash2, onClick: () => void remove(), disabled: busy },
    ] satisfies ToolbarItem[] : libraryMode === "sessions" && sessionView ? [{ id: "details", label: "Session details", icon: PanelRight, onClick: toggleDetails }] satisfies ToolbarItem[] : []),
  ];
  const toolbarCompact = overlayPane || toolbarItems.length > 7;
  const showLibraryPanel = !overlayPane && showLibrary;
  const showDetailsPanel = !overlayPane && showDetails && Boolean(libraryMode === "sessions" ? sessionView : graph);
  const headerTitle = libraryMode === "sessions" ? sessionView?.session.label : graph?.name;

  return <div ref={appRef} data-slot="workflows-feature" className="@container h-full min-h-0 min-w-0">
    <AppFrame safeArea={false} className="h-full min-w-0" toolbar={<div className="flex h-11 min-w-0 items-center gap-1 px-2 @min-[700px]:gap-2 @min-[700px]:px-3"><Workflow className="hidden size-4 shrink-0 @min-[700px]:block"/><span className="hidden shrink-0 text-sm font-semibold @min-[700px]:inline">Workflows</span>{libraryMode === "sessions" ? <Badge variant="outline" className="shrink-0"><Activity className="mr-1 size-3"/>Session</Badge> : dirty ? <Badge variant="outline" className="hidden shrink-0 @min-[520px]:inline-flex">Unsaved</Badge> : null}{libraryMode === "automations" && graph ? <Input aria-label="Workflow name" className="h-8 min-w-[7rem] max-w-56 flex-1 @max-[600px]:max-w-none" value={graph.name} onChange={(event) => mutate({ ...graph, name: event.target.value })}/> : <div className="min-w-0 flex-1 truncate text-sm font-medium">{headerTitle || (libraryMode === "sessions" ? "Sessions" : "Workflows")}</div>}{libraryMode === "automations" ? <WorkflowCreateDialog compact={overlayPane} onBlank={async () => { await createBlank(); }} onTemplate={async (id) => { await createTemplate(id); }} onAI={async (definition) => { await createAI(definition); }} onImport={async (definition) => { await createImported(definition); }}/> : null}<ResponsiveToolbar items={toolbarItems} compact={toolbarCompact} className="ml-auto shrink-0"/></div>}>
      <div className={`grid h-full min-h-0 min-w-0 ${showLibraryPanel ? "grid-cols-[300px_minmax(0,1fr)] @min-[1200px]:grid-cols-[340px_minmax(0,1fr)]" : "grid-cols-1"}`}>
        {showLibraryPanel ? <aside className="min-h-0 min-w-0 border-r">{library}</aside> : null}
        <main className="flex min-h-0 min-w-0 overflow-hidden">
          {libraryMode === "automations" ? graph ? <div className="flex min-h-0 min-w-0 flex-1 flex-col"><div className="flex min-h-10 min-w-0 shrink-0 flex-wrap items-center gap-1.5 border-b px-2 py-1 @min-[520px]:flex-nowrap @min-[520px]:gap-2"><label className="flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground"><span>Status</span><select aria-label="Workflow status" className="h-7 min-w-0 max-w-24 rounded border bg-background px-2 text-xs text-foreground" value={graph.status} onChange={(event) => mutate({ ...graph, status: event.target.value as WorkflowGraph["status"] })}><option value="draft">Draft</option><option value="active">Active</option><option value="archived">Archived</option></select></label><WorkflowNodePalette onAdd={addNode}/>{message ? <span className="w-full min-w-0 truncate text-[11px] text-muted-foreground @min-[520px]:ml-auto @min-[520px]:w-auto @min-[520px]:max-w-72">{message}</span> : null}</div><div className="min-h-0 min-w-0 flex-1 overflow-hidden"><WorkflowCanvas key={graph.id} graph={graph} selectedId={selected} onSelect={chooseNode} onCustomNodes={(customNodes) => mutate({ ...graph, metadata: { ...graph.metadata, customNodes } })} onMoveMany={(nodes) => mutate({ ...graph, nodes })} nodeStates={runStates} edgeStates={runEdgeStates} onOpen={(id) => void openNode(id)} onConnect={connect} onMove={(id, position) => mutate({ ...graph, nodes: graph.nodes.map((item) => item.id === id ? { ...item, position } : item) })} onDeleteNodes={deleteNodes} onDeleteEdges={deleteEdges} onTidy={tidy}/></div></div> : <div className="flex h-full min-w-0 flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">Create or select an automation.</div>
          : sessionView ? <div className="flex min-h-0 min-w-0 flex-1 flex-col"><div className="flex min-h-10 shrink-0 items-center gap-2 border-b px-3 text-[11px] text-muted-foreground [@media(max-height:520px)]:hidden"><span className="font-medium text-foreground">{sessionView.session.label}</span><span>read-only</span><span>·</span><span>{sessionView.steps.length} steps</span><span>·</span><span>{sessionView.shownEvents}/{sessionView.totalEvents} actions</span>{message ? <span className="ml-auto truncate">{message}</span> : null}</div><div className="min-h-0 min-w-0 flex-1 overflow-hidden"><WorkflowCanvas key={sessionView.graph.revision} graph={sessionView.graph} selectedId={sessionSelected} onSelect={chooseSessionNode} onConnect={() => undefined} onMove={() => undefined} readOnly/></div></div> : <div className="flex h-full min-w-0 flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">Select a session to inspect its semantic execution flow.</div>}
          {showDetailsPanel ? <aside className="w-[320px] shrink-0 border-l @min-[1200px]:w-[360px]">{details}</aside> : null}
        </main>
      </div>
      {overlayPane ? <><ResponsiveDialog open={libraryOpen} onOpenChange={setLibraryOpen} variant="panel" size="lg" mobileVariant="drawer-right" sheetSide="left"><ResponsiveDialog.Header><ResponsiveDialog.Title>Workflows</ResponsiveDialog.Title><ResponsiveDialog.Description>Switch between reusable automations and recorded sessions.</ResponsiveDialog.Description></ResponsiveDialog.Header><ResponsiveDialog.Body className="p-0">{library}</ResponsiveDialog.Body></ResponsiveDialog><ResponsiveDialog open={detailsOpen && Boolean(libraryMode === "sessions" ? sessionView : graph)} onOpenChange={setDetailsOpen} variant="panel" size="lg" mobileVariant="drawer-right" sheetSide="right"><ResponsiveDialog.Header><ResponsiveDialog.Title>{libraryMode === "sessions" ? sessionNode?.name ?? sessionView?.session.label ?? "Session details" : node?.name ?? graph?.name ?? "Workflow details"}</ResponsiveDialog.Title><ResponsiveDialog.Description>{libraryMode === "sessions" ? "Inspect semantic steps, grouped actions, code, and execution receipts without exposing internal session IDs." : "Inspect configuration, runs, versions, variables, and the directory without shrinking the canvas."}</ResponsiveDialog.Description></ResponsiveDialog.Header><ResponsiveDialog.Body className="p-0">{details}</ResponsiveDialog.Body></ResponsiveDialog></> : null}
    </AppFrame>
  </div>;
}
