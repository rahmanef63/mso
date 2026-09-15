"use client";
import { useMemo, useState } from "react";
import { FolderOpen, Link2, Trash2 } from "lucide-react";
import type { WorkflowGraph, WorkflowGraphNode, WorkflowGraphNodeType } from "@/lib/contracts/workflow-graph";
import { WORKFLOW_GRAPH_NODE_TYPES } from "@/lib/contracts/workflow-graph";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { openWindow } from "@/features/appshell";
import { resolveNode } from "../lib/api";

export function WorkflowInspector({ graph, node, onNode, onDeleteNode, onGraph }: {
  graph: WorkflowGraph; node: WorkflowGraphNode | null;
  onNode: (node: WorkflowGraphNode) => void; onDeleteNode: (id: string) => void; onGraph: (graph: WorkflowGraph) => void;
}) {
  const [configText, setConfigText] = useState(node ? JSON.stringify(node.config, null, 2) : "{}");
  const [target, setTarget] = useState("");
  const outgoing = useMemo(() => node ? graph.edges.filter((edge) => edge.source === node.id) : [], [graph.edges, node]);
  if (!node) return <div className="p-4 text-xs text-muted-foreground">Select a node to edit config, edges, or open project folders.</div>;
  const patch = (next: Partial<WorkflowGraphNode>) => onNode({ ...node, ...next });
  const applyConfig = () => { try { patch({ config: JSON.parse(configText) as Record<string, unknown> }); } catch { /* keep draft text */ } };
  const addEdge = () => {
    if (!target || target === node.id) return;
    const id = `edge-${crypto.randomUUID().slice(0, 8)}`;
    onGraph({ ...graph, edges: [...graph.edges, { id, source: node.id, target }] }); setTarget("");
  };
  const openTarget = async () => {
    const resolved = await resolveNode(graph.id, node.id);
    openWindow("files-manager", resolved.name, undefined, { path: resolved.path }, { multi: true });
  };
  return <div className="space-y-4 p-3 text-xs">
    <div><label className="mb-1 block text-muted-foreground">Name</label><Input value={node.name} onChange={(e) => patch({ name: e.target.value })} /></div>
    <div><label className="mb-1 block text-muted-foreground">Type</label><select className="h-9 w-full rounded-md border bg-background px-2" value={node.type} onChange={(e) => patch({ type: e.target.value as WorkflowGraphNodeType })}>{WORKFLOW_GRAPH_NODE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></div>
    <div><label className="mb-1 block text-muted-foreground">Config JSON</label><Textarea className="min-h-36 font-mono text-[11px]" value={configText} onChange={(e) => setConfigText(e.target.value)} onBlur={applyConfig} /></div>
    {(node.type === "project" || node.type === "folder") && <Button variant="secondary" size="sm" className="w-full" onClick={() => void openTarget()}><FolderOpen className="mr-2 size-3" />Open real folder</Button>}
    <div className="space-y-2"><div className="font-medium">Outgoing edges</div>{outgoing.map((edge) => <div key={edge.id} className="flex items-center justify-between rounded border p-2"><span className="truncate">→ {graph.nodes.find((item) => item.id === edge.target)?.name ?? edge.target}</span><Button size="icon" variant="ghost" onClick={() => onGraph({ ...graph, edges: graph.edges.filter((item) => item.id !== edge.id) })}><Trash2 className="size-3" /></Button></div>)}
      <div className="flex gap-1"><select className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2" value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Connect to…</option>{graph.nodes.filter((item) => item.id !== node.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><Button size="sm" variant="outline" onClick={addEdge}><Link2 className="size-3" /></Button></div>
    </div>
    <Button variant="destructive" size="sm" className="w-full" onClick={() => onDeleteNode(node.id)}><Trash2 className="mr-2 size-3" />Delete node</Button>
  </div>;
}
