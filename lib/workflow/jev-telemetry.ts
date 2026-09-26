import { randomUUID } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expandOwnerStorePath } from "@/lib/owner-store-path.js";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { redactText } from "@/lib/security/redact-text";
import type { JevDecisionId, JevDecisionType } from "./jev-decision-registry";

export type JevTelemetryEvent={
  id?:string;event:"decision"|"execution"|"impact";timestamp?:string;
  decisionId:JevDecisionId;decisionVersion:number;decisionType:JevDecisionType;
  model?:string;provider?:string;requestId?:string;correlationId?:string;
  candidateCount?:number;selected?:string[];probabilities?:Record<string,number>;threshold?:number;latencyMs?:number;
  actual?:{inputTokens?:number;outputTokens?:number;costUsd?:number};
  estimated?:{llmAvoided?:boolean;modelAvoided?:string;inputTokensAvoided?:number;costAvoidedUsd?:number;latencyMsAvoided?:number};
  fallbackOrEscalation?:boolean;tool?:string;executionAttempted?:boolean;executionResult?:"success"|"failed"|"denied";
  selectedProbability?:number;verificationResult?:"pass"|"fail"|"unknown";humanOverride?:boolean;
  sessionRef?:string;workflowRef?:string;
};
type Stored=JevTelemetryEvent&{id:string;timestamp:string};
const STORE_PATH=expandOwnerStorePath(process.env.OS_JEV_TELEMETRY_STORE??path.join(os.homedir(),".mso","private","jev-telemetry.json"));
const MAX_BYTES=8*1024*1024,MAX_EVENTS=10_000,RETENTION_MS=30*24*60*60_000;

