import { createHash } from "node:crypto";
import { createAgentSession } from "@/lib/agent/session-store";
import type { WorkflowGraphNode } from "@/lib/contracts/workflow-graph";
import type { CapabilityTool } from "@/lib/capabilities/tool";
import type { CapabilityRuntime } from "@/lib/capabilities/runtime";
import { listWorkflowGraphTriggerSources } from "./graph-store";
import { scheduleBucket } from "./schedule";
import { startWorkflowGraph, workflowGraphRunId } from "./graph-engine";
import { readWorkflowGraphRun } from "./graph-run-store";

const g=globalThis as typeof globalThis&{__msoWorkflowScheduler?:ReturnType<typeof setInterval>;__msoWorkflowSchedulerBusy?:boolean};
function key(parts:string[]){return `trigger:${createHash("sha256").update(parts.join(":" )).digest("hex").slice(0,48)}`;}
type Resolver=(name:string)=>CapabilityTool|undefined;
async function runScheduled(principal:string,owner:string,graph:Awaited<ReturnType<typeof listWorkflowGraphTriggerSources>>[number]["graph"],node:WorkflowGraphNode,bucket:string,resolve:Resolver,capabilities?:CapabilityRuntime){
 const idempotency=key([graph.id,node.id,bucket]);if(await readWorkflowGraphRun(owner,workflowGraphRunId(owner,idempotency)))return;
 const session=await createAgentSession(principal,"cli",{title:`Schedule: ${graph.name}`,titleSource:"auto"});
 const context={principal,actor:principal,sessionId:session.id,scope:"exec" as const,...(capabilities?{capabilities}:{})};
 await startWorkflowGraph(graph,{trigger:{type:"schedule",nodeId:node.id,bucket,at:new Date().toISOString()}},idempotency,context,resolve,principal,{type:"schedule",nodeId:node.id,receivedAt:new Date().toISOString()});
}
export async function tickWorkflowScheduler(resolve:Resolver,now=new Date(),capabilities?:CapabilityRuntime){if(g.__msoWorkflowSchedulerBusy)return;g.__msoWorkflowSchedulerBusy=true;try{const sources=await listWorkflowGraphTriggerSources();let started=0;for(const source of sources){for(const node of source.graph.nodes.filter((row)=>row.type==="schedule"&&!row.disabled)){if(started>=50)return;let bucket:string|null=null;try{bucket=scheduleBucket(node,now,source.graph.metadata.timezone||"UTC");}catch{continue;}if(!bucket)continue;await runScheduled(source.principal,source.owner,source.graph,node,bucket,resolve,capabilities).catch(()=>undefined);started+=1;}}}finally{g.__msoWorkflowSchedulerBusy=false;}}
export function startWorkflowScheduler(resolve:Resolver,capabilities?:CapabilityRuntime){if(process.env.NODE_ENV==="test"||g.__msoWorkflowScheduler)return;void tickWorkflowScheduler(resolve,new Date(),capabilities);g.__msoWorkflowScheduler=setInterval(()=>void tickWorkflowScheduler(resolve,new Date(),capabilities),15_000);g.__msoWorkflowScheduler.unref();}
export async function findActiveWebhookSource(graphId:string,nodeId:string){for(const source of await listWorkflowGraphTriggerSources()){if(source.graph.id!==graphId)continue;const node=source.graph.nodes.find((row)=>row.id===nodeId&&row.type==="webhook"&&!row.disabled);if(node)return{...source,node};}return null;}
