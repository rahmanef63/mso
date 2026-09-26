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
import { listSessionIds, listSessionRecords, normalizeSession, readSessionFile } from "./session-files";
import type { AgentSession } from "./session-types";
import { agentSessionPreservationRoot, hasAgentSessionArchiveJevReceipt, listAgentSessionArchives, readAgentSessionArchive, writeAgentSessionArchiveJevReceipt } from "./session-archive";

export type JevPreservationStatus = { model: string; credentialSource: "settings-ai/openrouter"; openrouterConnected: boolean; liveSessions: number; archives: number; preservedLive: number; preservedArchives: number; pending: number };
export type JevPreservationBatch = { total: number; cursor: number; nextCursor?: number; processed: number; preserved: number; skipped: number; failed: number; errors: string[] };

type Source = { kind: "live"; key: string; sessionId: string } | { kind: "archive"; key: string; archiveName: string };

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function liveReceiptName(record: AgentSession): string { return `live-${record.id}-${hash(record.updatedAt).slice(0, 16)}.jev.json`; }
async function root(): Promise<string> { const dir=agentSessionPreservationRoot(); await fs.mkdir(dir,{recursive:true,mode:0o700}); await fs.chmod(dir,0o700).catch(()=>undefined); return dir; }
async function hasLiveReceipt(record: AgentSession): Promise<boolean> { try { const raw=JSON.parse(await fs.readFile(path.join(await root(),liveReceiptName(record)),"utf8")) as Record<string,unknown>; return raw.schemaVersion===1&&raw.kind==="mso.jev-session-preservation.v1"&&raw.provider==="jev"&&raw.sessionId===record.id&&raw.updatedAt===record.updatedAt; } catch { return false; } }
async function writeLiveReceipt(record: AgentSession, optimization: Awaited<ReturnType<typeof optimizeSessionWithJev>>): Promise<void> { const dir=await root(),file=path.join(dir,liveReceiptName(record)),tmp=`${file}.${randomUUID()}.tmp`; const body=JSON.stringify(redactUnknown({schemaVersion:1,kind:"mso.jev-session-preservation.v1",provider:"jev",model:DEFAULT_JEV_OPENROUTER_MODEL,sessionId:record.id,sessionLabel:agentSessionLabel(record.name,record.title,record.cwd),updatedAt:record.updatedAt,preservedAt:new Date().toISOString(),optimization:optimization.llmContext}),null,2); await fs.writeFile(tmp,body,{encoding:"utf8",mode:0o600,flag:"wx"}); await fs.chmod(tmp,0o600); await fs.rename(tmp,file); await fs.chmod(file,0o600); }

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
      if(source.kind==="live")await writeLiveReceipt(record,optimization);else{const archive=await readAgentSessionArchive(source.archiveName);await writeAgentSessionArchiveJevReceipt(source.archiveName,archive.sha256,{model:DEFAULT_JEV_OPENROUTER_MODEL,sessionId:record.id,sessionLabel:view.session.label,optimization:optimization.llmContext});}
      preserved++;
    }catch(cause){failed++;errors.push(`${source.key}: ${cause instanceof Error?cause.message:"JEV preservation failed"}`.slice(0,320));}
  }
  const next=cursor+slice.length;return{total:all.length,cursor,processed,preserved,skipped,failed,errors,...(next<all.length?{nextCursor:next}:{})};
}
