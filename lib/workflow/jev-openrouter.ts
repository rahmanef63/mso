import { hostCredentialStore } from "@/lib/config/store";
import { safeProviderFetch } from "@/lib/host/ssrf";
import { redactText } from "@/lib/security/redact-text";
import type { WorkflowOptimizerCandidate, WorkflowOptimizerEvaluation } from "./graph-optimizer";
import { compileJevState } from "./jev-state-compiler";

export const DEFAULT_JEV_OPENROUTER_MODEL = "~typesafe/jev-latest";
const OPENROUTER_JEV_ENDPOINT = "https://openrouter.ai/api/alpha/decisions";

export type JevOpenRouterQuestion =
  | { type:"noul"; instructions:string; criteria?:{true?:string;false?:string} }
  | { type:"choice"; instructions:string; criteria:Record<string,string> }
  | { type:"score"; instructions:string; criteria:string[] };
export type JevOpenRouterResult={
  model:string;provider:string;requestId?:string;answers:Record<string,unknown>;latencyMs:number;
  usage?:{inputTokens?:number;outputTokens?:number;actualCostUsd?:number};
};

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function finite(value:unknown):number|undefined{const n=Number(value);return Number.isFinite(n)&&n>=0?n:undefined}
function probability(answer: unknown): number | null {
  if (!object(answer)) return null;
  const value = Number(answer.noul);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}
function cleanQuestions(questions:Record<string,JevOpenRouterQuestion>){
  return Object.fromEntries(Object.entries(questions).slice(0,32).map(([id,q])=>[
    id.slice(0,96),
    q.type==="choice"
      ? {type:q.type,instructions:redactText(q.instructions,1200),criteria:Object.fromEntries(Object.entries(q.criteria).slice(0,255).map(([k,v])=>[k.slice(0,80),redactText(v,600)]))}
      : q.type==="score"
        ? {type:q.type,instructions:redactText(q.instructions,1200),criteria:q.criteria.slice(0,10).map(v=>redactText(v,600))}
        : {type:q.type,instructions:redactText(q.instructions,1200),...(q.criteria?{criteria:{true:redactText(q.criteria.true??"",400),false:redactText(q.criteria.false??"",400)}}:{})},
  ]));
}
export async function evaluateOpenRouterJev(
  state:Record<string,unknown>,
  questions:Record<string,JevOpenRouterQuestion>,
  config:{model?:string;timeoutMs?:number}={},
):Promise<JevOpenRouterResult>{
  const model=typeof config.model==="string"&&config.model.trim()?config.model.trim():DEFAULT_JEV_OPENROUTER_MODEL;
  if(model.length>180)throw new Error("invalid Jev OpenRouter model");
  const bounded=cleanQuestions(questions);
  if(!Object.keys(bounded).length)return{model,provider:"openrouter",answers:{},latencyMs:0};
  const apiKey=await hostCredentialStore().getKey(undefined,"openrouter");
  if(!apiKey)throw new Error("OpenRouter is not connected. Add an OpenRouter key in Settings → AI or Integrations → AI Providers.");
  const started=Date.now();
  const response=await safeProviderFetch(OPENROUTER_JEV_ENDPOINT,{
    method:"POST",
    headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json","x-title":"MSO JEV Decision Kernel"},
    body:JSON.stringify({model,state:compileJevState(state),questions:bounded}),
    signal:AbortSignal.timeout(Math.max(1_000,Math.min(20_000,config.timeoutMs??20_000))),
  });
  const latencyMs=Date.now()-started;
  if(!response.ok)throw new Error(`OpenRouter Jev request failed (${response.status})`);
  const payload=await response.json() as unknown;
  if(!object(payload)||!object(payload.answers))throw new Error("OpenRouter Jev returned no typed answers");
  const usage=object(payload.usage)?{inputTokens:finite(payload.usage.input_tokens),outputTokens:finite(payload.usage.output_tokens),actualCostUsd:finite(payload.usage.cost)}:undefined;
  return{
    model:typeof payload.model==="string"?payload.model:model,
    provider:typeof payload.provider==="string"?payload.provider:"openrouter",
    ...(typeof payload.id==="string"?{requestId:payload.id}:{}),
    answers:payload.answers,latencyMs,...(usage?{usage}:{}),
  };
}

export function createOpenRouterJevWorkflowOptimizerEvaluator(config: { model?: string } = {}) {
  const model = typeof config.model === "string" && config.model.trim() ? config.model.trim() : DEFAULT_JEV_OPENROUTER_MODEL;
  if (model.length > 180) throw new Error("invalid Jev OpenRouter model");
  return async (state: Record<string, unknown>, candidates: WorkflowOptimizerCandidate[]): Promise<WorkflowOptimizerEvaluation> => {
    if (!candidates.length) return { provider: "jev", probabilities: {} };
    const mapping=new Map<string,string>(),questions:Record<string,JevOpenRouterQuestion>={};
    candidates.slice(0,16).forEach((candidate,index)=>{
      const key=`q${index+1}`;mapping.set(key,candidate.id);
      questions[key]={type:"noul",instructions:redactText(`Should MSO apply candidate "${candidate.title}"? Answer yes only when it meaningfully improves this route while preserving semantics, permissions, bounded execution, auditability and debuggability. Candidate risk: ${candidate.risk}.`,1200)};
    });
    const result=await evaluateOpenRouterJev(state,questions,{model});
    const probabilities:Record<string,number>={};
    for(const [question,candidateId] of mapping){const p=probability(result.answers[question]);if(p!==null)probabilities[candidateId]=p}
    if(!Object.keys(probabilities).length)throw new Error("OpenRouter Jev returned no usable probabilities");
    return{provider:"jev",probabilities,jev:{
      model:result.model,provider:result.provider,requestId:result.requestId,latencyMs:result.latencyMs,
      inputTokens:result.usage?.inputTokens,outputTokens:result.usage?.outputTokens,actualCostUsd:result.usage?.actualCostUsd,
    }};
  };
}
