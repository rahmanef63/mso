"use client";
import { useMemo } from "react";
import {
  Handle, MarkerType, Position,
  type Connection, type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import type { WorkflowGraph, WorkflowGraphNode, WorkflowGraphNodeState, WorkflowGraphRunEdgeState } from "@/lib/contracts/workflow-graph";
import { useGraphProjection } from "@/components/shared/use-graph-projection";
import { GraphCanvas } from "@/components/shared/graph-canvas";
import { GraphCustomControls } from "@/components/shared/graph-custom-controls";
import { GraphCustomCard } from "@/components/shared/graph-custom-card";
import { projectCustomNodes, moveCustomNode, type CustomCanvasNode } from "@/components/shared/graph-custom-projection";
import { graphRoutedEdgeTypes } from "@/components/shared/graph-routed-edge";
import type { GraphCustomNode } from "@/lib/contracts/graph-custom-nodes";
import { compactWorkflowFocusIds } from "../lib/compact-focus";
import { cn } from "@/lib/utils";

interface WorkflowNodeData extends Record<string, unknown> { node: WorkflowGraphNode; state?: WorkflowGraphNodeState }
type FlowNode = Node<WorkflowNodeData, "workflow">;
type FlowEdge = Edge;

function sourceHandles(node: WorkflowGraphNode): Array<string | undefined> {
  if (node.type === "condition") return ["true", "false"];
  if (node.type === "repeat") return ["done", "exhausted"];
  if (node.type === "switch") { const cases = Array.isArray(node.config.cases) ? node.config.cases : []; return [...cases.map((row,index)=>row&&typeof row==="object"&&typeof (row as {handle?:unknown}).handle==="string"?String((row as {handle:string}).handle):`case-${index+1}`),"default"]; }
  return [undefined];
}
const canError=(node:WorkflowGraphNode)=>!["manual","schedule","webhook","output"].includes(node.type);
const canInput=(node:WorkflowGraphNode)=>!["manual","schedule","webhook"].includes(node.type);
const canOutput=(node:WorkflowGraphNode)=>node.type!=="output";
function nodeMetrics(node:WorkflowGraphNode){
  const semantic=node.config.sessionStep===true||node.config.sessionRoot===true,handles=sourceHandles(node);
  return {width:semantic?250:200,height:semantic?104:Math.max(78,48+Math.max(handles.length,canError(node)?2:1)*20)};
}
function WorkflowNodeCard({data,selected}:NodeProps<FlowNode>){
  const{node,state}=data,handles=sourceHandles(node),metrics=nodeMetrics(node),semantic=node.config.sessionStep===true||node.config.sessionRoot===true;
  const actionCount=typeof node.config.actionCount==="number"?node.config.actionCount:undefined,summary=typeof node.config.summary==="string"?node.config.summary:undefined;
  return <div className={cn("relative rounded-xl border bg-card px-3 py-3 shadow-sm transition-shadow",semantic?"w-[250px]":"w-[200px]",selected&&"ring-2 ring-ring shadow-md",state==="failed"&&"border-destructive ring-1 ring-destructive",state==="running"&&"border-primary ring-1 ring-primary",["skipped","blocked"].includes(state??"")&&"opacity-55",node.disabled&&"opacity-50")} style={{minHeight:metrics.height}}>
    {canInput(node)?<Handle type="target" position={Position.Left} id="input" className="!size-3.5 !border-2 !border-background !bg-muted-foreground"/>:null}
    <div className={cn("text-xs font-semibold",semantic?"line-clamp-2 leading-4":"truncate")}>{node.name}</div>
    <div className="mt-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground"><span>{node.type.replaceAll("_"," ")}{state?` · ${state}`:""}</span>{actionCount!==undefined?<span className="rounded bg-muted px-1.5 py-0.5 normal-case tracking-normal">{actionCount} actions</span>:null}</div>
    {summary?<p className="mt-1.5 line-clamp-2 text-[10px] leading-4 text-muted-foreground">{summary}</p>:null}
    {canOutput(node)?handles.map((handle,index)=><div key={handle??"output"} className="absolute right-0 flex translate-x-1/2 items-center" style={{top:38+index*20}}>{handle?<span className="pointer-events-none absolute right-4 whitespace-nowrap pr-1 text-[8px] text-muted-foreground">{handle}</span>:null}<Handle type="source" position={Position.Right} id={handle??"output"} className="!relative !right-auto !top-auto !size-3.5 !translate-x-0 !translate-y-0 !border-2 !border-background !bg-muted-foreground"/></div>):null}
    {canError(node)?<Handle type="source" position={Position.Bottom} id="error" className="!size-3 !border-2 !border-background !bg-destructive"/>:null}
  </div>;
}
const nodeTypes={workflow:WorkflowNodeCard, customGroup:GraphCustomCard};
type CanvasNode = FlowNode | CustomCanvasNode;
function toNodes(graph:WorkflowGraph,selectedId:string|null,nodeStates?:ReadonlyMap<string,WorkflowGraphNodeState>):FlowNode[]{return graph.nodes.map((node)=>{const metrics=nodeMetrics(node);return{id:node.id,type:"workflow",position:node.position,width:metrics.width,height:metrics.height,selected:node.id===selectedId,data:{node,state:nodeStates?.get(node.id)}};});}
function edgeVisual(edge:WorkflowGraph["edges"][number],state:WorkflowGraphRunEdgeState|undefined,nodeStates?:ReadonlyMap<string,WorkflowGraphNodeState>){
  const running=nodeStates?.get(edge.source)==="running"||nodeStates?.get(edge.target)==="running",error=edge.sourceHandle==="error",branch=Boolean(edge.sourceHandle&&edge.sourceHandle!=="output"),disabled=edge.disabled||state==="disabled";
  const stroke=error?"var(--destructive)":running?"var(--accent)":state==="enabled"?"var(--success)":"var(--muted-foreground)";
  const strokeDasharray=disabled?"2 6":edge.style==="dashed"?"7 5":edge.style==="solid"?undefined:branch?"7 5":undefined;
  const opacity = disabled ? 0.24 : state === "pending" ? 0.55 : 1;
  return {animated:running&&!disabled,style:{stroke,strokeWidth:running?2.5:state==="enabled"?2:1.5,opacity,strokeDasharray},markerEnd:{type:MarkerType.ArrowClosed,width:18,height:18,color:stroke}};
}
function toEdges(graph:WorkflowGraph,nodeStates?:ReadonlyMap<string,WorkflowGraphNodeState>,edgeStates?:ReadonlyMap<string,WorkflowGraphRunEdgeState>):FlowEdge[]{return graph.edges.map((edge)=>({id:edge.id,source:edge.source,target:edge.target,sourceHandle:edge.sourceHandle??"output",targetHandle:edge.targetHandle??"input",type:"routed",...edgeVisual(edge,edgeStates?.get(edge.id),nodeStates)}));}
function minimapColor(node:FlowNode){const state=node.data.state;if(state==="running")return"var(--accent)";if(state==="failed")return"var(--destructive)";if(state==="completed")return"var(--success)";if(state==="skipped"||state==="blocked")return"var(--text-dim)";return"var(--info)";}

export function WorkflowCanvas({graph,selectedId,onSelect,onMove,onMoveMany,onCustomNodes,onConnect,nodeStates,edgeStates,onOpen,onDeleteNodes,onDeleteEdges,onTidy,readOnly=false}:{graph:WorkflowGraph;selectedId:string|null;onSelect:(id:string|null)=>void;onMove:(id:string,position:{x:number;y:number})=>void;onMoveMany?:(nodes:WorkflowGraphNode[])=>void;onCustomNodes?:(groups:GraphCustomNode[])=>void;onConnect:(source:string,target:string,sourceHandle?:string)=>void;nodeStates?:ReadonlyMap<string,WorkflowGraphNodeState>;edgeStates?:ReadonlyMap<string,WorkflowGraphRunEdgeState>;onOpen?:(id:string)=>void;onDeleteNodes?:(ids:string[])=>void;onDeleteEdges?:(ids:string[])=>void;onTidy?:()=>void;readOnly?:boolean;}){
  const groups=useMemo(()=>graph.metadata.customNodes??[],[graph.metadata.customNodes]);
  const mapped=useMemo(()=>projectCustomNodes(toNodes(graph,null,nodeStates),toEdges(graph,nodeStates,edgeStates),groups,selectedId?[selectedId]:[]),[graph,nodeStates,edgeStates,groups,selectedId]);
  const {nodes,edges,onNodesChange,onEdgesChange}=useGraphProjection<CanvasNode,FlowEdge>(mapped);
  const selectedIds=nodes.filter((node)=>node.selected).map((node)=>node.id);
  const changeGroups=(next:GraphCustomNode[])=>{onCustomNodes?.(next);onSelect(null);};
  const move=(items:CanvasNode[])=>{let next=graph.nodes;for(const item of items){const group=groups.find((g)=>g.id===item.id);next=group?moveCustomNode(next,group,item.position):next.map((n)=>n.id===item.id?{...n,position:item.position}:n);}if(onMoveMany)onMoveMany(next);else for(const item of items)onMove(item.id,item.position);};
  const connect=(connection:Connection)=>{if(!graph.nodes.some((n)=>n.id===connection.source)||!graph.nodes.some((n)=>n.id===connection.target)||connection.source===connection.target)return;const handle=connection.sourceHandle&&connection.sourceHandle!=="output"?connection.sourceHandle:undefined;onConnect(connection.source!,connection.target!,handle);};
  const visibleIds=useMemo(()=>new Set(nodes.map((node)=>node.id)),[nodes]);
  const rootFocusIds=useMemo(()=>compactWorkflowFocusIds(graph.nodes,groups,visibleIds,readOnly?9:2),[graph.nodes,groups,readOnly,visibleIds]);
  const compactIds=rootFocusIds.length?rootFocusIds:(readOnly?nodes.slice(0,9):nodes.slice(0,2)).map((node)=>node.id);
  return <div className="flex h-full min-h-0 flex-col">
    {!readOnly&&onCustomNodes?<GraphCustomControls groups={groups} selectedIds={selectedIds} nodeIds={graph.nodes.map((n)=>n.id)} onChange={changeGroups}/>:null}
    <div className="min-h-0 flex-1"><GraphCanvas<CanvasNode,FlowEdge> ariaLabel="Workflow canvas" showMinimap={!readOnly} nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={graphRoutedEdgeTypes}
      onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={readOnly?undefined:connect}
      onPaneClick={()=>{onSelect(null);}}
      onNodeClick={(event,item)=>{if(event.ctrlKey||event.metaKey)return;onSelect(item.type==="customGroup"?null:item.id);}}
      onEdgeClick={readOnly?undefined:(_,edge)=>{if(graph.nodes.some((n)=>n.id===edge.source))onSelect(edge.source);}}
      onNodeDoubleClick={(_,item)=>{if(item.type==="customGroup"){if(!readOnly)changeGroups(groups.map((g)=>g.id===item.id?{...g,collapsed:false}:g));return;}const node=(item as FlowNode).data.node;if((readOnly||node.type==="project"||node.type==="folder")&&onOpen)onOpen(node.id);}}
      onNodeDragStop={(_,item,items)=>move(items.length?items:[item])} onSelectionDragStop={(_,items)=>move(items)}
      onNodesDelete={readOnly?undefined:(items)=>onDeleteNodes?.(items.filter((n)=>n.type!=="customGroup").map((n)=>n.id))}
      onEdgesDelete={readOnly?undefined:(items)=>onDeleteEdges?.(items.map((item)=>item.id))}
      nodesDraggable={!readOnly} nodesConnectable={!readOnly} edgesReconnectable={false} deleteKeyCode={readOnly?null:["Backspace","Delete"]} onTidy={onTidy} snapToGrid snapGrid={[12,12]}
      miniMapNodeColor={(node)=>node.type==="customGroup"?"var(--primary)":minimapColor(node as FlowNode)} compactFitNodeIds={compactIds} compactFitMaxZoom={readOnly?0.72:0.9} initialFitNodeIds={compactIds} initialFitMaxZoom={readOnly?0.78:0.94}/></div>
  </div>;
}
