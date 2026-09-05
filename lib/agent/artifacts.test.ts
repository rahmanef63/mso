import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
const root=await fs.mkdtemp(path.join(os.tmpdir(),"mso-artifact-test-"));
process.env.OS_AGENT_SESSIONS_DIR=path.join(root,"sessions");
const {writeSessionFile,readSessionFile,principalHash}=await import("./session-files");
const {artifactPaths,artifactLocation,artifactRetentionDays,ARTIFACT_LIMITS}=await import("./artifact-paths");
const {prepareSessionArtifacts,ownedArtifactSession,sessionArtifactEnvironment}=await import("./artifact-session");
const {saveSessionArtifact,registerIncomingArtifact,readSessionArtifact,listSessionArtifacts}=await import("./artifacts");
const {pruneSessionArtifacts,cleanupSessionArtifacts}=await import("./artifact-cleanup");
const {readArtifactManifest,writeArtifactManifest}=await import("./artifact-manifest");
const {artifactMetadata}=await import("./artifact-policy");
const {agentSessionSummary}=await import("./session-store");
type Session=import("./session-types").AgentSession;
const principal="mcp-client:artifact-test",other="mcp-client:other-test";
const one={id:"20260905_120000_00000001",principalHash:principalHash(principal)},two={id:"20260905_120000_00000002",principalHash:principalHash(principal)},foreign={id:"20260905_120000_00000003",principalHash:principalHash(other)};
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZsAAAAASUVORK5CYII=","base64");
const meta={project:"portfolio",feature:"home",environment:"production",locale:"fr",width:390,height:844,producer:"playwright" as const,url:"https://visitor:private@example.com/fr?secret=drop#fragment"};
async function seed(owner=one,updatedAt=new Date().toISOString()) {
 const row={...owner,source:"mcp",name:"milo",title:"Artifact test",titleSource:"manual",createdAt:updatedAt,updatedAt,history:[],events:[],memorySnapshot:{},estimatedTokens:0,lifetimeEstimatedTokens:0,compactThresholdTokens:700000,compactionCount:0,archiveCount:0} as unknown as Session;
 await writeSessionFile(row);return row;
}
beforeAll(async()=>{await seed();await seed(two);await seed(foreign);});
beforeEach(async()=>{await fs.rm(artifactPaths(one).temp,{recursive:true,force:true});});
afterAll(async()=>{delete process.env.OS_AGENT_SESSIONS_DIR;delete process.env.OS_AGENT_ARTIFACT_RETENTION_DAYS;await fs.rm(root,{recursive:true,force:true});});
describe("session artifact storage",()=>{
 it("derives paths from configured user root with distinct principal/session boundaries",()=>{
  expect(artifactLocation(one).directory).toContain(path.join(root,"sessions","temp",one.principalHash,one.id));
  expect(artifactPaths(one).directory).not.toBe(artifactPaths(two).directory);expect(artifactPaths(one).principal).not.toBe(artifactPaths(foreign).principal);
  expect(()=>artifactPaths({...one,id:"../../escape"})).toThrow();
 });
 it("validates authenticated ownership",async()=>{expect(await ownedArtifactSession(principal,one.id)).toEqual(one);await expect(ownedArtifactSession(other,one.id)).rejects.toThrow();await expect(ownedArtifactSession(undefined,one.id)).rejects.toThrow();});
 it("provides non-secret session env and derived summary locations",async()=>{
  const env=await sessionArtifactEnvironment({principal,sessionId:one.id});expect(env.MSO_SCREENSHOT_DIR).toBe(artifactPaths(one).incoming);expect(Object.keys(env)).toHaveLength(4);
  expect(agentSessionSummary((await readSessionFile(one.id))!).artifacts?.manifestPath).toBe(artifactPaths(one).manifest);
  expect(await sessionArtifactEnvironment({})).toEqual({});
 });
 it("saves descriptive immutable names, private mode, relative manifest and matching hashes",async()=>{
  const a=await saveSessionArtifact(one,png,meta);expect(a.filename).toMatch(/^mso__portfolio__home__production__fr__390x844__/);expect(a.url).toBe("https://example.com/fr");
  const read=await readSessionArtifact(one,a.id);expect(read.bytes.equals(png)).toBe(true);expect((await fs.stat(read.path)).mode&0o777).toBe(0o600);
  const listing=await listSessionArtifacts(one);expect(listing.total).toBe(1);expect(listing.artifacts[0].path).toBe(read.path);
  const text=await fs.readFile(artifactPaths(one).manifest,"utf8");expect(text).not.toContain(root);expect(text).not.toContain("secret=drop");
  await expect(readSessionArtifact(two,a.id)).rejects.toThrow();
 });
 it("deduplicates an identical registration retry",async()=>{const a=await saveSessionArtifact(one,png,meta);const b=await saveSessionArtifact(one,png,meta);expect(a.id).toBe(b.id);expect((await listSessionArtifacts(one)).total).toBe(1);});
 it("serializes concurrent writes without lost entries",async()=>{
  await Promise.all(Array.from({length:8},(_,i)=>saveSessionArtifact(one,png,{...meta,feature:`state-${i}`})));
  expect((await listSessionArtifacts(one)).total).toBe(8);
 });
 it("registers only private staged basenames and rejects traversal, public permissions, symlinks and hardlinks",async()=>{
  await prepareSessionArtifacts(one);const p=artifactPaths(one),staged=path.join(p.incoming,"home.png");await fs.writeFile(staged,png,{mode:0o600});
  expect((await registerIncomingArtifact(one,"home.png",meta)).kind).toBe("screenshot");
  for(const source of ["../home.png","/tmp/home.png","other/home.png","bad.html"])await expect(registerIncomingArtifact(one,source,meta)).rejects.toThrow();
  await fs.writeFile(path.join(p.incoming,"public.png"),png,{mode:0o644});await fs.chmod(path.join(p.incoming,"public.png"),0o644);await expect(registerIncomingArtifact(one,"public.png",meta)).rejects.toThrow();
  await fs.symlink(staged,path.join(p.incoming,"link.png"));await expect(registerIncomingArtifact(one,"link.png",meta)).rejects.toThrow();
  await fs.link(staged,path.join(p.incoming,"hard.png"));await expect(registerIncomingArtifact(one,"hard.png",meta)).rejects.toThrow();
 });
 it("refuses a symlinked temp directory without touching its target",async()=>{
  const outside=path.join(root,"outside");await fs.mkdir(outside,{mode:0o700});await fs.symlink(outside,artifactPaths(one).temp);
  await expect(prepareSessionArtifacts(one)).rejects.toThrow(/symlink/);expect(await fs.readdir(outside)).toEqual([]);
 });
 it("fails closed for corruption, changed bytes, executable content and excessive sizes",async()=>{
  await expect(saveSessionArtifact(one,Buffer.from("<html>not an image</html>"),meta)).rejects.toThrow();
  await expect(saveSessionArtifact(one,Buffer.alloc(ARTIFACT_LIMITS.fileBytes+1),meta)).rejects.toThrow();
  const a=await saveSessionArtifact(one,png,meta),p=artifactPaths(one);await fs.writeFile(path.join(p.directory,a.relativePath),Buffer.from("changed"));await expect(readSessionArtifact(one,a.id)).rejects.toThrow(/checksum/);
  await fs.writeFile(p.manifest,"not-json");await expect(listSessionArtifacts(one)).rejects.toThrow();
 });
 it("enforces count and byte quotas before persisting more data",async()=>{
  await prepareSessionArtifacts(one);const m=await readArtifactManifest(one);const a=await saveSessionArtifact(one,png,meta);
  m.artifacts=Array.from({length:200},(_,i)=>({...a,id:"shot_"+i.toString(16).padStart(24,"0")}));await writeArtifactManifest(one,m);
  await expect(saveSessionArtifact(one,png,{...meta,feature:"quota-extra"})).rejects.toThrow(/quota/);
 });
 it("accepts JSON evidence but rejects credential-shaped text",async()=>{
  expect((await saveSessionArtifact(one,Buffer.from('{"checks":5,"errors":[]}'),{...meta,feature:"report"})).mimeType).toBe("application/json");
  await expect(saveSessionArtifact(one,Buffer.from('{"password":"do-not-store"}'),meta)).rejects.toThrow(/credential/);
 });
 it("bounds configurable retention and sanitizes labels/URLs",()=>{
  process.env.OS_AGENT_ARTIFACT_RETENTION_DAYS="900";expect(artifactRetentionDays()).toBe(30);process.env.OS_AGENT_ARTIFACT_RETENTION_DAYS="NaN";expect(artifactRetentionDays()).toBe(7);delete process.env.OS_AGENT_ARTIFACT_RETENTION_DAYS;
  expect(artifactMetadata({...meta,project:"../a b"}).project).toBe("a-b");expect(()=>artifactMetadata({...meta,url:"file:///etc/passwd"})).toThrow();
 });
});
describe("bounded artifact retention",()=>{
 it("preserves live/leased files and defaults to a dry-run",async()=>{
  await prepareSessionArtifacts(one);await saveSessionArtifact(one,png,meta);expect((await pruneSessionArtifacts(one)).state).toBe("active");
  const future=Date.now()+9*86400000;expect((await pruneSessionArtifacts(one,true,future)).state).toBe("would-remove");expect((await listSessionArtifacts(one)).total).toBe(1);
  expect((await pruneSessionArtifacts(one,false,future)).state).toBe("removed");expect(await readSessionFile(one.id)).not.toBeNull();
 });
 it("never follows foreign files during cleanup and never removes another principal's session",async()=>{
  await prepareSessionArtifacts(one);await saveSessionArtifact(one,png,meta);const p=artifactPaths(one);await fs.writeFile(path.join(p.directory,"unknown.txt"),"preserve",{mode:0o600});
  expect((await pruneSessionArtifacts(one,false,Date.now()+9*86400000)).state).toBe("unknown-files");
  const report=await cleanupSessionArtifacts({principal:other,dryRun:false});expect(report.results.some(r=>r.sessionId===one.id)).toBe(false);
 });
});
