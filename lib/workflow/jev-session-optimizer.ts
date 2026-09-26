import type { SessionGraphView } from "@/lib/contracts/session-monitor";
import { createResolvedJevWorkflowOptimizerEvaluator } from "./jev-evaluator";
import { resolveJevIntegrationConfig, type JevIntegrationInput } from "./jev-integration";
import type { WorkflowOptimizerCandidate } from "./graph-optimizer";

export type JevSessionOptimization = {
  provider: "jev" | "fallback";
  source: { sessionLabel: string; observedAt: string; shownEvents: number; omittedEvents: number };
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
  const options = raw && typeof raw === "object" ? raw as JevIntegrationInput : undefined;
  const rows = candidates(view);
  const state = { session:{ label:view.session.label, title:view.session.title, source:view.session.source, status:view.session.status, project:view.session.cwd }, coverage:{ shownEvents:view.shownEvents, omittedEvents:view.omittedEvents }, steps:view.steps.map(s=>({ ref:s.ref, category:s.category, title:s.title, summary:s.summary, actions:s.actions.map(a=>({ref:a.ref,tool:a.tool,state:a.state,kind:a.kind,artifactRefs:a.artifact?[a.artifact.ref]:[]})) })) };
  let provider: "jev" | "fallback" = "jev", probabilities: Record<string,number> = {}, fallbackReason: string | undefined;
  try { probabilities=(await createResolvedJevWorkflowOptimizerEvaluator(await resolveJevIntegrationConfig(options))(state,rows)).probabilities; }
  catch (cause) { provider="fallback"; fallbackReason=cause instanceof Error?cause.message.slice(0,240):"Jev evaluation failed"; }
  const recommendations=rows.map(row=>({...row, probability:provider==="jev"?(probabilities[row.id]??0):0, actionRefs:row.nodeIds})).filter(row=>row.probability>=0.5).sort((a,b)=>b.probability-a.probability).map(({id,title,description,probability,actionRefs})=>({id,title,description,probability,actionRefs}));
  return { provider, source:{sessionLabel:view.session.label,observedAt:view.observedAt,shownEvents:view.shownEvents,omittedEvents:view.omittedEvents}, recommendations, llmContext:{kind:"mso.jev-session-optimization.v1",instruction:"Treat these as review-first decision signals. Re-check live state before mutation. Never infer credentials, arguments, permissions, or success from this packet.",facts:[`Session ${view.session.label} has ${view.steps.length} semantic steps.`,`Projection covers ${view.shownEvents}/${view.totalEvents} events.`,...(view.omittedEvents?[`${view.omittedEvents} older events are omitted from this bounded projection.`]:[])],recommendations:recommendations.map(r=>({id:r.id,probability:r.probability,actionRefs:r.actionRefs,guidance:r.description}))},...(fallbackReason?{fallbackReason}:{}) };
}
