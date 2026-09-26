import { createHash, randomUUID } from "node:crypto";
import type { CapabilityTool, CapabilityRunContext } from "@/lib/capabilities/tool";
import { executeCapabilityCall } from "@/lib/capabilities/execute";
import { createJevDecisionEvaluator, type JevDecisionContext } from "./jev-decision-plane";
import { getJevDecisionDefinition } from "./jev-decision-registry";
import type { JevIntegrationInput } from "./jev-integration";
import { recordJevTelemetry } from "./jev-telemetry";
import { verifyActionOutcomeWithJev } from "./jev-services";

export type JevActionCandidate={id:string;tool:string;arguments:Record<string,unknown>;rationale:string;risk:"safe"|"review"|"destructive"};
export type JevActionSelection=JevActionCandidate&{probability:number;capabilityDigest:string};
export type JevActionProposal={
  kind:"mso.jev-action-proposal.v1";provider:"jev"|"fallback";proposalId:string;createdAt:string;expiresAt:string;
  decision:{id:"action.select";version:number;threshold:number;model?:string;latencyMs?:number;inputTokens?:number;actualCostUsd?:number};
  selected:JevActionSelection[];rejected:Array<{id:string;tool?:string;probability?:number;reason:string}>;executable:false;instruction:string;
};
type Stored={proposal:JevActionProposal;selected:Map<string,JevActionSelection>};
const PROPOSAL_TTL_MS=10*60_000,MAX_PROPOSALS=128;
const proposals=new Map<string,Stored>();
const FORBIDDEN=new Set(["exec_run","exec_job_start","exec_job_cancel","fs_delete","fs_write","fs_upload_file","fs_move","fs_copy","tool_forge_promote","agent_memory_forget","workflow_cancel","apps_power","browser_power"]);
const SECRET_KEY=/(?:secret|token|password|passwd|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|authorization|credential|cookie)/i;

