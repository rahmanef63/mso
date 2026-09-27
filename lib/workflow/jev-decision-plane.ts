import type { WorkflowOptimizerCandidate, WorkflowOptimizerEvaluation, WorkflowOptimizerEvaluator } from "./graph-optimizer";
import { createResolvedJevWorkflowOptimizerEvaluator } from "./jev-evaluator";
import { resolveJevIntegrationConfig, type JevIntegrationInput } from "./jev-integration";
import { getJevDecisionDefinition, type JevDecisionId } from "./jev-decision-registry";
import { compileJevState } from "./jev-state-compiler";
import { evaluateOpenRouterJev } from "./jev-openrouter";
import { recordJevTelemetry, type JevTelemetryEvent } from "./jev-telemetry";

export type JevDecisionContext={correlationId?:string;sessionRef?:string;workflowRef?:string};
export type JevChoiceResult={kind:"mso.jev-decision.v1";decisionId:JevDecisionId;decisionVersion:number;provider:"jev";choice:string;probabilities:Record<string,number>;confidence?:number;threshold:number;accepted:boolean;model?:string;latencyMs?:number;inputTokens?:number;actualCostUsd?:number};
export type JevNoulResult={kind:"mso.jev-decision.v1";decisionId:JevDecisionId;decisionVersion:number;provider:"jev";probability:number;threshold:number;accepted:boolean;model?:string;latencyMs?:number;inputTokens?:number;actualCostUsd?:number};
export type JevScoreResult={kind:"mso.jev-decision.v1";decisionId:JevDecisionId;decisionVersion:number;provider:"jev";score:number;probabilities:Record<string,number>;confidence?:number;threshold:number;model?:string;latencyMs?:number;inputTokens?:number;actualCostUsd?:number};

