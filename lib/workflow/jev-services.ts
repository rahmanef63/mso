import type { JevIntegrationInput } from "./jev-integration";
import type { JevDecisionContext } from "./jev-decision-plane";
import { createJevDecisionEvaluator, runJevChoice, runJevNoul, runJevScore } from "./jev-decision-plane";
import { getJevDecisionDefinition } from "./jev-decision-registry";
import { estimateJevTokens } from "./jev-state-compiler";
import { recordJevTelemetry } from "./jev-telemetry";
import type { WorkflowOptimizerCandidate } from "./graph-optimizer";

export async function routeModelWithJev(state:Record<string,unknown>,raw?:JevIntegrationInput,ctx:JevDecisionContext={}){
  try{const result=await runJevChoice("model.route",state,raw,ctx);return{...result,route:result.accepted?result.choice:null,fallback:result.accepted?undefined:"current-configured-model"}}
  catch(cause){return{kind:"mso.jev-model-route.v1" as const,route:null,fallback:"current-configured-model",error:cause instanceof Error?cause.message.slice(0,240):"JEV routing unavailable"}}
}
export type JevContextEvidence={id:string;summary:string;text?:string;estimatedTokens?:number};
export async function budgetContextWithJev(state:Record<string,unknown>,evidence:JevContextEvidence[],raw?:JevIntegrationInput,ctx:JevDecisionContext={}){
  const rows=evidence.slice(0,16),definition=getJevDecisionDefinition("context.admit");
  const candidates:WorkflowOptimizerCandidate[]=rows.map(row=>({id:row.id.slice(0,80),kind:"presentation-group",title:row.id.slice(0,80),description:row.summary.slice(0,800),nodeIds:[],risk:"safe",estimatedNodeDelta:0,hostEligible:true}));
  const rawTokens=rows.reduce((n,row)=>n+(row.estimatedTokens??estimateJevTokens(row.text??row.summary)),0);
  try{
    const evaluation=await createJevDecisionEvaluator("context.admit",raw,ctx)(state,candidates),chosen=new Set(candidates.filter(row=>(evaluation.probabilities[row.id]??0)>=definition.threshold).map(row=>row.id));
    const selected=rows.filter(row=>chosen.has(row.id.slice(0,80))),selectedTokens=selected.reduce((n,row)=>n+(row.estimatedTokens??estimateJevTokens(row.text??row.summary)),0);
    await recordJevTelemetry({event:"impact",decisionId:"context.admit",decisionVersion:definition.version,decisionType:definition.type,estimated:{inputTokensAvoided:Math.max(0,rawTokens-selectedTokens)},...ctx}).catch(()=>undefined);
    return{kind:"mso.jev-context-budget.v1" as const,provider:evaluation.provider,rawEstimatedTokens:rawTokens,selectedEstimatedTokens:selectedTokens,estimatedInputTokensAvoided:Math.max(0,rawTokens-selectedTokens),selected,probabilities:evaluation.probabilities};
  }catch(cause){return{kind:"mso.jev-context-budget.v1" as const,provider:"fallback" as const,rawEstimatedTokens:rawTokens,selectedEstimatedTokens:rawTokens,estimatedInputTokensAvoided:0,selected:rows,probabilities:{},fallbackReason:cause instanceof Error?cause.message.slice(0,240):"JEV context admission unavailable"}}
}
export type JevMemoryClass="ignore"|"episodic"|"semantic"|"procedural"|"candidate-recipe";
export async function classifyMemoryAdmissionWithJev(state:Record<string,unknown>,candidate:{kind?:"episodic"|"semantic"|"procedural";summary:string;provenance?:string},raw?:JevIntegrationInput,ctx:JevDecisionContext={}){
  try{const result=await runJevChoice("memory.admit",{...state,candidate:{kind:candidate.kind,summary:candidate.summary.slice(0,1600),provenance:candidate.provenance?.slice(0,400)}},raw,ctx);const classification=(result.accepted?result.choice:(candidate.kind??"semantic")) as JevMemoryClass;return{...result,classification,admit:classification!=="ignore"}}
  catch(cause){const classification=(candidate.kind??"semantic") as JevMemoryClass;return{kind:"mso.jev-memory-admission.v1" as const,provider:"fallback" as const,classification,admit:true,fallbackReason:cause instanceof Error?cause.message.slice(0,240):"JEV memory admission unavailable"}}
}
export async function triageFailureWithJev(state:Record<string,unknown>,raw?:JevIntegrationInput,ctx:JevDecisionContext={}){
  try{const result=await runJevChoice("failure.triage",state,raw,ctx);return{...result,next:result.accepted?result.choice:"stop-safely"}}
  catch(cause){return{kind:"mso.jev-failure-triage.v1" as const,provider:"fallback" as const,next:"stop-safely",fallbackReason:cause instanceof Error?cause.message.slice(0,240):"JEV failure triage unavailable"}}
}
export async function assessRecipePromotionWithJev(state:Record<string,unknown>,raw?:JevIntegrationInput,ctx:JevDecisionContext={}){
  try{const result=await runJevScore("recipe.promote",state,raw,ctx);return{...result,reviewCandidate:result.score>=3&&(result.confidence??0)>=result.threshold,explicitPromotionRequired:true}}
  catch(cause){return{kind:"mso.jev-recipe-promotion.v1" as const,provider:"fallback" as const,reviewCandidate:false,explicitPromotionRequired:true,fallbackReason:cause instanceof Error?cause.message.slice(0,240):"JEV recipe scoring unavailable"}}
}
export async function verifyActionOutcomeWithJev(intent:string,evidence:unknown,raw?:JevIntegrationInput,ctx:JevDecisionContext={}){
  try{const result=await runJevNoul("action.verify",{intent:intent.slice(0,1200),evidence},"Does the bounded execution evidence satisfy the stated intent without assuming any unobserved side effect?",raw,ctx);return{...result,verification:result.accepted?"pass" as const:"fail" as const}}
  catch(cause){return{kind:"mso.jev-action-verification.v1" as const,provider:"fallback" as const,verification:"unknown" as const,fallbackReason:cause instanceof Error?cause.message.slice(0,240):"JEV verification unavailable"}}
}
