import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAgentSession } from "@/lib/agent/session-store";
import { rateLimited, rateLimitedUntrusted } from "@/lib/host/limits-api";
import { clientIp } from "@/lib/host/request-ip";
import { maxScope } from "@/lib/mcp/scope";
import { msoCapabilityRuntime } from "@/lib/mcp/capability-runtime";
import { readRequestText, RequestBodyError } from "@/lib/security/request-body";
import { workflowExecutionContext } from "@/lib/workflow/graph-authority";
import { startWorkflowGraph, workflowGraphRunStatus } from "@/lib/workflow/graph-engine";
import { findActiveWebhookSource } from "@/lib/workflow/graph-triggers";
import { workflowWebhookSecret } from "@/lib/workflow/variables";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };
const reply = (error:string,status:number,extra?:HeadersInit) =>
  NextResponse.json({ error }, { status, headers: { ...noStore, ...extra } });
function same(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
async function payload(req:NextRequest){
  let body:unknown=null;
  if(!["GET","HEAD"].includes(req.method)){
    const text=await readRequestText(req,64*1024);
    try{body=text?JSON.parse(text):null;}catch{body=text;}
  }
  return{method:req.method,query:Object.fromEntries(req.nextUrl.searchParams),httpHeaders:{"content-type":req.headers.get("content-type")||undefined,"user-agent":req.headers.get("user-agent")||undefined,"x-request-id":req.headers.get("x-request-id")||undefined},body};
}
async function handle(req:NextRequest,ctx:{params:Promise<{hook:string[]}>}){
  try{
    const {hook}=await ctx.params;
    if(hook.length!==2||hook.some((part)=>!/^[A-Za-z0-9_-]{1,96}$/.test(part)))return reply("webhook_not_found",404);
    if(rateLimitedUntrusted("workflow-webhook:ip:"+clientIp(req),30,60_000)||rateLimitedUntrusted("workflow-webhook:lookup",300,60_000))return reply("rate_limited",429,{"Retry-After":"60"});
    const source=await findActiveWebhookSource(hook[0]!,hook[1]!);
    if(!source)return reply("webhook_not_found",404);
    const methods=Array.isArray(source.node.config.methods)?source.node.config.methods.map(String):["POST"];
    if(!methods.includes(req.method))return reply("method_not_allowed",405,{Allow:methods.join(", ")});
    const authVar=typeof source.node.config.authVariable==="string"?source.node.config.authVariable:"";
    if(!authVar)return reply("webhook_auth_not_configured",503);
    const expected=await workflowWebhookSecret(source.principal,authVar);
    if(!expected)return reply("webhook_auth_not_configured",503);
    const raw=req.headers.get("authorization")?.replace(/^Bearer\s+/i,"")??req.headers.get("x-webhook-token")??"";
    if(!same(raw,expected))return reply("unauthorized",401);
    if(rateLimited("workflow-webhook:"+source.graph.id+":"+source.node.id,120,60_000))return reply("rate_limited",429,{"Retry-After":"60"});
    const trigger={type:"webhook" as const,nodeId:source.node.id,receivedAt:new Date().toISOString()};
    const authority=await workflowExecutionContext({principal:source.principal,actor:source.principal,scope:maxScope()},trigger);
    const input=await payload(req);
    const session=await createAgentSession(source.principal,"cli",{title:"Webhook: "+source.graph.name,titleSource:"auto"});
    const {TOOLS_BY_NAME}=await import("@/lib/mcp/tools");
    const key=(req.headers.get("idempotency-key")||"webhook-"+randomUUID()).slice(0,128);
    const context={...authority,sessionId:session.id,capabilities:msoCapabilityRuntime};
    const started=await startWorkflowGraph(source.graph,input,key,context,(name)=>TOOLS_BY_NAME.get(name),source.principal,trigger);
    if(source.node.config.responseMode!=="lastNode")return NextResponse.json({runId:started.id,state:started.state},{status:202,headers:noStore});
    const done=await workflowGraphRunStatus(source.principal,started.id,25_000);
    const output=[...done.nodes].reverse().find((node)=>node.type==="output"&&node.output!==undefined)?.output;
    return NextResponse.json({runId:done.id,state:done.state,output},{status:done.state==="failed"?500:200,headers:noStore});
  }catch(error){
    if(error instanceof RequestBodyError)return reply(error.message,error.status);
    return reply("webhook_failed",400);
  }
}
export const GET=handle;export const POST=handle;export const PUT=handle;export const PATCH=handle;export const DELETE=handle;
