import { afterAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
const root=await fs.mkdtemp(path.join(os.tmpdir(),"mso-jev-preserve-"));
process.env.OS_AGENT_SESSIONS_DIR=path.join(root,"sessions");
process.env.OS_AGENT_MEMORY_DIR=path.join(root,"memory");
process.env.OS_AGENT_SESSION_ARCHIVE_DIR=path.join(root,"archives");
process.env.OS_AGENT_SESSION_PRESERVATION_DIR=path.join(root,"preservation");
vi.mock("@/lib/config/store",()=>({hostCredentialStore:()=>({getKey:vi.fn(async()=>"openrouter-key")})}));
vi.mock("@/lib/workflow/jev-session-optimizer",()=>({optimizeSessionWithJev:vi.fn(async(view:{session:{label:string}})=>({provider:"jev",source:{sessionLabel:view.session.label,observedAt:new Date().toISOString(),shownEvents:1,omittedEvents:0},recommendations:[],llmContext:{kind:"mso.jev-session-optimization.v1",instruction:"review",facts:["safe"],recommendations:[]}}))}));
vi.resetModules();
const store=await import("./session-store");
const preservation=await import("./session-jev-preservation");
afterAll(async()=>{for(const key of ["OS_AGENT_SESSIONS_DIR","OS_AGENT_MEMORY_DIR","OS_AGENT_SESSION_ARCHIVE_DIR","OS_AGENT_SESSION_PRESERVATION_DIR"])delete process.env[key];await fs.rm(root,{recursive:true,force:true});});
describe("JEV session preservation",()=>{
 it("preserves every live session once and reports zero pending",async()=>{
  await store.createAgentSession("principal:jev","cli",{title:"Preserve me"});
  const before=await preservation.jevPreservationStatus();expect(before).toMatchObject({openrouterConnected:true,liveSessions:1,preservedLive:0,pending:1});
  const batch=await preservation.optimizeSessionPreservationBatch({limit:6});expect(batch).toMatchObject({total:1,processed:1,preserved:1,failed:0});
  const after=await preservation.jevPreservationStatus();expect(after).toMatchObject({preservedLive:1,pending:0});
  const replay=await preservation.optimizeSessionPreservationBatch({limit:6});expect(replay).toMatchObject({processed:1,preserved:0,skipped:1,failed:0});
 });
});
