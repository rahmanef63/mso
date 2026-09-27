import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { hostCredentialStore } from "@/lib/config/store";
import type { SessionCard } from "@/lib/contracts/session-monitor";
import { redactUnknown } from "@/lib/security/redact-text";
import { DEFAULT_JEV_OPENROUTER_MODEL } from "@/lib/workflow/jev-openrouter";
import { optimizeSessionWithJev } from "@/lib/workflow/jev-session-optimizer";
import { agentSessionLabel } from "./session-name";
import { sessionGraph } from "./session-graph";
import { listSessionIds, listSessionRecords, normalizeSession, readSessionFile, sessionFileIdentity } from "./session-files";
import type { AgentSession, AgentSessionValueCapsule } from "./session-types";
import { agentSessionPreservationRoot, hasAgentSessionArchiveJevReceipt, listAgentSessionArchives, readAgentSessionArchive, writeAgentSessionArchiveJevReceipt } from "./session-archive";

export type JevPreservationStatus = { model: string; credentialSource: "settings-ai/openrouter"; openrouterConnected: boolean; liveSessions: number; archives: number; preservedLive: number; preservedArchives: number; pending: number };
export type JevPreservationBatch = { total: number; cursor: number; nextCursor?: number; processed: number; preserved: number; skipped: number; failed: number; errors: string[] };

type Source = { kind: "live"; key: string; sessionId: string } | { kind: "archive"; key: string; archiveName: string };

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function liveReceiptName(record: AgentSession): string { return `live-${record.id}-${hash(record.updatedAt).slice(0, 16)}.jev.json`; }
async function root(): Promise<string> { const dir=agentSessionPreservationRoot(); await fs.mkdir(dir,{recursive:true,mode:0o700}); await fs.chmod(dir,0o700).catch(()=>undefined); return dir; }

function buildCapsule(
  record: AgentSession,
  view: ReturnType<typeof sessionGraph>,
  optimization: Awaited<ReturnType<typeof optimizeSessionWithJev>>,
  identity: { sha256: string; bytes: number },
): AgentSessionValueCapsule {
  const semanticSteps = view.steps.slice(-24).map((step) => {
    const tools = [...new Set(step.actions.map((action) => action.tool).filter((tool): tool is string => Boolean(tool)))].slice(0, 12);
    const artifactRefs = [...new Set(step.actions.flatMap((action) => action.artifact ? [action.artifact.ref] : []))].slice(0, 24);
    return {
      ref: step.ref,
      category: step.category,
      title: step.title.slice(0, 180),
      summary: step.summary.slice(0, 1200),
      tools,
      actionRefs: step.actions.map((action) => action.ref).slice(0, 48),
      artifactRefs,
    };
  });
  const toolCount = new Set(semanticSteps.flatMap((step) => step.tools)).size;
  const artifactRefCount = new Set(semanticSteps.flatMap((step) => step.artifactRefs)).size;
  return {
    kind: "mso.jev-session-capsule.v1",
    model: DEFAULT_JEV_OPENROUTER_MODEL,
    sourceSha256: identity.sha256,
    sourceBytes: identity.bytes,
    capturedAt: new Date().toISOString(),
    sessionLabel: agentSessionLabel(record.name, record.title, record.cwd),
    updatedAt: record.updatedAt,
    decision: {
      id: optimization.decision.id,
      version: optimization.decision.version,
      threshold: optimization.decision.threshold,
      provider: optimization.provider,
      ...(optimization.decision.model ? { model: optimization.decision.model } : {}),
      ...(optimization.decision.latencyMs != null ? { latencyMs: optimization.decision.latencyMs } : {}),
      ...(optimization.decision.inputTokens != null ? { inputTokens: optimization.decision.inputTokens } : {}),
      ...(optimization.decision.actualCostUsd != null ? { actualCostUsd: optimization.decision.actualCostUsd } : {}),
    },
    summary: {
      candidateCount: optimization.summary.candidateCount,
      acceptedCount: optimization.summary.acceptedCount,
      rejectedCount: optimization.summary.rejectedCount,
      semanticStepCount: semanticSteps.length,
      toolCount,
      artifactRefCount,
    },
    semanticSteps,
    recommendations: optimization.recommendations.map((row) => ({
      id: row.id,
      title: row.title,
      probability: row.probability,
      actionRefs: row.actionRefs,
      guidance: row.description,
    })),
    continuation: optimization.llmContext,
  };
}