const finite=(v:unknown)=>{const n=Number(v);return Number.isFinite(n)&&n>=0?n:undefined};
const cleanText=(v:unknown,max=180)=>typeof v==="string"&&v?redactText(v,max):undefined;
function sanitize(input:JevTelemetryEvent):Stored{
  const probabilities=Object.fromEntries(Object.entries(input.probabilities??{}).slice(0,16).flatMap(([k,v])=>{const n=finite(v);return n==null?[]:[[redactText(k,80),Math.min(1,n)]]}));
  const actual=input.actual?{inputTokens:finite(input.actual.inputTokens),outputTokens:finite(input.actual.outputTokens),costUsd:finite(input.actual.costUsd)}:undefined;
  const estimated=input.estimated?{llmAvoided:Boolean(input.estimated.llmAvoided),modelAvoided:cleanText(input.estimated.modelAvoided),inputTokensAvoided:finite(input.estimated.inputTokensAvoided),costAvoidedUsd:finite(input.estimated.costAvoidedUsd),latencyMsAvoided:finite(input.estimated.latencyMsAvoided)}:undefined;
  return {
    ...input,id:input.id??randomUUID(),timestamp:input.timestamp??new Date().toISOString(),
    model:cleanText(input.model),provider:cleanText(input.provider),requestId:cleanText(input.requestId),correlationId:cleanText(input.correlationId),
    selected:(input.selected??[]).slice(0,16).map(v=>redactText(v,80)),probabilities,
    candidateCount:finite(input.candidateCount),threshold:finite(input.threshold),latencyMs:finite(input.latencyMs),
    ...(actual?{actual}:{}),...(estimated?{estimated}:{}),tool:cleanText(input.tool,96),sessionRef:cleanText(input.sessionRef),workflowRef:cleanText(input.workflowRef),
  };
}
async function readUnlocked():Promise<{version:1;events:Stored[]}>{
  let handle:Awaited<ReturnType<typeof fs.open>>|null=null;
  try{
    handle=await fs.open(STORE_PATH,fsConstants.O_RDONLY|fsConstants.O_NOFOLLOW);
    const stat=await handle.stat();
    if(!stat.isFile()||stat.size<=0||stat.size>MAX_BYTES||(stat.mode&0o077)!==0)throw new Error("JEV telemetry store has an invalid file shape");
    if(typeof process.getuid==="function"&&stat.uid!==process.getuid())throw new Error("JEV telemetry store is not owned by the MSO user");
    const data=JSON.parse(await handle.readFile("utf8")) as {version:number;events:Stored[]};
    if(data.version!==1||!Array.isArray(data.events))throw new Error("JEV telemetry store has an invalid schema");
    return {version:1,events:data.events};
  }catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return{version:1,events:[]};throw error}
  finally{await handle?.close().catch(()=>undefined)}
}
async function writeUnlocked(store:{version:1;events:Stored[]}){
  const cutoff=Date.now()-RETENTION_MS;
  store.events=store.events.filter(row=>Date.parse(row.timestamp)>=cutoff).slice(-MAX_EVENTS);
  const body=JSON.stringify(store);
  if(Buffer.byteLength(body,"utf8")>MAX_BYTES)throw new Error("JEV telemetry store exceeds 8 MiB");
  const dir=path.dirname(STORE_PATH);await fs.mkdir(dir,{recursive:true,mode:0o700});await fs.chmod(dir,0o700).catch(()=>undefined);
  const tmp=`${STORE_PATH}.${randomUUID()}.tmp`;await fs.writeFile(tmp,body,{encoding:"utf8",mode:0o600,flag:"wx"});await fs.rename(tmp,STORE_PATH);await fs.chmod(STORE_PATH,0o600);
}
export async function recordJevTelemetry(input:JevTelemetryEvent):Promise<void>{
  await withSecurityStoreLock(STORE_PATH,async()=>{const store=await readUnlocked();store.events.push(sanitize(input));await writeUnlocked(store)});
}
function metrics(rows:Stored[],days:number){
  const since=Date.now()-days*24*60*60_000,window=rows.filter(row=>Date.parse(row.timestamp)>=since),decisions=window.filter(row=>row.event==="decision"),executions=window.filter(row=>row.event==="execution");
  const sum=(fn:(row:Stored)=>number|undefined)=>window.reduce((n,row)=>n+(fn(row)??0),0);
  const candidateCount=decisions.reduce((n,row)=>n+(row.candidateCount??0),0),selectedCount=decisions.reduce((n,row)=>n+(row.selected?.length??0),0);
  const escalations=decisions.filter(row=>row.fallbackOrEscalation).length,verified=executions.filter(row=>row.verificationResult&&row.verificationResult!=="unknown");
  const executionAttempts=executions.filter(row=>row.executionAttempted),overrides=window.filter(row=>row.humanOverride);
  return {days,totalDecisions:decisions.length,decisionRatePerDay:Math.round(decisions.length/Math.max(1,days)*100)/100,candidateCount,selectedCount,acceptanceRate:candidateCount?selectedCount/candidateCount:0,
    actual:{jevInputTokens:sum(r=>r.actual?.inputTokens),jevOutputTokens:sum(r=>r.actual?.outputTokens),jevCostUsd:sum(r=>r.actual?.costUsd)},
    estimated:{frontierCallsAvoided:window.filter(r=>r.estimated?.llmAvoided).length,inputTokensAvoided:sum(r=>r.estimated?.inputTokensAvoided),costAvoidedUsd:sum(r=>r.estimated?.costAvoidedUsd),latencyMsAvoided:sum(r=>r.estimated?.latencyMsAvoided)},
    escalationRate:decisions.length?escalations/decisions.length:0,toolRouteReuseCount:decisions.filter(r=>r.selected?.some(v=>v.startsWith("reuse-"))).length,handoffCount:decisions.filter(r=>r.selected?.includes("handoff-packet")).length,
    memoryAdmissionCount:decisions.filter(r=>r.decisionId==="memory.admit"&&r.selected?.some(v=>v!=="ignore")).length,recipeCandidateCount:decisions.filter(r=>r.decisionId==="recipe.promote").length,
    downstreamExecutionSuccessRate:executionAttempts.length?executionAttempts.filter(r=>r.executionResult==="success").length/executionAttempts.length:0,
    verificationSuccessRate:verified.length?verified.filter(r=>r.verificationResult==="pass").length/verified.length:0,humanOverrideRate:decisions.length?overrides.length/decisions.length:0,
    decisionsByType:Object.fromEntries(["choice","noul","score"].map(type=>[type,decisions.filter(r=>r.decisionType===type).length])),
  };
}
export async function readJevTelemetryWindows(){const rows=(await readUnlocked()).events;return{today:metrics(rows,1),days7:metrics(rows,7),days30:metrics(rows,30)}}
export async function readJevCalibration(){
  const rows=(await readUnlocked()).events.filter(r=>r.event==="execution"&&typeof r.selectedProbability==="number"&&r.verificationResult&&r.verificationResult!=="unknown");
  return Array.from({length:10},(_,i)=>{const min=i/10,max=(i+1)/10,b=rows.filter(r=>r.selectedProbability!>=min&&(i===9?r.selectedProbability!<=max:r.selectedProbability!<max));return{min,max,count:b.length,successRate:b.length?b.filter(r=>r.verificationResult==="pass").length/b.length:0,humanOverrideRate:b.length?b.filter(r=>r.humanOverride).length/b.length:0}});
}