function clean(value:unknown,depth=0):unknown{
  if(depth>5)return"[bounded]";
  if(typeof value==="string")return value.slice(0,4000);
  if(Array.isArray(value))return value.slice(0,32).map(v=>clean(v,depth+1));
  if(!value||typeof value!=="object")return value;
  const out:Record<string,unknown>={};for(const[k,v]of Object.entries(value as Record<string,unknown>).slice(0,48)){if(SECRET_KEY.test(k))continue;out[k]=clean(v,depth+1)}return out;
}
function digest(tool:CapabilityTool){return createHash("sha256").update(JSON.stringify({name:tool.name,scope:tool.scope,inputSchema:tool.inputSchema,annotations:tool.annotations,actionContract:tool.actionContract,audit:tool.audit?{action:tool.audit.action,targetArg:tool.audit.targetArg}:undefined,limit:tool.limit})).digest("hex")}
function prune(now=Date.now()){for(const[id,row]of proposals)if(Date.parse(row.proposal.expiresAt)<=now)proposals.delete(id);while(proposals.size>=MAX_PROPOSALS)proposals.delete(proposals.keys().next().value as string)}
function inferredRisk(row:JevActionCandidate,tool:CapabilityTool):JevActionCandidate["risk"]{
  if(tool.annotations?.destructiveHint)return"destructive";
  if(tool.scope!=="read"||row.risk!=="safe")return"review";
  return"safe";
}
export function validateJevActionCandidates(rows:JevActionCandidate[],resolveTool:(name:string)=>CapabilityTool|undefined){
  const eligible:JevActionCandidate[]=[],rejected:JevActionProposal["rejected"]=[],seen=new Set<string>();
  for(const raw of rows.slice(0,16)){
    const id=typeof raw?.id==="string"?raw.id.slice(0,80):"",toolName=typeof raw?.tool==="string"?raw.tool.slice(0,96):"";
    if(!id||seen.has(id)){rejected.push({id:id||"(invalid)",tool:toolName||undefined,reason:"invalid or duplicate candidate id"});continue}seen.add(id);
    const tool=resolveTool(toolName);if(!tool){rejected.push({id,tool:toolName,reason:"unknown capability"});continue}
    if(FORBIDDEN.has(toolName)){rejected.push({id,tool:toolName,reason:"arbitrary/destructive executor is not eligible for JEV proposal"});continue}
    eligible.push({id,tool:toolName,arguments:clean(raw.arguments&&typeof raw.arguments==="object"&&!Array.isArray(raw.arguments)?raw.arguments:{}) as Record<string,unknown>,rationale:String(raw.rationale??"").slice(0,1000),risk:inferredRisk(raw,tool)});
  }
  return{eligible,rejected};
}
export async function proposeJevActions(
  state:Record<string,unknown>,rows:JevActionCandidate[],resolveTool:(name:string)=>CapabilityTool|undefined,jev?:JevIntegrationInput,ctx:JevDecisionContext={}
):Promise<JevActionProposal>{
  const definition=getJevDecisionDefinition("action.select"),validated=validateJevActionCandidates(rows,resolveTool),createdAt=new Date().toISOString(),proposalId=`jev_${randomUUID()}`,expiresAt=new Date(Date.now()+PROPOSAL_TTL_MS).toISOString();
  let probabilities:Record<string,number>={},provider:"jev"|"fallback"="jev",model:string|undefined,latencyMs:number|undefined,inputTokens:number|undefined,actualCostUsd:number|undefined,fallbackReason:string|undefined;
  if(validated.eligible.length){
    const candidates=validated.eligible.map(row=>({id:row.id,kind:"presentation-group" as const,hostEligible:true as const,title:`Call ${row.tool}`,description:row.rationale,nodeIds:[],estimatedNodeDelta:0,risk:row.risk==="safe"?"safe" as const:"review" as const}));
    try{const evaluation=await createJevDecisionEvaluator("action.select",jev,ctx)(state,candidates);probabilities=evaluation.probabilities;model=evaluation.jev?.model;latencyMs=evaluation.jev?.latencyMs;inputTokens=evaluation.jev?.inputTokens;actualCostUsd=evaluation.jev?.actualCostUsd}
    catch(cause){provider="fallback";fallbackReason=cause instanceof Error?cause.message.slice(0,240):"JEV action decision unavailable"}
  }
  const selected:JevActionSelection[]=provider==="jev"?validated.eligible.map(row=>({...row,probability:probabilities[row.id]??0,capabilityDigest:digest(resolveTool(row.tool)!)})).filter(row=>row.probability>=definition.threshold).sort((a,b)=>b.probability-a.probability):[];
  const chosen=new Set(selected.map(row=>row.id)),rejected=[...validated.rejected,...validated.eligible.filter(row=>!chosen.has(row.id)).map(row=>({id:row.id,tool:row.tool,probability:probabilities[row.id]??0,reason:fallbackReason??`below action.select threshold ${definition.threshold}`}))];
  const proposal:JevActionProposal={kind:"mso.jev-action-proposal.v1",provider,proposalId,createdAt,expiresAt,decision:{id:"action.select",version:definition.version,threshold:definition.threshold,...(model?{model}:{}),...(latencyMs!=null?{latencyMs}:{}),...(inputTokens!=null?{inputTokens}:{}),...(actualCostUsd!=null?{actualCostUsd}:{})},selected,rejected,executable:false,instruction:"JEV selected bounded candidates only. Proposal never executes. Execute requires this server-held proposal id, re-resolves the capability, re-checks its digest and MSO Capability Runtime policy, and permits only safe non-destructive read capabilities; review/destructive actions use the normal explicit tool flow."};
  prune();proposals.set(proposalId,{proposal,selected:new Map(selected.map(row=>[row.id,row]))});return proposal;
}
export async function executeJevAction(
  proposalId:string,actionId:string,input:{scope:CapabilityRunContext["scope"];actor?:string;context?:CapabilityRunContext;jev?:JevIntegrationInput},resolveTool:(name:string)=>CapabilityTool|undefined,
){
  prune();const stored=proposals.get(proposalId);if(!stored)throw new Error("JEV proposal is missing or expired; propose again against live state");
  const action=stored.selected.get(actionId);if(!action)throw new Error("JEV action id was not selected in this proposal");
  const tool=resolveTool(action.tool);if(!tool)throw new Error("JEV action capability is no longer available");
  if(digest(tool)!==action.capabilityDigest)throw new Error("JEV proposal is stale because the capability contract changed");
  if(FORBIDDEN.has(tool.name)||tool.scope!=="read"||tool.annotations?.destructiveHint||action.risk!=="safe")throw new Error("JEV proposal cannot auto-execute this action; use the normal explicit tool confirmation flow");
  const execution=await executeCapabilityCall({tool,args:action.arguments,scope:input.scope,actor:input.actor,context:input.context});
  const ctx:JevDecisionContext={...(input.context?.sessionId?{correlationId:input.context.sessionId}:{}),...(input.context?.workflowId?{workflowRef:input.context.workflowId}:{})};
  const verification=await verifyActionOutcomeWithJev(action.rationale,execution,input.jev,ctx);
  const result=execution.kind==="success"?"success":/not allowed|scope|workflow_id|denied/i.test(execution.message)?"denied":"failed";
  await recordJevTelemetry({event:"execution",decisionId:"action.select",decisionVersion:stored.proposal.decision.version,decisionType:"noul",candidateCount:stored.proposal.selected.length,selected:[action.id],threshold:stored.proposal.decision.threshold,tool:action.tool,executionAttempted:true,executionResult:result,selectedProbability:action.probability,verificationResult:verification.verification,...ctx}).catch(()=>undefined);
  return{kind:"mso.jev-action-result.v1" as const,proposalId,actionId,execution,verification,distinction:{jevDecision:"selected candidate; not authority",mcpAction:"executed through MSO Capability Runtime",verifiedResult:verification.verification}};
}
export function clearJevActionProposalsForTests(){proposals.clear()}
