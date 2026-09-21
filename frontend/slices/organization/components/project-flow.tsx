"use client";
import { useMemo, useRef, useState } from "react";
import { FileText, FolderKanban, Link2, Pencil, Plus, X } from "lucide-react";
import { Handle, MarkerType, Position, type Edge, type NodeProps } from "@xyflow/react";
import { useGraphProjection } from "@/components/shared/use-graph-projection";
import { GraphCanvas } from "@/components/shared/graph-canvas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { emptyOrganizationFlow, type OrganizationFlowAction } from "@/lib/contracts/organization-flow";
import type { OrganizationUnit } from "@/lib/contracts/organization";
import { type ProjectCanvasNode as FlowNode } from "../lib/flow-projection";
import { organizationProjectFlowVisibleIds } from "../lib/project-flow-focus";
import { projectCustomNodes, moveCustomNode, type CustomCanvasNode } from "@/components/shared/graph-custom-projection";
import { GraphCustomControls } from "@/components/shared/graph-custom-controls";
import { GraphCustomCard } from "@/components/shared/graph-custom-card";
import { graphRoutedEdgeTypes } from "@/components/shared/graph-routed-edge";
import type { GraphCustomNode } from "@/lib/contracts/graph-custom-nodes";
import { ProjectFlowEditor, type FlowDraft } from "./project-flow-editor";

function ProjectCard({ data, selected }: NodeProps<FlowNode>) {
  const item = data.item;
  return <div className={cn("w-60 rounded-xl border bg-card p-3 shadow-sm", selected && "ring-2 ring-ring", item.kind === "group" && "border-primary/50", item.kind === "note" && "border-dashed")}>
    <Handle type="target" position={Position.Top} className="!size-3 !bg-muted-foreground"/>
    <div className="flex items-start gap-2"><FolderKanban className="mt-0.5 size-4 shrink-0 text-muted-foreground"/><div className="min-w-0 flex-1"><div className="break-words text-sm font-semibold">{item.title}</div><p className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground">{item.summary || "Open for details"}</p></div></div>
    <div className="mt-2 flex gap-1"><Badge variant="secondary" className="text-[10px]">{item.kind}</Badge><Badge variant="outline" className="text-[10px]">{item.status}</Badge></div>
    <Handle type="source" position={Position.Bottom} className="!size-3 !bg-muted-foreground"/>
  </div>;
}
const nodeTypes = { project: ProjectCard, customGroup: GraphCustomCard };
type CanvasNode = FlowNode | CustomCanvasNode;

