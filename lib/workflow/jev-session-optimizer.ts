import type { SessionGraphView } from "@/lib/contracts/session-monitor";
import { createJevDecisionEvaluator } from "./jev-decision-plane";
import { getJevDecisionDefinition } from "./jev-decision-registry";
import type { JevIntegrationInput } from "./jev-integration";
import type { WorkflowOptimizerCandidate } from "./graph-optimizer";
import { estimateJevTokens } from "./jev-state-compiler";
import { recordJevTelemetry } from "./jev-telemetry";

export type JevSessionOptimization = {
  provider: "jev" | "fallback";
  decision:{id:"session.optimize";version:number;threshold:number;model?:string;latencyMs?:number;inputTokens?:number;actualCostUsd?:number};
  source: { sessionLabel: string; observedAt: string; shownEvents: number; omittedEvents: number };
  summary: { candidateCount: number; acceptedCount: number; rejectedCount: number };
  valueSummary: { semanticStepCount: number; toolCount: number; artifactRefCount: number };
  recommendations: Array<{ id: string; title: string; description: string; probability: number; actionRefs: string[] }>;
  llmContext: { kind: "mso.jev-session-optimization.v1"; instruction: string; facts: string[]; recommendations: Array<{ id: string; probability: number; actionRefs: string[]; guidance: string }> };
  fallbackReason?: string;
};

function candidates(view: SessionGraphView): WorkflowOptimizerCandidate[] {
  const out: WorkflowOptimizerCandidate[] = [];
  for (const step of view.steps) {
    if (step.actions.length >= 3) out.push({ id:`compact-${step.ref}`, kind:"loop-compaction", hostEligible:true, title:`Compact ${step.ref}: ${step.title}`, description:`Replace repeated planning/inspection overhead in ${step.ref} with the smallest reusable bounded workflow while preserving verification and authorization boundaries.`, nodeIds:step.actions.map(a=>a.ref), estimatedNodeDelta:Math.max(1,step.actions.length-2), risk:"review" });
    const tools = step.actions.map(a=>a.tool).filter((v):v is string=>Boolean(v));
    if (tools.length >= 2 && new Set(tools).size < tools.length) out.push({ id:`reuse-${step.ref}`, kind:"loop-compaction", hostEligible:true, title:`Reuse proven route from ${step.ref}`, description:`Prefer the repeated tool route already evidenced in ${step.ref} over rediscovering the same route with another LLM.`, nodeIds:step.actions.filter(a=>a.tool).map(a=>a.ref), estimatedNodeDelta:Math.max(1,tools.length-new Set(tools).size), risk:"safe" });
  }
  if (view.steps.length >= 4) out.push({ id:"handoff-packet", kind:"presentation-group", hostEligible:true, title:"Create compact continuation packet", description:"Use the semantic session flow, durable action refs, artifacts and learned recipes as the continuation context instead of replaying the raw transcript.", nodeIds:view.steps.map(s=>s.ref), estimatedNodeDelta:Math.max(1,view.steps.length-2), risk:"safe" });
  return out.slice(0, 16);
}

