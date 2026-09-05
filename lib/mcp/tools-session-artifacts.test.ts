import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
const root=await fs.mkdtemp(path.join(os.tmpdir(),"mso-artifact-tools-"));
process.env.OS_AGENT_SESSIONS_DIR=path.join(root,"sessions");
const {writeSessionFile,principalHash}=await import("@/lib/agent/session-files");
const {prepareSessionArtifacts}=await import("@/lib/agent/artifact-session");
const {artifactPaths}=await import("@/lib/agent/artifact-paths");
const {SESSION_ARTIFACT_TOOLS}=await import("./tools-session-artifacts");
const sessionId="20260905_123000_ffffffff",principal="mcp-client:artifact-tools";
const owner={id:sessionId,principalHash:principalHash(principal)};
const context={principal,sessionId,scope:"write" as const};
const get=(name:string)=>SESSION_ARTIFACT_TOOLS.find(t=>t.name===name)!;
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZsAAAAASUVORK5CYII=","base64");
beforeAll(async()=>{
 const now=new Date().toISOString();
 await writeSessionFile({...owner,source:"mcp",name:"milo",title:"Artifact tools",titleSource:"manual",createdAt:now,updatedAt:now,history:[],events:[],estimatedTokens:0,lifetimeEstimatedTokens:0,compactThresholdTokens:700000,compactionCount:0,archiveCount:0,memorySnapshot:{}} as unknown as import("@/lib/agent/session-types").AgentSession);
 await prepareSessionArtifacts(owner);await fs.writeFile(path.join(artifactPaths(owner).incoming,"home.png"),png,{mode:0o600});
});
afterAll(async()=>{delete process.env.OS_AGENT_SESSIONS_DIR;await fs.rm(root,{recursive:true,force:true});});
describe("native session artifact tools",()=>{
 it("batch registration reports partial failures without losing successful entries",async()=>{
  const result=await get("session_artifact_register").run({project:"portfolio",producer:"playwright",environment:"production",files:[{source:"home.png",feature:"home"},{source:"../foreign.png",feature:"invalid"}]},context) as {saved:number;results:Array<{ok:boolean}>};
  expect(result.saved).toBe(1);expect(result.results.map(r=>r.ok)).toEqual([true,false]);
 });
 it("reads stored screenshot through direct MCP image content",async()=>{
  const list=await get("session_artifacts").run({},context) as {artifacts:Array<{id:string}>};expect(list.artifacts).toHaveLength(1);
  const read=await get("session_artifacts").run({artifact_id:list.artifacts[0].id},context) as {__mcpDirect:boolean;content:Array<{type:string;data?:string}>};
  expect(read.__mcpDirect).toBe(true);expect(read.content[0]).toMatchObject({type:"image",data:png.toString("base64")});
 });
 it("rejects another principal, an absent session and filesystem path guesses",async()=>{
  await expect(get("session_artifacts").run({}, {...context,principal:"foreign-client"})).rejects.toThrow();
  await expect(get("session_artifacts").run({artifact_id:"../../file"},context)).rejects.toThrow();
  await expect(get("session_artifacts").run({}, {scope:"read"})).rejects.toThrow();
 });
 it("keeps read and write capabilities distinct and cleanup defaults to dry-run",async()=>{
  expect(get("session_artifacts").scope).toBe("read");expect(get("session_artifact_register").scope).toBe("write");expect(get("session_artifacts_cleanup").scope).toBe("write");
  const result=await get("session_artifacts_cleanup").run({},context) as {dryRun:boolean;results:Array<{sessionId:string}>};expect(result.dryRun).toBe(true);expect(result.results.some(r=>r.sessionId===sessionId)).toBe(false);
 });
});
