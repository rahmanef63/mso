"use client";

import { useEffect, useMemo } from "react";
import {
  Handle,
  Position,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import type { WorkflowGraph, WorkflowGraphNode, WorkflowGraphNodeState } from "@/lib/contracts/workflow-graph";
import { GraphCanvas } from "@/components/shared/graph-canvas";
import { cn } from "@/lib/utils";

interface WorkflowNodeData extends Record<string, unknown> { node: WorkflowGraphNode; state?: WorkflowGraphNodeState }
type FlowNode = Node<WorkflowNodeData, "workflow">;
type FlowEdge = Edge;

function sourceHandles(node: WorkflowGraphNode): Array<string | undefined> {
  if (node.type === "condition") return ["true", "false"];
  if (node.type === "switch") {
    const cases = Array.isArray(node.config.cases) ? node.config.cases : [];
    return [...cases.map((row, index) => row && typeof row === "object" && typeof (row as { handle?: unknown }).handle === "string" ? String((row as { handle: string }).handle) : `case-${index + 1}`), "default"];
  }
  return [undefined];
}
function canError(node: WorkflowGraphNode) { return !["manual", "schedule", "webhook", "output"].includes(node.type); }
function canInput(node: WorkflowGraphNode) { return !["manual", "schedule", "webhook"].includes(node.type); }
function canOutput(node: WorkflowGraphNode) { return node.type !== "output"; }

function WorkflowNodeCard({ data, selected }: NodeProps<FlowNode>) {
  const { node, state } = data;
  const handles = sourceHandles(node);
  const height = Math.max(78, 48 + Math.max(handles.length, canError(node) ? 2 : 1) * 20);
  return (
    <div
      className={cn(
        "relative w-[200px] rounded-xl border bg-card px-3 py-3 shadow-sm transition-shadow",
        selected && "ring-2 ring-ring shadow-md",
        state === "failed" && "border-destructive ring-1 ring-destructive",
        state === "running" && "border-primary ring-1 ring-primary",
        ["skipped", "blocked"].includes(state ?? "") && "opacity-55",
        node.disabled && "opacity-50",
      )}
      style={{ minHeight: height }}
    >
      {canInput(node) ? <Handle type="target" position={Position.Left} id="input" className="!size-3.5 !border-2 !border-background !bg-muted-foreground" /> : null}
      <div className="truncate text-xs font-semibold">{node.name}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{node.type.replaceAll("_", " ")}{state ? ` · ${state}` : ""}</div>
      {canOutput(node) ? handles.map((handle, index) => (
        <div key={handle ?? "output"} className="absolute right-0 flex translate-x-1/2 items-center" style={{ top: 38 + index * 20 }}>
          {handle ? <span className="pointer-events-none absolute right-4 whitespace-nowrap pr-1 text-[8px] text-muted-foreground">{handle}</span> : null}
          <Handle type="source" position={Position.Right} id={handle ?? "output"} className="!relative !right-auto !top-auto !size-3.5 !translate-x-0 !translate-y-0 !border-2 !border-background !bg-muted-foreground" />
        </div>
      )) : null}
      {canError(node) ? <Handle type="source" position={Position.Bottom} id="error" className="!size-3 !border-2 !border-background !bg-destructive" /> : null}
    </div>
  );
}
const nodeTypes = { workflow: WorkflowNodeCard };

function toNodes(graph: WorkflowGraph, selectedId: string | null, nodeStates?: ReadonlyMap<string, WorkflowGraphNodeState>): FlowNode[] {
  return graph.nodes.map((node) => ({ id: node.id, type: "workflow", position: node.position, selected: node.id === selectedId, data: { node, state: nodeStates?.get(node.id) } }));
}
function toEdges(graph: WorkflowGraph, nodeStates?: ReadonlyMap<string, WorkflowGraphNodeState>): FlowEdge[] {
  return graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? "output",
    targetHandle: "input",
    type: "smoothstep",
    animated: nodeStates?.get(edge.source) === "running" || nodeStates?.get(edge.target) === "running",
  }));
}

export function WorkflowCanvas({ graph, selectedId, onSelect, onMove, onConnect, nodeStates, onOpen, onDeleteNodes, onDeleteEdges, onTidy }: {
  graph: WorkflowGraph;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, position: { x: number; y: number }) => void;
  onConnect: (source: string, target: string, sourceHandle?: string) => void;
  nodeStates?: ReadonlyMap<string, WorkflowGraphNodeState>;
  onOpen?: (id: string) => void;
  onDeleteNodes?: (ids: string[]) => void;
  onDeleteEdges?: (ids: string[]) => void;
  onTidy?: () => void;
}) {
  const mappedNodes = useMemo(() => toNodes(graph, selectedId, nodeStates), [graph, nodeStates, selectedId]);
  const mappedEdges = useMemo(() => toEdges(graph, nodeStates), [graph, nodeStates]);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(mappedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>(mappedEdges);
  useEffect(() => setNodes(mappedNodes), [mappedNodes, setNodes]);
  useEffect(() => setEdges(mappedEdges), [mappedEdges, setEdges]);

  const connect = (connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    const handle = connection.sourceHandle && connection.sourceHandle !== "output" ? connection.sourceHandle : undefined;
    onConnect(connection.source, connection.target, handle);
  };

  return (
    <GraphCanvas<FlowNode, FlowEdge>
      ariaLabel="Workflow canvas"
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={connect}
      onPaneClick={() => onSelect(null)}
      onNodeClick={(_, item) => onSelect(item.id)}
      onNodeDoubleClick={(_, item) => { const node = item.data.node; if ((node.type === "project" || node.type === "folder") && onOpen) onOpen(node.id); }}
      onNodeDragStop={(_, item) => onMove(item.id, item.position)}
      onNodesDelete={(items) => onDeleteNodes?.(items.map((item) => item.id))}
      onEdgesDelete={(items) => onDeleteEdges?.(items.map((item) => item.id))}
      isValidConnection={(connection) => Boolean(connection.source && connection.target && connection.source !== connection.target && !graph.edges.some((edge) => edge.source === connection.source && edge.target === connection.target && (edge.sourceHandle ?? undefined) === (connection.sourceHandle === "output" ? undefined : connection.sourceHandle ?? undefined)))}
      nodesDraggable
      nodesConnectable
      edgesReconnectable={false}
      deleteKeyCode={["Backspace", "Delete"]}
      onTidy={onTidy}
      snapToGrid
      snapGrid={[12, 12]}
      defaultEdgeOptions={{ type: "smoothstep" }}
    />
  );
}
