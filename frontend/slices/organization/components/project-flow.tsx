"use client";
import { useMemo, useRef, useState } from "react";
import { FileText, FolderKanban, Link2, LocateFixed, Network, Pencil, Plus, X } from "lucide-react";
import { Handle, MarkerType, Position, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { useGraphProjection } from "@/components/shared/use-graph-projection";
import { GraphCanvas } from "@/components/shared/graph-canvas";
import { GraphNodeShell } from "@/components/shared/graph-node-shell";
import { graphFocusClusterIds } from "@/components/shared/graph-focus";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { emptyOrganizationFlow, type OrganizationFlowAction, type OrganizationFlowNode } from "@/lib/contracts/organization-flow";
import type { OrganizationUnit } from "@/lib/contracts/organization";
import { projectCustomNodes, moveGraphNodesWithCustomGroups, type CustomCanvasNode } from "@/components/shared/graph-custom-projection";
import { GraphCustomControls } from "@/components/shared/graph-custom-controls";
import { GraphCustomCard } from "@/components/shared/graph-custom-card";
import { graphRoutedEdgeTypes } from "@/components/shared/graph-routed-edge";
import type { GraphCustomNode } from "@/lib/contracts/graph-custom-nodes";
import { ProjectFlowEditor, type FlowDraft } from "./project-flow-editor";

type FlowNode = Node<{ item: OrganizationFlowNode }, "project">;
type CanvasNode = FlowNode | CustomCanvasNode;
type ViewMode = "focus" | "map";

function ProjectCard({ data, selected }: NodeProps<FlowNode>) {
  const item = data.item;
  return <GraphNodeShell selected={selected} className={cn("w-60", item.kind === "group" && "border-primary/50", item.kind === "note" && "border-dashed")}>
    <Handle type="target" position={Position.Top} className="!size-3 !bg-muted-foreground"/>
    <div className="flex items-start gap-2"><FolderKanban className="mt-0.5 size-4 shrink-0 text-muted-foreground"/><div className="min-w-0 flex-1"><div className="break-words text-sm font-semibold">{item.title}</div><p className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground">{item.summary || "Open for details"}</p></div></div>
    <div className="mt-2 flex gap-1"><Badge variant="secondary" className="text-[10px]">{item.kind}</Badge><Badge variant="outline" className="text-[10px]">{item.status}</Badge></div>
    <Handle type="source" position={Position.Bottom} className="!size-3 !bg-muted-foreground"/>
  </GraphNodeShell>;
}
const nodeTypes = { project: ProjectCard, customGroup: GraphCustomCard };

type Props = { unit: OrganizationUnit; onSave: (action: OrganizationFlowAction, data: Record<string, unknown>) => Promise<void> };
export function ProjectFlow({ unit, onSave }: Props) {
  const flow = useMemo(() => unit.projectFlow ?? emptyOrganizationFlow(), [unit.projectFlow]);
  const [query, setQuery] = useState(""), [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("focus"), [focusDepth, setFocusDepth] = useState(1);
  const [draft, setDraft] = useState<FlowDraft | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const groups = useMemo(() => flow.customNodes ?? [], [flow.customNodes]);
  const pending = useRef(false);
  const nodeIds = useMemo(() => flow.nodes.map((node) => node.id), [flow.nodes]);
  const visible = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (search) {
      const matches = flow.nodes
        .filter((node) => `${node.title} ${node.summary} ${node.kind}`.toLowerCase().includes(search))
        .map((node) => node.id);
      if (!matches.length) return new Set<string>();
      return new Set(graphFocusClusterIds(nodeIds, flow.edges, matches, { depth: 1, maxNodes: 36, fallbackLimit: 1 }));
    }
    if (viewMode === "map") return new Set(nodeIds);
    return new Set(graphFocusClusterIds(nodeIds, flow.edges, selectedId ? [selectedId] : [], {
      depth: focusDepth,
      maxNodes: focusDepth > 1 ? 24 : 12,
      fallbackLimit: 1,
    }));
  }, [flow.edges, flow.nodes, focusDepth, nodeIds, query, selectedId, viewMode]);
  const mapped = useMemo(() => {
    const base: FlowNode[] = flow.nodes.map((item) => ({ id: item.id, type: "project", position: item.position, data: { item } }));
    const lines: Edge[] = flow.edges.map((edge) => ({ ...edge, type: "routed", markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20, color: "var(--muted-foreground)" }, style: { stroke: "var(--muted-foreground)" } }));
    const result = projectCustomNodes(base, lines, groups, selectedId ? [selectedId] : []);
    const ids = new Set(result.nodes.filter((node) => node.type === "customGroup" ? node.data.group.nodeIds.some((id) => visible.has(id)) : visible.has(node.id)).map((node) => node.id));
    return { nodes: result.nodes.filter((node) => ids.has(node.id)), edges: result.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)) };
  }, [flow.edges, flow.nodes, groups, selectedId, visible]);
  const { nodes, edges, onNodesChange, onEdgesChange, reset } = useGraphProjection<CanvasNode, Edge>(mapped);
  const selectedIds = nodes.filter((node) => node.selected).map((node) => node.id);
  const selected = selectedIds.length <= 1 && selectedId && visible.has(selectedId) ? flow.nodes.find((node) => node.id === selectedId) : undefined;
  const viewportIds = nodes.map((node) => node.id).slice(0, viewMode === "map" && !query ? 0 : 12);

  const save = async (action: OrganizationFlowAction, data: Record<string, unknown>) => {
    if (pending.current) throw new Error("A change is still saving. Try again after it completes.");
    pending.current = true; setBusy(true); setError("");
    try { await onSave(action, { ...data, unitId: unit.id }); }
    catch (cause) { const message = cause instanceof Error ? cause.message : "Save failed"; setError(message); throw cause; }
    finally { pending.current = false; setBusy(false); }
  };
  const quickSave = (action: OrganizationFlowAction, data: Record<string, unknown>) => { if (pending.current) return; void save(action, data).catch(() => reset()); };
  const changeGroups = (customNodes: GraphCustomNode[]) => { quickSave("flow_custom_nodes", { customNodes }); setSelectedId(null); };
  const move = (items: CanvasNode[]) => {
    const moved = moveGraphNodesWithCustomGroups(flow.nodes, groups, items);
    const positions = moved.filter((node, i) => node.position !== flow.nodes[i].position).map(({ id, position }) => ({ id, position }));
    if (positions.length) quickSave("flow_nodes_move", { positions });
  };
  const selectNode = (id: string | null) => { setSelectedId(id); if (id && viewMode === "focus") setFocusDepth(1); };

  return <div data-slot="organization-project-flow" className="@container flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 [@media(max-height:520px)]:flex-nowrap [@media(max-height:520px)]:py-1">
      <div className="min-w-0 flex-1 [@media(max-height:520px)]:hidden"><div className="truncate text-sm font-medium">{flow.title}</div><p className="text-[10px] text-muted-foreground">{flow.nodes.length} nodes · {flow.edges.length} connections · {visible.size} visible · {busy ? "Saving…" : "Stored in this organization"}</p></div>
      <Button variant="outline" size="sm" className="[@media(max-height:520px)]:size-8 [@media(max-height:520px)]:px-0" onClick={() => setDraft({ kind: "notes" })}><FileText className="mr-1 size-3.5 [@media(max-height:520px)]:mr-0"/><span className="[@media(max-height:520px)]:sr-only">Notes</span></Button>
      <Button variant="outline" size="sm" className="[@media(max-height:520px)]:size-8 [@media(max-height:520px)]:px-0" disabled={flow.nodes.length < 2 || busy} onClick={() => setDraft({ kind: "edge" })}><Link2 className="mr-1 size-3.5 [@media(max-height:520px)]:mr-0"/><span className="[@media(max-height:520px)]:sr-only">Connect</span></Button>
      <Button size="sm" className="[@media(max-height:520px)]:size-8 [@media(max-height:520px)]:px-0" disabled={busy} onClick={() => setDraft({ kind: "node" })}><Plus className="mr-1 size-3.5 [@media(max-height:520px)]:mr-0"/><span className="[@media(max-height:520px)]:sr-only">Node</span></Button>
      <div className="flex w-full min-w-0 flex-wrap items-center gap-2 [@media(max-height:520px)]:w-auto [@media(max-height:520px)]:flex-1 [@media(max-height:520px)]:flex-nowrap">
        <Input aria-label="Search project flow" className="h-8 min-w-40 flex-1 [@media(max-height:520px)]:min-w-24" placeholder="Search projects, activities, or notes…" value={query} onChange={(event) => setQuery(event.target.value)}/>
        <div className="flex shrink-0 items-center rounded-lg border p-0.5">
          <Button size="sm" variant={viewMode === "focus" ? "secondary" : "ghost"} className="h-7" onClick={() => setViewMode("focus")}><LocateFixed className="mr-1 size-3.5"/>Focus</Button>
          <Button size="sm" variant={viewMode === "map" ? "secondary" : "ghost"} className="h-7" onClick={() => setViewMode("map")}><Network className="mr-1 size-3.5"/>Map</Button>
        </div>
        {viewMode === "focus" && !query ? <Button size="sm" variant="outline" className="h-8" onClick={() => setFocusDepth((depth) => depth === 1 ? 2 : 1)}>{focusDepth === 1 ? "Expand neighbors" : "Collapse cluster"}</Button> : null}
      </div>
    </div>
    {groups.length || selectedIds.length ? <GraphCustomControls groups={groups} selectedIds={selectedIds} nodeIds={flow.nodes.map((node) => node.id)} onChange={changeGroups} disabled={busy}/> : null}
    {error ? <div role="alert" className="shrink-0 border-b px-3 py-2 text-xs text-destructive">{error} Refresh the organization before retrying a conflicting change.</div> : null}
    <div className={cn("relative grid min-h-0 flex-1 grid-cols-1", selected && "@min-[920px]:grid-cols-[minmax(0,1fr)_320px]")}>
      <div className="relative min-h-0 min-w-0">
        {flow.nodes.length ? nodes.length ? <GraphCanvas<CanvasNode, Edge>
          ariaLabel="Organization project flow canvas" nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={graphRoutedEdgeTypes}
          nodesDraggable={!busy} nodesConnectable={!busy} deleteKeyCode={null} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onNodeClick={(event, node) => { if (!event.ctrlKey && !event.metaKey) selectNode(node.type === "customGroup" ? null : node.id); }} onNodeDoubleClick={(_, node) => { if (node.type === "customGroup") changeGroups(groups.map((group) => group.id === node.id ? { ...group, collapsed: false } : group)); else setDraft({ kind: "node", node: (node as FlowNode).data.item }); }}
          onPaneClick={() => selectNode(null)}
          onNodeDragStop={(_, node, items) => move(items.length ? items : [node])} onSelectionDragStop={(_, items) => move(items)}
          onConnect={(connection) => { if (flow.nodes.some((node) => node.id === connection.source) && flow.nodes.some((node) => node.id === connection.target)) quickSave("flow_edge_upsert", { edge: { source: connection.source, target: connection.target, label: "" } }); }}
          onEdgeClick={(_, edge) => setDraft({ kind: "edge", edge: flow.edges.find((item) => item.id === edge.id) })}
          compactFitNodeIds={selected ? [selected.id] : nodes.slice(0, 4).map((node) => node.id)}
          initialFitNodeIds={viewportIds}
          initialFitMaxZoom={0.96}
        /> : <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">No nodes match this search.</div>
        : <div className="grid h-full place-items-center p-6"><div className="max-w-sm text-center"><FolderKanban className="mx-auto mb-3 size-7 text-muted-foreground"/><h3 className="font-medium">Project flow inside {unit.name}</h3><p className="mt-2 text-sm text-muted-foreground">Add projects, activities, notes and connections here. The organization overview stays compact.</p><Button className="mt-4" onClick={() => setDraft({ kind: "node" })}>Add first node</Button></div></div>}
      </div>
      {selected ? <aside className="absolute inset-x-2 top-2 z-10 max-h-[calc(100%-1rem)] overflow-y-auto rounded-xl border bg-popover p-3 shadow-lg @min-[920px]:static @min-[920px]:inset-auto @min-[920px]:max-h-none @min-[920px]:rounded-none @min-[920px]:border-y-0 @min-[920px]:border-r-0 @min-[920px]:border-l @min-[920px]:bg-card/60 @min-[920px]:shadow-none">
        <div className="flex items-start gap-2"><h3 className="min-w-0 flex-1 break-words text-sm font-semibold">{selected.title}</h3><Button size="icon" variant="ghost" className="size-7 shrink-0" aria-label="Close node details" onClick={() => selectNode(null)}><X className="size-4"/></Button></div>
        <div className="mt-2 flex gap-1"><Badge variant="secondary">{selected.kind}</Badge><Badge variant="outline">{selected.status}</Badge></div>
        {selected.summary ? <p className="mt-3 whitespace-pre-wrap break-words text-sm">{selected.summary}</p> : null}
        {selected.notes ? <div className="mt-3 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{selected.notes}</div> : null}
        {selected.projectRef ? <p className="mt-3 break-all text-xs">Project reference: {selected.projectRef}</p> : null}
        <Button className="mt-3 w-full" size="sm" onClick={() => setDraft({ kind: "node", node: selected })}><Pencil className="mr-2 size-3"/>Edit node</Button>
      </aside> : null}
    </div>
    <ProjectFlowEditor draft={draft} flow={flow} onClose={() => setDraft(null)} onSave={save}/>
  </div>;
}