export async function readLiveJevSessionCapsule(record: AgentSession): Promise<AgentSessionValueCapsule | null> {
  try {
    const file = path.join(await root(), liveReceiptName(record));
    const raw = JSON.parse(await fs.readFile(file, "utf8")) as {
      schemaVersion?: unknown; kind?: unknown; provider?: unknown; sessionId?: unknown; updatedAt?: unknown;
      sourceSha256?: unknown; sourceBytes?: unknown; capsule?: AgentSessionValueCapsule;
    };
    if (raw.schemaVersion !== 2 || raw.kind !== "mso.jev-session-preservation.v2" || raw.provider !== "jev" ||
      raw.sessionId !== record.id || raw.updatedAt !== record.updatedAt || typeof raw.sourceSha256 !== "string" ||
      typeof raw.sourceBytes !== "number" || raw.capsule?.kind !== "mso.jev-session-capsule.v1") return null;
    const current = await sessionFileIdentity(record.id);
    if (raw.sourceSha256 !== current.sha256 || raw.sourceBytes !== current.bytes ||
      raw.capsule.sourceSha256 !== current.sha256 || raw.capsule.sourceBytes !== current.bytes) return null;
    return raw.capsule;
  } catch { return null; }
}
async function hasLiveReceipt(record: AgentSession): Promise<boolean> { return Boolean(await readLiveJevSessionCapsule(record)); }
async function writeLiveReceipt(record: AgentSession, view: ReturnType<typeof sessionGraph>, optimization: Awaited<ReturnType<typeof optimizeSessionWithJev>>): Promise<void> {
  const identity = await sessionFileIdentity(record.id), capsule = buildCapsule(record, view, optimization, identity);
  const dir=await root(),file=path.join(dir,liveReceiptName(record)),tmp=`${file}.${randomUUID()}.tmp`;
  const body=JSON.stringify(redactUnknown({schemaVersion:2,kind:"mso.jev-session-preservation.v2",provider:"jev",model:DEFAULT_JEV_OPENROUTER_MODEL,sessionId:record.id,sessionLabel:capsule.sessionLabel,updatedAt:record.updatedAt,preservedAt:new Date().toISOString(),sourceSha256:identity.sha256,sourceBytes:identity.bytes,capsule}),null,2);
  await fs.writeFile(tmp,body,{encoding:"utf8",mode:0o600,flag:"wx"}); await fs.chmod(tmp,0o600); await fs.rename(tmp,file); await fs.chmod(file,0o600);
}

function card(record: AgentSession): SessionCard { return { id:record.id,name:record.name,label:agentSessionLabel(record.name,record.title,record.cwd),title:record.title,source:record.source,status:"offline",receiverConnected:false,lastSeenAt:record.updatedAt,createdAt:record.createdAt,...(record.cwd?{cwd:record.cwd}:{}),eventCount:record.events.length,archiveCount:record.archiveCount,...(record.resumedFrom?{resumedFrom:record.resumedFrom}:{}),...(record.parentSessionId?{parentSessionId:record.parentSessionId}:{}) }; }
async function sources(): Promise<Source[]> { const live=await listSessionIds(),archives=await listAgentSessionArchives(); return [...live.map(sessionId=>({kind:"live" as const,key:`live:${sessionId}`,sessionId})),...archives.map(row=>({kind:"archive" as const,key:`archive:${row.name}`,archiveName:row.name}))].sort((a,b)=>a.key.localeCompare(b.key)); }

export async function jevPreservationStatus(): Promise<JevPreservationStatus> { const [key,live,archives]=await Promise.all([hostCredentialStore().getKey(undefined,"openrouter"),listSessionRecords(),listAgentSessionArchives()]); let preservedLive=0,preservedArchives=0; for(const row of live)if(await hasLiveReceipt(row))preservedLive++; for(const row of archives)if(await hasAgentSessionArchiveJevReceipt(row.name))preservedArchives++; return {model:DEFAULT_JEV_OPENROUTER_MODEL,credentialSource:"settings-ai/openrouter",openrouterConnected:Boolean(key),liveSessions:live.length,archives:archives.length,preservedLive,preservedArchives,pending:(live.length-preservedLive)+(archives.length-preservedArchives)}; }

export async function optimizeSessionPreservationBatch(input: { cursor?: number; limit?: number } = {}): Promise<JevPreservationBatch> {
  const all=await sources(),cursor=Math.max(0,Math.trunc(Number(input.cursor)||0)),limit=Math.max(1,Math.min(100,Math.trunc(Number(input.limit)||50))),slice=all.slice(cursor,cursor+limit); let processed=0,preserved=0,skipped=0,failed=0; const errors:string[]=[];
  for(const source of slice){
    processed++;
    try{
      let record: AgentSession;
      if(source.kind==="live"){
        const live=await readSessionFile(source.sessionId);
        if(!live){skipped++;continue;}
        record=live;
        if(await hasLiveReceipt(record)){skipped++;continue;}
      }else{
        if(await hasAgentSessionArchiveJevReceipt(source.archiveName)){skipped++;continue;}
        record=normalizeSession((await readAgentSessionArchive(source.archiveName)).session);
      }
      const view=sessionGraph(record,card(record),120),optimization=await optimizeSessionWithJev(view);
      if(optimization.provider!=="jev")throw new Error(optimization.fallbackReason||"JEV decision unavailable");
      if(source.kind==="live")await writeLiveReceipt(record,view,optimization);else{const archive=await readAgentSessionArchive(source.archiveName);await writeAgentSessionArchiveJevReceipt(source.archiveName,archive.sha256,{model:DEFAULT_JEV_OPENROUTER_MODEL,sessionId:record.id,sessionLabel:view.session.label,optimization:optimization.llmContext});}
      preserved++;
    }catch(cause){failed++;errors.push(`${source.key}: ${cause instanceof Error?cause.message:"JEV preservation failed"}`.slice(0,320));}
  }
  const next=cursor+slice.length;return{total:all.length,cursor,processed,preserved,skipped,failed,errors,...(next<all.length?{nextCursor:next}:{})};
}
