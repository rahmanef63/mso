import { createHash } from "node:crypto";
import { createAgentSession } from "@/lib/agent/session-store";
import type { WorkflowGraphNode } from "@/lib/contracts/workflow-graph";
import type { CapabilityTool } from "@/lib/capabilities/tool";
import type { CapabilityRuntime } from "@/lib/capabilities/runtime";
import { listWorkflowGraphTriggerSources } from "./graph-store";
import { scheduleBucket } from "./schedule";
import { startWorkflowGraph, workflowGraphRunId } from "./graph-engine";
import { readWorkflowGraphRun } from "./graph-run-store";
import { getApprovedDevice } from "@/lib/auth/device-store";

const g=globalThis as typeof globalThis&{__msoWorkflowScheduler?:ReturnType<typeof setInterval>;__msoWorkflowSchedulerBusy?:boolean};
function key(parts:string[]){return `trigger:${createHash("sha256").update(parts.join(":" )).digest("hex").slice(0,48)}`;}
type Resolver=(name:string)=>CapabilityTool|undefined;
async function runScheduled(principal:string,owner:string,graph:Awaited<ReturnType<typeof listWorkflowGraphTriggerSources>>[number]["graph"],node:WorkflowGraphNode,bucket:string,resolve:Resolver,capabilities?:CapabilityRuntime){
 const idempotency=key([graph.id,node.id,bucket]);if(await readWorkflowGraphRun(owner,workflowGraphRunId(owner,idempotency,graph.id,node.id)))return;
 const session=await createAgentSession(principal,"cli",{title:`Schedule: ${graph.name}`,titleSource:"auto"});
 const context={principal,actor:principal,sessionId:session.id,scope:"exec" as const,...(capabilities?{capabilities}:{})};
 await startWorkflowGraph(graph,{trigger:{type:"schedule",nodeId:node.id,bucket,at:new Date().toISOString()}},idempotency,context,resolve,principal,{type:"schedule",nodeId:node.id,receivedAt:new Date().toISOString()});
}
export async function tickWorkflowScheduler(resolve:Resolver,now=new Date(),capabilities?:CapabilityRuntime){if(g.__msoWorkflowSchedulerBusy)return;g.__msoWorkflowSchedulerBusy=true;try{const sources=await listWorkflowGraphTriggerSources();let started=0;for(const source of sources){for(const node of source.graph.nodes.filter((row)=>row.type==="schedule"&&!row.disabled)){if(started>=50)return;let bucket:string|null=null;try{bucket=scheduleBucket(node,now,source.graph.metadata.timezone||"UTC");}catch{continue;}if(!bucket)continue;await runScheduled(source.principal,source.owner,source.graph,node,bucket,resolve,capabilities).catch(()=>undefined);started+=1;}}}finally{g.__msoWorkflowSchedulerBusy=false;}}
export function startWorkflowScheduler(resolve:Resolver,capabilities?:CapabilityRuntime){if(process.env.NODE_ENV==="test"||g.__msoWorkflowScheduler)return;void tickWorkflowScheduler(resolve,new Date(),capabilities);g.__msoWorkflowScheduler=setInterval(()=>void tickWorkflowScheduler(resolve,new Date(),capabilities),15_000);g.__msoWorkflowScheduler.unref();}
export async function findActiveWebhookSource(graphId:string,nodeId:string){for(const source of await listWorkflowGraphTriggerSources()){if(source.graph.id!==graphId)continue;const node=source.graph.nodes.find((row)=>row.id===nodeId&&row.type==="webhook"&&!row.disabled);if(node)return{...source,node};}return null;}

type ChannelBinding = { owner: string; nodeId: string; revision: string };
export async function reviewedChannelBinding(graphId: string, channelId: string): Promise<ChannelBinding> {
 const matches = [];
 for (const source of await listWorkflowGraphTriggerSources()) {
  if (source.graph.id !== graphId || !source.principal.startsWith("web:") || (await getApprovedDevice(source.principal.slice(4)))?.role !== "owner") continue;
  const nodes = source.graph.nodes.filter((node) => node.type === "channel_trigger" && !node.disabled && (!node.config.channelId || node.config.channelId === channelId));
  for (const node of nodes) matches.push({ owner: source.owner, nodeId: node.id, revision: source.graph.revision });
 }
 if (matches.length !== 1) throw new Error("Choose one unambiguous Owner channel trigger before saving");
 return matches[0];
}
export async function findActiveChannelSource(graphId: string, channelId: string, binding?: ChannelBinding) {
 if (!binding) return null;
 for (const source of await listWorkflowGraphTriggerSources()) {
  if (source.graph.id !== graphId || source.owner !== binding.owner || source.graph.revision !== binding.revision) continue;
  const node = source.graph.nodes.find((row) => row.id === binding.nodeId && row.type === "channel_trigger" && !row.disabled && (!row.config.channelId || row.config.channelId === channelId));
  if (node) return { ...source, node };
 }
 return null;
}
