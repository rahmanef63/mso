import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { hostCredentialStore } from "@/lib/config/store";
import { DEFAULT_JEV_OPENROUTER_MODEL } from "@/lib/workflow/jev-openrouter";
import { listJevDecisionDefinitions } from "@/lib/workflow/jev-decision-registry";
import { readJevCalibration, readJevTelemetryWindows } from "@/lib/workflow/jev-telemetry";
import { jevPreservationStatus } from "@/lib/agent/session-jev-preservation";
import { readSetupJson } from "@/lib/infra/setup-http";
import { assessRecipePromotionWithJev, budgetContextWithJev, classifyMemoryAdmissionWithJev, routeModelWithJev, triageFailureWithJev, verifyActionOutcomeWithJev } from "@/lib/workflow/jev-services";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};

export async function GET(){
  const context=await getSessionContext();
  if(!context?.session.device_id||context.role!=="owner")return NextResponse.json({error:"owner_role_required"},{status:403,headers});
  const [openrouterKey,windows,calibration,preservation]=await Promise.all([
    hostCredentialStore().getKey(undefined,"openrouter"),
    readJevTelemetryWindows(),
    readJevCalibration(),
    jevPreservationStatus(),
  ]);
  return NextResponse.json({
    kind:"mso.jev-control-plane.v1",
    model:DEFAULT_JEV_OPENROUTER_MODEL,
    openrouterConnected:Boolean(openrouterKey),
    registry:listJevDecisionDefinitions(),
    windows,
    calibration,
    preservation,
    accounting:{actual:"Provider-reported JEV tokens/cost only.",estimated:"Avoided LLM/token/cost/latency fields are estimates and are never reported as actual savings."},
  },{headers});
}


function object(value:unknown):value is Record<string,unknown>{return Boolean(value&&typeof value==="object"&&!Array.isArray(value))}
export async function POST(req:NextRequest){
  const context=await getSessionContext();
  if(!context?.session.device_id||context.role!=="owner")return NextResponse.json({error:"owner_role_required"},{status:403,headers});
  try{
    const body=await readSetupJson(req),decision=String(body.decision_id??""),state=object(body.state)?body.state:{};
    const ctx={correlationId:`web:${context.session.device_id}`};
    if(decision==="model.route")return NextResponse.json(await routeModelWithJev(state,undefined,ctx),{headers});
    if(decision==="context.admit"){
      const evidence=Array.isArray(body.evidence)?body.evidence.slice(0,16).filter(object).map((row,index)=>({id:String(row.id??`e${index+1}`).slice(0,80),summary:String(row.summary??"").slice(0,1000),...(typeof row.text==="string"?{text:row.text}:{}),...(Number.isFinite(Number(row.estimatedTokens))?{estimatedTokens:Math.max(0,Number(row.estimatedTokens))}:{})})):[];
      return NextResponse.json(await budgetContextWithJev(state,evidence,undefined,ctx),{headers});
    }
    if(decision==="memory.admit"){
      const candidate=object(body.candidate)?body.candidate:{};
      const kind=["episodic","semantic","procedural"].includes(String(candidate.kind))?candidate.kind as "episodic"|"semantic"|"procedural":undefined;
      return NextResponse.json(await classifyMemoryAdmissionWithJev(state,{kind,summary:String(candidate.summary??"").slice(0,2000),provenance:typeof candidate.provenance==="string"?candidate.provenance.slice(0,500):undefined},undefined,ctx),{headers});
    }
    if(decision==="failure.triage")return NextResponse.json(await triageFailureWithJev(state,undefined,ctx),{headers});
    if(decision==="recipe.promote")return NextResponse.json(await assessRecipePromotionWithJev(state,undefined,ctx),{headers});
    if(decision==="action.verify")return NextResponse.json(await verifyActionOutcomeWithJev(String(body.intent??"").slice(0,1200),body.evidence,undefined,ctx),{headers});
    return NextResponse.json({error:"unsupported_jev_decision"},{status:400,headers});
  }catch(cause){return NextResponse.json({error:cause instanceof Error?cause.message.slice(0,240):"jev_decision_failed"},{status:400,headers})}
}
