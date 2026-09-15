import { createHash, randomUUID } from "node:crypto";
import type { CapabilityRunContext, CapabilityTool } from "@/lib/capabilities/tool";
import type { WorkflowGraph, WorkflowGraphRun } from "@/lib/contracts/workflow-graph";
import { redactText } from "@/lib/security/redact-text";
import { assertWorkflowMetadataOnly, graphObject } from "./graph-schema";
import { workflowGraphOwner } from "./graph-store";
import { compact, executeNode } from "./graph-runtime";
import { lockWorkflowGraphRun, pruneWorkflowGraphRuns, publicWorkflowGraphRun, readWorkflowGraphRun, writeWorkflowGraphRun } from "./graph-run-store";
import { workflowSecretValues } from "./variables";

const state = globalThis as typeof globalThis & { msoGraphInstance?: string; msoGraphPending?: Map<string, Promise<void>> };
const INSTANCE = state.msoGraphInstance ??= randomUUID();
const pending = state.msoGraphPending ??= new Map<string, Promise<void>>();
type Resolver = (name: string) => CapabilityTool | undefined;
export type WorkflowRunTrigger = WorkflowGraphRun["trigger"];
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`; return JSON.stringify(value); }
function inputObject(raw: unknown): Record<string, unknown> { if (!graphObject(raw) || Buffer.byteLength(JSON.stringify(raw)) > 64 * 1024) throw new Error("workflow graph input must be an object up to 64 KiB"); assertWorkflowMetadataOnly(raw); return structuredClone(raw); }
function retryPolicy(node: WorkflowGraph["nodes"][number]) { const raw = graphObject(node.config.retry) ? node.config.retry : {}; return { maxAttempts: Math.max(1, Math.min(5, Math.trunc(Number(raw.maxAttempts) || 1))), backoffMs: Math.max(0, Math.min(30_000, Math.trunc(Number(raw.backoffMs) || 0))) }; }
function sleep(ms:number){return ms?new Promise((resolve)=>setTimeout(resolve,ms)):Promise.resolve();}
function secretText(text:string,secrets:string[]){let out=text;for(const value of secrets)out=out.split(value).join("[REDACTED]");return out;}
function secretValue(value:unknown,secrets:string[],depth=0):unknown{if(depth>14)return "[TRUNCATED]";if(typeof value==="string")return secretText(value,secrets);if(Array.isArray(value))return value.map((item)=>secretValue(item,secrets,depth+1));if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([key,child])=>[key,secretValue(child,secrets,depth+1)]));return value;}

async function execute(run: WorkflowGraphRun, graph: WorkflowGraph, input: Record<string, unknown>, context: CapabilityRunContext, resolve: Resolver): Promise<void> {
  const rows = new Map(run.nodes.map((row) => [row.id, row])), outputs: Record<string, unknown> = {}, secrets = await workflowSecretValues(context.principal ?? context.actor ?? ""), edgeState = new Map(graph.edges.map((edge) => [edge.id, "pending" as "pending"|"enabled"|"disabled"]));
  const incoming = new Map(graph.nodes.map((node)=>[node.id,graph.edges.filter((edge)=>edge.target===node.id)])), outgoing = new Map(graph.nodes.map((node)=>[node.id,graph.edges.filter((edge)=>edge.source===node.id)]));
  const disableOutgoing=(id:string)=>{for(const edge of outgoing.get(id)??[])if(edgeState.get(edge.id)==="pending")edgeState.set(edge.id,"disabled");};
  const resolveOutgoing=(id:string,handles?:string[])=>{for(const edge of outgoing.get(id)??[]){const enabled=handles?Boolean(edge.sourceHandle&&handles.includes(edge.sourceHandle)):!edge.sourceHandle;edgeState.set(edge.id,enabled?"enabled":"disabled");}};
  let handledErrors=false;
  try {
    const remaining=new Set(graph.nodes.map((node)=>node.id));
    while(remaining.size){
      if(Date.now()-Date.parse(run.startedAt)>15*60_000)throw new Error("workflow graph exceeded 15 minutes; remaining nodes were not started");
      let progressed=false;
      for(const node of graph.nodes){
        if(!remaining.has(node.id))continue; const deps=incoming.get(node.id)??[]; if(deps.some((edge)=>edgeState.get(edge.id)==="pending"))continue; const row=rows.get(node.id)!;
        const triggerNode=["manual","schedule","webhook"].includes(node.type),triggerMismatch=Boolean(triggerNode&&run.trigger?.nodeId&&run.trigger.nodeId!==node.id);if(node.disabled||triggerMismatch||(deps.length>0&&deps.every((edge)=>edgeState.get(edge.id)==="disabled"))){row.state="skipped";row.finishedAt=new Date().toISOString();row.logs.push(node.disabled?"Node disabled by workflow definition.":triggerMismatch?"Skipped because another trigger started this run.":"Skipped because no incoming branch was selected.");disableOutgoing(node.id);remaining.delete(node.id);progressed=true;run.updatedAt=new Date().toISOString();await writeWorkflowGraphRun(run);continue;}
        row.state="running";row.startedAt=new Date().toISOString();row.logs.push("Node started.");run.updatedAt=row.startedAt;await writeWorkflowGraphRun(run); const started=Date.now(),policy=retryPolicy(node); let failure:unknown;
        for(let attempt=1;attempt<=policy.maxAttempts;attempt+=1){row.attempts=attempt;try{const result=await executeNode(node,run,graph,input,outputs,context,resolve);row.output=compact(secretValue(result.output,secrets));outputs[node.id]=result.output;row.state="completed";if(result.log)row.logs.push(result.log);resolveOutgoing(node.id,result.handles);failure=undefined;break;}catch(error){failure=error;row.logs.push(`Attempt ${attempt}/${policy.maxAttempts} failed: ${secretText(redactText(error instanceof Error?error.message:"node failed",500),secrets)}`);if(attempt<policy.maxAttempts)await sleep(Math.min(30_000,policy.backoffMs*Math.max(1,2**(attempt-1))));}}
        if(failure){row.state="failed";row.error=secretText(redactText(failure instanceof Error?failure.message:"node failed",800),secrets);outputs[node.id]={error:row.error};const errorEdges=(outgoing.get(node.id)??[]).filter((edge)=>edge.sourceHandle==="error"),continueOnError=node.config.onError==="continue";if(errorEdges.length||continueOnError){handledErrors=true;resolveOutgoing(node.id,errorEdges.length?["error"]:undefined);row.logs.push(errorEdges.length?"Failure routed through error output.":"Failure continued by node policy.");}else{run.failedNodeId=node.id;run.failedNodeName=node.name;run.error=row.error;run.state="failed";for(const pendingId of remaining){if(pendingId===node.id)continue;const blocked=rows.get(pendingId)!;if(blocked.state==="queued"){blocked.state="blocked";blocked.logs.push(`Blocked by failed node ${node.name}.`);}}row.durationMs=Date.now()-started;row.finishedAt=new Date().toISOString();run.updatedAt=row.finishedAt;await writeWorkflowGraphRun(run);throw failure;}}
        row.durationMs=Date.now()-started;row.finishedAt=new Date().toISOString();run.updatedAt=row.finishedAt;await writeWorkflowGraphRun(run);remaining.delete(node.id);progressed=true;
      }
      if(!progressed&&remaining.size)throw new Error("workflow graph could not make progress; inspect dependencies/branches");
    }
    run.state=handledErrors?"completed_with_errors":"completed";
  } catch(error){if(run.state!=="failed"){run.state="failed";run.error=secretText(redactText(error instanceof Error?error.message:"workflow graph failed",800),secrets);}}
  run.finishedAt=run.updatedAt=new Date().toISOString();await writeWorkflowGraphRun(run);
}

async function maybeRunErrorWorkflow(run:WorkflowGraphRun,graph:WorkflowGraph,context:CapabilityRunContext,resolve:Resolver,principal:string){
  const errorId=graph.metadata.errorWorkflowId;if(run.state!=="failed"||!errorId||errorId===graph.id)return;
  const {getWorkflowGraph}=await import("./graph-store"),errorGraph=await getWorkflowGraph(principal,errorId);if(!errorGraph||errorGraph.status==="archived")return;
  await startWorkflowGraph(errorGraph,{error:{runId:run.id,graphId:graph.id,graphName:graph.name,nodeId:run.failedNodeId,nodeName:run.failedNodeName,message:run.error}},`error:${run.id}`,context,resolve,principal,{type:"system",receivedAt:new Date().toISOString()});
}
export function workflowGraphRunId(owner:string,key:string){return hash(`${owner}:${key}`).slice(0,32);}
export async function startWorkflowGraph(graph: WorkflowGraph, rawInput: unknown, idempotencyKey: string, context: CapabilityRunContext, resolve: Resolver, storagePrincipal?: string, trigger?: WorkflowRunTrigger, ancestry: string[] = []) {
  const principal=storagePrincipal??context.principal;if(!principal||!context.sessionId)throw new Error("workflow graph requires an authenticated principal/session");if(ancestry.includes(graph.id)||ancestry.length>=16)throw new Error("recursive workflow subflow detected");if(graph.status==="archived")throw new Error("archived workflow graph cannot run");if(!/^[A-Za-z0-9_.:-]{1,128}$/.test(idempotencyKey))throw new Error("idempotency_key must be 1-128 simple characters");
  const owner=workflowGraphOwner(principal),input=inputObject(rawInput),fingerprint=hash(canonical({graphId:graph.id,revision:graph.revision,input})),id=workflowGraphRunId(owner,idempotencyKey);
  return lockWorkflowGraphRun(owner,id,async()=>{const existing=await readWorkflowGraphRun(owner,id);if(existing){if(existing.fingerprint!==fingerprint)throw new Error("idempotency_key already identifies a different graph/input/revision");return publicWorkflowGraphRun(existing);}await pruneWorkflowGraphRuns(owner);const run:WorkflowGraphRun={version:1,id,owner,sessionId:context.sessionId!,graphId:graph.id,graphRevision:graph.revision,graphName:graph.name,idempotencyKey,fingerprint,state:"running",startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),pid:process.pid,instance:INSTANCE,nodes:graph.nodes.map((node)=>({id:node.id,name:node.name,type:node.type,state:"queued",logs:[]})),trigger:trigger??{type:"manual",nodeId:graph.nodes.find((node)=>node.type==="manual")?.id??graph.nodes.find((node)=>["schedule","webhook"].includes(node.type))?.id,receivedAt:new Date().toISOString()},ancestry:[...ancestry,graph.id]};await writeWorkflowGraphRun(run);const work=execute(run,graph,input,context,resolve).then(()=>maybeRunErrorWorkflow(run,graph,context,resolve,principal)).catch(()=>undefined).finally(()=>pending.delete(id));pending.set(id,work);return publicWorkflowGraphRun(run);});
}
export async function workflowGraphRunStatus(principal:string,id:string,waitMs=0){if(!Number.isSafeInteger(waitMs)||waitMs<0||waitMs>25_000)throw new Error("wait_ms must be 0-25000");const owner=workflowGraphOwner(principal);let run=await readWorkflowGraphRun(owner,id);if(!run)throw new Error("workflow graph run not found for this principal");if(run.state==="running"&&pending.has(id)&&waitMs>0){let timer:ReturnType<typeof setTimeout>|undefined;await Promise.race([pending.get(id),new Promise((resolve)=>{timer=setTimeout(resolve,waitMs);})]);clearTimeout(timer);run=await readWorkflowGraphRun(owner,id)??run;}if(run.state==="running"&&run.instance!==INSTANCE){let gone=false;try{process.kill(run.pid,0);}catch(error){gone=(error as NodeJS.ErrnoException).code==="ESRCH";}if(gone){run.state="interrupted";run.updatedAt=run.finishedAt=new Date().toISOString();await writeWorkflowGraphRun(run);}}return publicWorkflowGraphRun(run);}