type Props = { unit: OrganizationUnit; onSave: (action: OrganizationFlowAction, data: Record<string, unknown>) => Promise<void> };
export function ProjectFlow({ unit, onSave }: Props) {
  const flow = useMemo(() => unit.projectFlow ?? emptyOrganizationFlow(), [unit.projectFlow]);
  const [query, setQuery] = useState(""), [selectedId, setSelectedId] = useState<string | null>(null), [selectedGroupId, setSelectedGroupId] = useState<string | null>(null), [focus, setFocus] = useState(false);
  const [draft, setDraft] = useState<FlowDraft | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const groups = useMemo(() => flow.customNodes ?? [], [flow.customNodes]);
  const pending = useRef(false);
  const visible = useMemo(() => organizationProjectFlowVisibleIds({
    nodes: flow.nodes,
    edges: flow.edges,
    groups,
    query,
    focusNodeId: focus ? selectedId : null,
    focusGroupId: focus ? selectedGroupId : null,
  }), [flow.nodes, flow.edges, groups, query, focus, selectedId, selectedGroupId]);
  const mapped = useMemo(() => {
    const base: FlowNode[] = flow.nodes.map((item) => ({ id: item.id, type: "project", position: item.position, data: { item } }));
    const lines: Edge[] = flow.edges.map((edge) => ({ ...edge, type: "routed", markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20, color: "var(--muted-foreground)" }, style: { stroke: "var(--muted-foreground)" } }));
    const result = projectCustomNodes(base, lines, groups, selectedGroupId ? [selectedGroupId] : selectedId ? [selectedId] : []);
    const ids = new Set(result.nodes.filter((node) => node.type === "customGroup" ? node.data.group.nodeIds.some((id) => visible.has(id)) : visible.has(node.id)).map((node) => node.id));
    return { nodes: result.nodes.filter((node) => ids.has(node.id)), edges: result.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)) };
  }, [flow.nodes, flow.edges, groups, selectedGroupId, selectedId, visible]);
  const { nodes, edges, onNodesChange, onEdgesChange, reset } = useGraphProjection<CanvasNode, Edge>(mapped);
  const selectedIds = nodes.filter((node) => node.selected).map((node) => node.id);
  const selected = selectedIds.length <= 1 ? flow.nodes.find((node) => node.id === selectedId) : undefined;
  const selectedGroup = selectedGroupId ? groups.find((group) => group.id === selectedGroupId) : undefined;
  const selectedGroupMembers = selectedGroup ? selectedGroup.nodeIds.map((id) => flow.nodes.find((node) => node.id === id)).filter((node): node is NonNullable<typeof node> => Boolean(node)) : [];
  const save = async (action: OrganizationFlowAction, data: Record<string, unknown>) => {
    if (pending.current) throw new Error("A change is still saving. Try again after it completes.");
    pending.current = true; setBusy(true); setError("");
    try { await onSave(action, { ...data, unitId: unit.id }); }
    catch (cause) { const message = cause instanceof Error ? cause.message : "Save failed"; setError(message); throw cause; }
    finally { pending.current = false; setBusy(false); }
  };
  const quickSave = (action: OrganizationFlowAction, data: Record<string, unknown>) => { if (pending.current) return; void save(action, data).catch(() => reset()); };
  const changeGroups = (customNodes: GraphCustomNode[]) => {
    quickSave("flow_custom_nodes", { customNodes });
    setSelectedId(null);
    if (selectedGroupId && !customNodes.some((group) => group.id === selectedGroupId)) { setSelectedGroupId(null); setFocus(false); }
  };
  const move = (items: CanvasNode[]) => {
    let moved = flow.nodes;
    for (const item of items) { const group = groups.find((row) => row.id === item.id); moved = group ? moveCustomNode(moved, group, item.position) : moved.map((node) => node.id === item.id ? { ...node, position: item.position } : node); }
    const positions = moved.filter((node, i) => node.position !== flow.nodes[i].position).map(({ id, position }) => ({ id, position }));
    if (positions.length) quickSave("flow_nodes_move", { positions });
  };
  return <div data-slot="organization-project-flow" className="flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
      <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{flow.title}</div><p className="text-[10px] text-muted-foreground">{flow.nodes.length} nodes · {flow.edges.length} connections · {busy ? "Saving…" : "Stored in this organization"}</p></div>
      <Button variant="outline" size="sm" onClick={() => setDraft({ kind: "notes" })}><FileText className="mr-1 size-3.5"/>Notes</Button>
      <Button variant="outline" size="sm" disabled={flow.nodes.length < 2 || busy} onClick={() => setDraft({ kind: "edge" })}><Link2 className="mr-1 size-3.5"/>Connect</Button>
      <Button size="sm" disabled={busy} onClick={() => setDraft({ kind: "node" })}><Plus className="mr-1 size-3.5"/>Node</Button>
      <div className="flex w-full items-center gap-2"><Input aria-label="Search project flow" className="h-8 min-w-0 flex-1" placeholder="Search projects, activities, groups, or notes…" value={query} onChange={(e) => setQuery(e.target.value)}/><Button size="sm" variant={focus ? "secondary" : "outline"} disabled={!selected && !selectedGroup} onClick={() => setFocus(!focus)}>{focus ? "Exit focus" : selectedGroup ? "Focus group" : "Focus"}</Button></div>
    </div>
    <GraphCustomControls groups={groups} selectedIds={selectedIds} nodeIds={flow.nodes.map((node) => node.id)} onChange={changeGroups} disabled={busy}/>
    {error ? <div role="alert" className="shrink-0 border-b px-3 py-2 text-xs text-destructive">{error} Refresh the organization before retrying a conflicting change.</div> : null}
    <div className="relative min-h-0 flex-1">
      {flow.nodes.length ? <GraphCanvas<CanvasNode, Edge>
        ariaLabel="Organization project flow canvas" nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={graphRoutedEdgeTypes}
        nodesDraggable={!busy} nodesConnectable={!busy} deleteKeyCode={null} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        onNodeClick={(event, node) => {
          if (event.ctrlKey || event.metaKey) return;
          if (node.type === "customGroup") { setSelectedGroupId(node.id); setSelectedId(null); return; }
          setSelectedGroupId(null); setSelectedId(node.id);
        }} onNodeDoubleClick={(_, node) => { if (node.type === "customGroup") changeGroups(groups.map((group) => group.id === node.id ? { ...group, collapsed: false } : group)); else setDraft({ kind: "node", node: (node as FlowNode).data.item }); }}
        onPaneClick={() => { setSelectedId(null); setSelectedGroupId(null); setFocus(false); }}
        onNodeDragStop={(_, node, items) => move(items.length ? items : [node])} onSelectionDragStop={(_, items) => move(items)}
        onConnect={(connection) => { if (flow.nodes.some((n) => n.id === connection.source) && flow.nodes.some((n) => n.id === connection.target)) quickSave("flow_edge_upsert", { edge: { source: connection.source, target: connection.target, label: "" } }); }}
        onEdgeClick={(_, edge) => setDraft({ kind: "edge", edge: flow.edges.find((item) => item.id === edge.id) })}
        compactFitNodeIds={selectedGroup && selectedGroup.collapsed ? [selectedGroup.id] : selected ? [selected.id] : nodes.slice(0, 2).map((node) => node.id)}
      /> : <div className="grid h-full place-items-center p-6"><div className="max-w-sm text-center"><FolderKanban className="mx-auto mb-3 size-7 text-muted-foreground"/><h3 className="font-medium">Project flow inside {unit.name}</h3><p className="mt-2 text-sm text-muted-foreground">Add projects, activities, notes and connections here. The organization overview stays compact.</p><Button className="mt-4" onClick={() => setDraft({ kind: "node" })}>Add first node</Button></div></div>}
      {selectedGroup ? <div data-slot="organization-group-focus" className="absolute inset-x-2 top-2 z-10 max-h-[calc(100%-1rem)] overflow-y-auto rounded-xl border bg-popover p-3 shadow-lg @min-[700px]:left-auto @min-[700px]:right-3 @min-[700px]:w-80">
        <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Group focus</div><h3 className="mt-1 break-words text-sm font-semibold">{selectedGroup.name}</h3><p className="mt-1 text-xs text-muted-foreground">{selectedGroupMembers.length} mapped members · {selectedGroup.collapsed ? "collapsed" : "expanded"}</p></div><Button size="icon" variant="ghost" className="size-7 shrink-0" aria-label="Close group details" onClick={() => { setSelectedGroupId(null); setFocus(false); }}><X className="size-4"/></Button></div>
        <div className="mt-3 space-y-1.5">{selectedGroupMembers.map((member) => <button type="button" key={member.id} className="flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left hover:bg-accent/60" onClick={() => { setSelectedGroupId(null); setSelectedId(member.id); }}><span className="min-w-0 truncate text-xs font-medium">{member.title}</span><Badge variant="outline" className="shrink-0 text-[9px]">{member.status}</Badge></button>)}</div>
        <div className="mt-3 grid grid-cols-2 gap-2"><Button size="sm" variant={focus ? "secondary" : "outline"} onClick={() => setFocus(!focus)}>{focus ? "Exit focus" : "Focus group"}</Button><Button size="sm" variant="outline" onClick={() => changeGroups(groups.map((group) => group.id === selectedGroup.id ? { ...group, collapsed: !group.collapsed } : group))}>{selectedGroup.collapsed ? "Expand" : "Collapse"}</Button></div>
        <Button className="mt-2 w-full" size="sm" variant="ghost" onClick={() => changeGroups(groups.filter((group) => group.id !== selectedGroup.id))}>Ungroup presentation only</Button>
      </div> : null}
      {selected ? <div className="absolute inset-x-2 top-2 z-10 max-h-[calc(100%-1rem)] overflow-y-auto rounded-xl border bg-popover p-3 shadow-lg @min-[700px]:left-auto @min-[700px]:right-3 @min-[700px]:w-80">
        <div className="flex items-start gap-2"><h3 className="min-w-0 flex-1 break-words text-sm font-semibold">{selected.title}</h3><Button size="icon" variant="ghost" className="size-7 shrink-0" aria-label="Close node details" onClick={() => setSelectedId(null)}><X className="size-4"/></Button></div>
        <div className="mt-2 flex gap-1"><Badge variant="secondary">{selected.kind}</Badge><Badge variant="outline">{selected.status}</Badge></div>
        {selected.summary ? <p className="mt-3 whitespace-pre-wrap break-words text-sm">{selected.summary}</p> : null}
        {selected.notes ? <div className="mt-3 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{selected.notes}</div> : null}
        {selected.projectRef ? <p className="mt-3 break-all text-xs">Project reference: {selected.projectRef}</p> : null}
        <Button className="mt-3 w-full" size="sm" onClick={() => setDraft({ kind: "node", node: selected })}><Pencil className="mr-2 size-3"/>Edit node</Button>
      </div> : null}
    </div>
    <ProjectFlowEditor draft={draft} flow={flow} onClose={() => setDraft(null)} onSave={save}/>
  </div>;
}