const object=(v:unknown):v is Record<string,unknown>=>Boolean(v&&typeof v==="object"&&!Array.isArray(v));
const probability=(v:unknown)=>{const n=Number(v);return Number.isFinite(n)&&n>=0&&n<=1?n:0};
const validProbability=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v)&&v>=0&&v<=1;
function providerProbabilities(value:Record<string,unknown>,keys:string[],answerType:string):Record<string,number>{
  const rows=keys.map((key)=>{const p=value[key];if(!validProbability(p))throw new Error(`OpenRouter Jev returned invalid ${answerType} probabilities`);return[key,p] as const;});
  return Object.fromEntries(rows);
}
function baseTelemetry(id:JevDecisionId,ctx:JevDecisionContext):Pick<JevTelemetryEvent,"decisionId"|"decisionVersion"|"decisionType"|"correlationId"|"sessionRef"|"workflowRef">{
  const d=getJevDecisionDefinition(id);return{decisionId:id,decisionVersion:d.version,decisionType:d.type,...(ctx.correlationId?{correlationId:ctx.correlationId}:{}),...(ctx.sessionRef?{sessionRef:ctx.sessionRef}:{}),...(ctx.workflowRef?{workflowRef:ctx.workflowRef}:{})};
}
function actual(evaln:WorkflowOptimizerEvaluation){return evaln.jev?{...(evaln.jev.inputTokens!=null?{inputTokens:evaln.jev.inputTokens}:{}),...(evaln.jev.outputTokens!=null?{outputTokens:evaln.jev.outputTokens}:{}),...(evaln.jev.actualCostUsd!=null?{costUsd:evaln.jev.actualCostUsd}:{})}:undefined}
export function createJevDecisionEvaluator(id:JevDecisionId,raw?:unknown,ctx:JevDecisionContext={},thresholdOverride?:number):WorkflowOptimizerEvaluator{
  const d=getJevDecisionDefinition(id);if(d.type!=="noul")throw new Error(`${id} is not a noul candidate decision`);
  return async(state,candidates)=>{
    if(!candidates.length)return{provider:"jev",probabilities:{}};
    const threshold=Math.max(.01,Math.min(.99,thresholdOverride??d.threshold)),config=await resolveJevIntegrationConfig(raw),evaln=await createResolvedJevWorkflowOptimizerEvaluator(config)(compileJevState(state),candidates);
    const selected=candidates.filter(c=>(evaln.probabilities[c.id]??0)>=threshold).map(c=>c.id);
    await recordJevTelemetry({event:"decision",...baseTelemetry(id,ctx),model:evaln.jev?.model??config.model,provider:evaln.jev?.provider??config.transport,candidateCount:candidates.length,selected,probabilities:evaln.probabilities,threshold,latencyMs:evaln.jev?.latencyMs,actual:actual(evaln),fallbackOrEscalation:evaln.provider!=="jev",requestId:evaln.jev?.requestId}).catch(()=>undefined);
    return evaln;
  };
}
function fakeCandidates(criteria:Record<string,string>):WorkflowOptimizerCandidate[]{
  return Object.entries(criteria).slice(0,16).map(([id,description])=>({id,kind:"presentation-group",title:id,description,nodeIds:[],risk:"safe",estimatedNodeDelta:0,hostEligible:true}));
}
export async function runJevChoice(id:JevDecisionId,state:Record<string,unknown>,raw?:JevIntegrationInput,ctx:JevDecisionContext={}):Promise<JevChoiceResult>{
  const d=getJevDecisionDefinition(id);if(d.type!=="choice"||!d.criteria||Array.isArray(d.criteria))throw new Error(`${id} is not a choice decision`);
  const config=await resolveJevIntegrationConfig(raw),threshold=d.threshold;let probabilities:Record<string,number>={},choice="",confidence:number|undefined,model:string|undefined,latencyMs:number|undefined,inputTokens:number|undefined,actualCostUsd:number|undefined,provider:string=config.transport,requestId:string|undefined;
  if(config.transport==="openrouter"){
    const r=await evaluateOpenRouterJev(compileJevState(state),{decision:{type:"choice",instructions:d.instructions,criteria:d.criteria}},{model:config.model}),a=r.answers.decision;
    if(!object(a)||a.type!=="choice"||typeof a.choice!=="string"||!Object.hasOwn(d.criteria,a.choice)||!object(a.probabilities)||(a.confidence!==undefined&&!validProbability(a.confidence)))throw new Error("OpenRouter Jev returned an invalid choice answer");
    choice=a.choice;probabilities=providerProbabilities(a.probabilities,Object.keys(d.criteria),"choice");confidence=a.confidence;model=r.model;latencyMs=r.latencyMs;inputTokens=r.usage?.inputTokens;actualCostUsd=r.usage?.actualCostUsd;provider=r.provider;requestId=r.requestId;
  }else{
    const rows=fakeCandidates(d.criteria),e=await createResolvedJevWorkflowOptimizerEvaluator(config)(compileJevState(state),rows);probabilities=Object.fromEntries(Object.keys(d.criteria).map((key)=>[key,probability(e.probabilities[key])]));
    choice=Object.entries(probabilities).sort((a,b)=>b[1]-a[1])[0]?.[0]??"";model=e.jev?.model??config.model;latencyMs=e.jev?.latencyMs;inputTokens=e.jev?.inputTokens;actualCostUsd=e.jev?.actualCostUsd;provider=e.jev?.provider??"mcp";requestId=e.jev?.requestId;
  }
  const accepted=Boolean(choice)&&(probabilities[choice]??0)>=threshold;
  const fallbackOrEscalation=accepted&&((id==="model.route"&&["frontier","reasoning-escalation","ask-human"].includes(choice))||(id==="failure.triage"&&["alternate-tool","alternate-provider","escalate-model","human-review","stop-safely"].includes(choice)));
  await recordJevTelemetry({event:"decision",...baseTelemetry(id,ctx),model,provider,requestId,candidateCount:Object.keys(d.criteria).length,selected:accepted?[choice]:[],probabilities,threshold,latencyMs,fallbackOrEscalation,actual:{...(inputTokens!=null?{inputTokens}:{}),...(actualCostUsd!=null?{costUsd:actualCostUsd}:{})}}).catch(()=>undefined);
  return{kind:"mso.jev-decision.v1",decisionId:id,decisionVersion:d.version,provider:"jev",choice,probabilities,...(confidence!=null?{confidence}:{}),threshold,accepted,...(model?{model}:{}),...(latencyMs!=null?{latencyMs}:{}),...(inputTokens!=null?{inputTokens}:{}),...(actualCostUsd!=null?{actualCostUsd}:{})};
}
export async function runJevNoul(id:JevDecisionId,state:Record<string,unknown>,instructions?:string,raw?:JevIntegrationInput,ctx:JevDecisionContext={}):Promise<JevNoulResult>{
  const d=getJevDecisionDefinition(id);if(d.type!=="noul")throw new Error(`${id} is not a noul decision`);const config=await resolveJevIntegrationConfig(raw),threshold=d.threshold;let p=0,model:string|undefined,latencyMs:number|undefined,inputTokens:number|undefined,actualCostUsd:number|undefined,provider:string=config.transport,requestId:string|undefined;
  if(config.transport==="openrouter"){
    const r=await evaluateOpenRouterJev(compileJevState(state),{decision:{type:"noul",instructions:instructions??d.instructions}},{model:config.model}),a=r.answers.decision;
    if(!object(a)||a.type!=="noul"||!validProbability(a.noul))throw new Error("OpenRouter Jev returned an invalid noul answer");p=a.noul;model=r.model;latencyMs=r.latencyMs;inputTokens=r.usage?.inputTokens;actualCostUsd=r.usage?.actualCostUsd;provider=r.provider;requestId=r.requestId;
  }else{
    const row:WorkflowOptimizerCandidate={id:"yes",kind:"presentation-group",title:"yes",description:instructions??d.instructions,nodeIds:[],risk:"safe",estimatedNodeDelta:0,hostEligible:true},e=await createResolvedJevWorkflowOptimizerEvaluator(config)(compileJevState(state),[row]);p=e.probabilities.yes??0;model=e.jev?.model??config.model;latencyMs=e.jev?.latencyMs;inputTokens=e.jev?.inputTokens;actualCostUsd=e.jev?.actualCostUsd;provider=e.jev?.provider??"mcp";requestId=e.jev?.requestId;
  }
  const accepted=p>=threshold;await recordJevTelemetry({event:"decision",...baseTelemetry(id,ctx),model,provider,requestId,candidateCount:1,selected:accepted?["yes"]:[],probabilities:{yes:p},threshold,latencyMs,actual:{...(inputTokens!=null?{inputTokens}:{}),...(actualCostUsd!=null?{costUsd:actualCostUsd}:{})}}).catch(()=>undefined);
  return{kind:"mso.jev-decision.v1",decisionId:id,decisionVersion:d.version,provider:"jev",probability:p,threshold,accepted,...(model?{model}:{}),...(latencyMs!=null?{latencyMs}:{}),...(inputTokens!=null?{inputTokens}:{}),...(actualCostUsd!=null?{actualCostUsd}:{})};
}
export async function runJevScore(id:JevDecisionId,state:Record<string,unknown>,raw?:JevIntegrationInput,ctx:JevDecisionContext={}):Promise<JevScoreResult>{
  const d=getJevDecisionDefinition(id);if(d.type!=="score"||!Array.isArray(d.criteria))throw new Error(`${id} is not a score decision`);const config=await resolveJevIntegrationConfig(raw);if(config.transport!=="openrouter")throw new Error("score decisions require the default OpenRouter JEV path");
  const r=await evaluateOpenRouterJev(compileJevState(state),{decision:{type:"score",instructions:d.instructions,criteria:d.criteria}},{model:config.model}),a=r.answers.decision;
  if(!object(a)||a.type!=="score"||typeof a.score!=="number"||!Number.isFinite(a.score)||a.score<0||a.score>d.criteria.length-1||!object(a.probabilities)||(a.confidence!==undefined&&!validProbability(a.confidence)))throw new Error("OpenRouter Jev returned an invalid score answer");
  const probabilities=providerProbabilities(a.probabilities,d.criteria.map((_,index)=>String(index)),"score"),confidence=a.confidence;
  await recordJevTelemetry({event:"decision",...baseTelemetry(id,ctx),model:r.model,provider:r.provider,requestId:r.requestId,candidateCount:d.criteria.length,selected:[String(Math.round(a.score))],probabilities,threshold:d.threshold,latencyMs:r.latencyMs,actual:{...(r.usage?.inputTokens!=null?{inputTokens:r.usage.inputTokens}:{}),...(r.usage?.outputTokens!=null?{outputTokens:r.usage.outputTokens}:{}),...(r.usage?.actualCostUsd!=null?{costUsd:r.usage.actualCostUsd}:{})}}).catch(()=>undefined);
  return{kind:"mso.jev-decision.v1",decisionId:id,decisionVersion:d.version,provider:"jev",score:a.score,probabilities,...(confidence!=null?{confidence}:{}),threshold:d.threshold,model:r.model,latencyMs:r.latencyMs,...(r.usage?.inputTokens!=null?{inputTokens:r.usage.inputTokens}:{}),...(r.usage?.actualCostUsd!=null?{actualCostUsd:r.usage.actualCostUsd}:{})};
}