export async function optimizeSessionWithJev(view: SessionGraphView, raw?: unknown): Promise<JevSessionOptimization> {
  const options = raw && typeof raw === "object" ? raw as JevIntegrationInput : undefined,rows=candidates(view),definition=getJevDecisionDefinition("session.optimize");
  const state = { session:{ label:view.session.label, title:view.session.title, source:view.session.source, status:view.session.status, project:view.session.cwd }, coverage:{ shownEvents:view.shownEvents, omittedEvents:view.omittedEvents }, steps:view.steps.map(s=>({ ref:s.ref, category:s.category, title:s.title, summary:s.summary, actions:s.actions.map(a=>({ref:a.ref,tool:a.tool,state:a.state,kind:a.kind,artifactRefs:a.artifact?[a.artifact.ref]:[]})) })) };
  let provider:"jev"|"fallback"="jev",probabilities:Record<string,number>={},fallbackReason:string|undefined,meta:{model?:string;latencyMs?:number;inputTokens?:number;actualCostUsd?:number}={};
  try{
    const evaluation=await createJevDecisionEvaluator("session.optimize",options,{sessionRef:view.session.label})(state,rows);probabilities=evaluation.probabilities;
    meta={...(evaluation.jev?.model?{model:evaluation.jev.model}:{}),...(evaluation.jev?.latencyMs!=null?{latencyMs:evaluation.jev.latencyMs}:{}),...(evaluation.jev?.inputTokens!=null?{inputTokens:evaluation.jev.inputTokens}:{}),...(evaluation.jev?.actualCostUsd!=null?{actualCostUsd:evaluation.jev.actualCostUsd}:{})};
  }catch(cause){provider="fallback";fallbackReason=cause instanceof Error?cause.message.slice(0,240):"Jev evaluation failed"}
  const recommendations=rows.map(row=>({...row, probability:provider==="jev"?(probabilities[row.id]??0):0, actionRefs:row.nodeIds})).filter(row=>row.probability>=definition.threshold).sort((a,b)=>b.probability-a.probability).map(({id,title,description,probability,actionRefs})=>({id,title,description,probability,actionRefs}));
  const semanticFacts=view.steps.slice(-16).map(step=>{
    const tools=[...new Set(step.actions.map(action=>action.tool).filter((tool):tool is string=>Boolean(tool)))].slice(0,8);
    return `${step.ref} · ${step.category} · ${step.title}: ${step.summary}${tools.length?` · tools ${tools.join(" → ")}`:""}`;
  });
  const tools=new Set(view.steps.flatMap(step=>step.actions.map(action=>action.tool).filter((tool):tool is string=>Boolean(tool))));
  const artifactRefs=new Set(view.steps.flatMap(step=>step.actions.flatMap(action=>action.artifact?[action.artifact.ref]:[])));
  const valueSummary={semanticStepCount:view.steps.length,toolCount:tools.size,artifactRefCount:artifactRefs.size};
  const llmContext={kind:"mso.jev-session-optimization.v1" as const,instruction:"JEV DECISION only. Re-check live state before mutation. MCP ACTION and VERIFIED RESULT are separate stages; never infer credentials, arguments, permissions, execution, or success from this packet.",facts:[`Session ${view.session.label} has ${view.steps.length} semantic steps.`,`Projection covers ${view.shownEvents}/${view.totalEvents} events.`,`Continuation capsule retains ${valueSummary.semanticStepCount} semantic steps, ${valueSummary.toolCount} unique tools, and ${valueSummary.artifactRefCount} artifact references.`,...(view.omittedEvents?[`${view.omittedEvents} older events are omitted from this bounded projection.`]:[]),...semanticFacts],recommendations:recommendations.map(r=>({id:r.id,probability:r.probability,actionRefs:r.actionRefs,guidance:r.description}))};
  if(provider==="jev"&&recommendations.length){
    const rawTokens=estimateJevTokens(state),selectedTokens=estimateJevTokens(llmContext),reuse=recommendations.some(row=>row.id.startsWith("reuse-"));
    await recordJevTelemetry({event:"impact",decisionId:"session.optimize",decisionVersion:definition.version,decisionType:definition.type,sessionRef:view.session.label,estimated:{llmAvoided:reuse,inputTokensAvoided:Math.max(0,rawTokens-selectedTokens)}}).catch(()=>undefined);
  }
  return {provider,decision:{id:"session.optimize",version:definition.version,threshold:definition.threshold,...meta},source:{sessionLabel:view.session.label,observedAt:view.observedAt,shownEvents:view.shownEvents,omittedEvents:view.omittedEvents},summary:{candidateCount:rows.length,acceptedCount:recommendations.length,rejectedCount:Math.max(0,rows.length-recommendations.length)},valueSummary,recommendations,llmContext,...(fallbackReason?{fallbackReason}:{})};
}
