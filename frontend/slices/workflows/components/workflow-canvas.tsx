"use client";
import { useEffect, useMemo } from "react";
import {
  Handle, MarkerType, Position, useEdgesState, useNodesState,
  type Connection, type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import type { WorkflowGraph, WorkflowGraphNode, WorkflowGraphNodeState, WorkflowGraphRunEdgeState } from "@/lib/contracts/workflow-graph";
import { GraphCanvas } from "@/components/shared/graph-canvas";
import { cn } from "@/lib/utils";

interface WorkflowNodeData extends Record<string, unknown> { node: WorkflowGraphNode; state?: WorkflowGraphNodeState }
type FlowNode = Node<WorkflowNodeData, "workflow">;
type FlowEdge = Edge;

function sourceHandles(node: WorkflowGraphNode): Array<string | undefined> {
  if (node.type === "condition") return ["true", "false"];
  if (node.type === "switch") { const cases = Array.isArray(node.config.cases) ? node.config.cases : []; return [...cases.map((row,index)=>row&&typeof row==="object"&&typeof (row as {handle?:unknown}).handle==="string"?String((row as {handle:string}).handle):`case-${index+1}`),"default"]; }
  return [undefined];
}
const canError=(node:WorkflowGraphNode)=>!["manual","schedule","webhook","output"].includes(node.type);
const canInput=(node:WorkflowGraphNode)=>!["manual","schedule","webhook"].includes(node.type);
const canOutput=(node:WorkflowGraphNode)=>node.type!=="output";
function WorkflowNodeCard({data,selected}:NodeProps<FlowNode>){
  const{node,state}=data,handles=sourceHandles(node),height=Math.max(78,48+Math.max(handles.length,canError(node)?2:1)*20);
  return <div className={cn("relative w-[200px] rounded-xl border bg-card px-3 py-3 shadow-sm transition-shadow",selected&&"ring-2 ring-ring shadow-md",state==="failed"&&"border-destructive ring-1 ring-destructive",state==="running"&&"border-primary ring-1 ring-primary",["skipped","blocked"].includes(state??"")&&"opacity-55",node.disabled&&"opacity-50")} style={{minHeight:height}}>
    {canInput(node)?<Handle type="target" position={Position.Left} id="input" className="!size-3.5 !border-2 !border-background !bg-muted-foreground"/>:null}
    <div className="truncate text-xs font-semibold">{node.name}</div><div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{node.type.replaceAll("_"," ")}{state?` · ${state}`:""}</div>
    {canOutput(node)?handles.map((handle,index)=><div key={handle??"output"} className="absolute right-0 flex translate-x-1/2 items-center" style={{top:38+index*20}}>{handle?<span className="pointer-events-none absolute right-4 whitespace-nowrap pr-1 text-[8px] text-muted-foreground">{handle}</span>:null}<Handle type="source" position={Position.Right} id={handle??"output"} className="!relative !right-auto !top-auto !size-3.5 !translate-x-0 !translate-y-0 !border-2 !border-background !bg-muted-foreground"/></div>):null}
    {canError(node)?<Handle type="source" position={Position.Bottom} id="error" className="!size-3 !border-2 !border-background !bg-destructive"/>:null}
  </div>;
}
const nodeTypes={workflow:WorkflowNodeCard};
function toNodes(graph:WorkflowGraph,selectedId:string|null,nodeStates?:ReadonlyMap<string,WorkflowGraphNodeState>):FlowNode[]{return graph.nodes.map((node)=>{const handles=sourceHandles(node),height=Math.max(78,48+Math.max(handles.length,canError(node)?2:1)*20);return{id:node.id,type:"workflow",position:node.position,width:200,height,selected:node.id===selectedId,data:{node,state:nodeStates?.get(node.id)}};});}
function edgeVisual(edge:WorkflowGraph["edges"][number],state:WorkflowGraphRunEdgeState|undefined,nodeStates?:ReadonlyMap<string,WorkflowGraphNodeState>){
  const running=nodeStates?.get(edge.source)==="running"||nodeStates?.get(edge.target)==="running",error=edge.sourceHandle==="error",branch=Boolean(edge.sourceHandle&&edge.sourceHandle!=="output"),disabled=state==="disabled";
  const stroke=error?"var(--destructive)":running?"var(--accent)":state==="enabled"?"var(--success)":"var(--sep-strong)";
  return {animated:running&&!disabled,style:{stroke,strokeWidth:running?2.5:state==="enabled"?2:1.5,opacity:disabled?.24:state==="pending"?.55:1,strokeDasharray:disabled?"2 6":branch?"7 5":undefined},markerEnd:{type:MarkerType.ArrowClosed,width:18,height:18,color:stroke}};
}
function toEdges(graph:WorkflowGraph,nodeStates?:ReadonlyMap<string,WorkflowGraphNodeState>,edgeStates?:ReadonlyMap<string,WorkflowGraphRunEdgeState>):FlowEdge[]{return graph.edges.map((edge)=>({id:edge.id,source:edge.source,target:edge.target,sourceHandle:edge.sourceHandle??"output",targetHandle:"input",type:"smoothstep",...edgeVisual(edge,edgeStates?.get(edge.id),nodeStates)}));}
function minimapColor(node:FlowNode){const state=node.data.state;if(state==="running")return"var(--accent)";if(state==="failed")return"var(--destructive)";if(state==="completed")return"var(--success)";if(state==="skipped"||state==="blocked")return"var(--text-dim)";return"var(--info)";}

export function WorkflowCanvas({graph,selectedId,onSelect,onMove,onConnect,nodeStates,edgeStates,onOpen,onDeleteNodes,onDeleteEdges,onTidy}:{graph:WorkflowGraph;selectedId:string|null;onSelect:(id:string|null)=>void;onMove:(id:string,position:{x:number;y:number})=>void;onConnect:(source:string,target:string,sourceHandle?:string)=>void;nodeStates?:ReadonlyMap<string,WorkflowGraphNodeState>;edgeStates?:ReadonlyMap<string,WorkflowGraphRunEdgeState>;onOpen?:(id:string)=>void;onDeleteNodes?:(ids:string[])=>void;onDeleteEdges?:(ids:string[])=>void;onTidy?:()=>void;}){
  const mappedNodes=useMemo(()=>toNodes(graph,selectedId,nodeStates),[graph,nodeStates,selectedId]),mappedEdges=useMemo(()=>toEdges(graph,nodeStates,edgeStates),[edgeStates,graph,nodeStates]);
  const[nodes,setNodes,onNodesChange]=useNodesState<FlowNode>(mappedNodes),[edges,setEdges,onEdgesChange]=useEdgesState<FlowEdge>(mappedEdges);useEffect(()=>setNodes(mappedNodes),[mappedNodes,setNodes]);useEffect(()=>setEdges(mappedEdges),[mappedEdges,setEdges]);
  const connect=(connection:Connection)=>{if(!connection.source||!connection.target||connection.source===connection.target)return;const handle=connection.sourceHandle&&connection.sourceHandle!=="output"?connection.sourceHandle:undefined;onConnect(connection.source,connection.target,handle);};
  return <GraphCanvas<FlowNode,FlowEdge> ariaLabel="Workflow canvas" nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={connect} onPaneClick={()=>onSelect(null)} onNodeClick={(_,item)=>onSelect(item.id)} onNodeDoubleClick={(_,item)=>{const node=item.data.node;if((node.type==="project"||node.type==="folder")&&onOpen)onOpen(node.id);}} onNodeDragStop={(_,item)=>onMove(item.id,item.position)} onNodesDelete={(items)=>onDeleteNodes?.(items.map((item)=>item.id))} onEdgesDelete={(items)=>onDeleteEdges?.(items.map((item)=>item.id))} isValidConnection={(connection)=>Boolean(connection.source&&connection.target&&connection.source!==connection.target&&!graph.edges.some((edge)=>edge.source===connection.source&&edge.target===connection.target&&(edge.sourceHandle??undefined)===(connection.sourceHandle==="output"?undefined:connection.sourceHandle??undefined)))} nodesDraggable nodesConnectable edgesReconnectable={false} deleteKeyCode={["Backspace","Delete"]} onTidy={onTidy} snapToGrid snapGrid={[12,12]} defaultEdgeOptions={{type:"smoothstep",markerEnd:{type:MarkerType.ArrowClosed}}} miniMapNodeColor={(node)=>minimapColor(node as FlowNode)} miniMapNodeStrokeColor={(node)=>node.selected?"var(--accent)":"var(--border)"}/>
}
