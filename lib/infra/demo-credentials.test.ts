import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {constants,promises as fs} from "node:fs";
import os from "node:os";
import path from "node:path";
import type {DemoCredentialSummary} from "./demo-credentials";
// `integrationManage` returns the union of every action's result; these tests know which one they called.
type DemoList={demoUsers:DemoCredentialSummary[]};
vi.mock("server-only",()=>({}));
// Live authorization is exercised for real in the route; here we assert this layer refuses when it says no.
const liveAuth=vi.hoisted(()=>({allowed:true}));
vi.mock("@/lib/auth/live-authorization",()=>({liveSessionAuthorized:async()=>liveAuth.allowed}));
const session=vi.hoisted(()=>({role:"owner" as string|null,device:"test-device"}));
vi.mock("@/lib/auth/require-session",()=>({getSessionContext:async()=>session.role?{role:session.role,session:{device_id:session.device}}:null}));
const DEMO_PASSWORD="not-a-real-password-123",OTHER_PASSWORD="also-not-real-password-456",EMAIL="demo@example.test";
let root:string,storeFile:string;

beforeEach(async()=>{
  liveAuth.allowed=true;root=await fs.mkdtemp(path.join(os.tmpdir(),"mso-demo-credentials-"));
  // The demo store is a sibling of the infra store inside this private sandbox.
  process.env.OS_INFRA_STORE=path.join(root,"infra.json");storeFile=path.join(root,"demo-credentials.json");
  process.env.OS_AUDIT_LOG=path.join(root,"audit.log");vi.resetModules();
});
afterEach(async()=>{
  delete process.env.OS_INFRA_STORE;delete process.env.OS_AUDIT_LOG;await fs.rm(root,{recursive:true,force:true});vi.resetModules();
});

/** One folder binding per owner is the only workspace source: no free-form workspace. */
async function fixture(){
  const {integrationManage:manage}=await import("./connection-manage");
  await manage({action:"user.create",user:"alice",confirm:true});
  await manage({action:"user.create",user:"bob",confirm:true});
  const aliceDir=path.join(root,"project-alice"),bobDir=path.join(root,"project-bob");
  await fs.mkdir(aliceDir,{recursive:true});await fs.mkdir(bobDir,{recursive:true});
  await manage({action:"folder.map",user:"alice",path:aliceDir,confirm:true});
  await manage({action:"folder.map",user:"bob",path:bobDir,confirm:true});
  return{manage,aliceDir,bobDir};
}

it("creates, lists, reads, updates and deletes a demo login, bumping revision",async()=>{
  const f=await fixture(),demo=await import("./demo-credentials");
  const created=await f.manage({action:"demo.create",confirm:true,cwd:f.aliceDir,email:EMAIL,password:DEMO_PASSWORD,label:"Checkout smoke",site:"https://shop.example.test"}) as unknown as DemoCredentialSummary;
  expect(created).toMatchObject({email:EMAIL,label:"Checkout smoke",hasPassword:true,revision:1});
  expect(JSON.stringify(created)).not.toContain(DEMO_PASSWORD);

  const full=await demo.getDemoCredential({cwd:f.aliceDir,id:created.id});
  expect(full.password).toBe(DEMO_PASSWORD);expect(full.owner).toBe("alice");

  const listed=await f.manage({action:"demo.list",cwd:f.aliceDir}) as unknown as DemoList;
  expect(listed.demoUsers).toHaveLength(1);
  expect(JSON.stringify(listed)).not.toContain(DEMO_PASSWORD);

  const updated=await f.manage({action:"demo.update",confirm:true,cwd:f.aliceDir,id:created.id,password:OTHER_PASSWORD,notes:"rotated"}) as unknown as DemoCredentialSummary;
  expect(updated.revision).toBe(2);expect(updated.notes).toBe("rotated");
  expect((await demo.getDemoCredential({cwd:f.aliceDir,id:created.id})).password).toBe(OTHER_PASSWORD);

  await f.manage({action:"demo.delete",confirm:true,cwd:f.aliceDir,id:created.id});
  expect(((await f.manage({action:"demo.list",cwd:f.aliceDir})) as unknown as DemoList).demoUsers).toHaveLength(0);
  await expect(demo.getDemoCredential({cwd:f.aliceDir,id:created.id})).rejects.toMatchObject({code:"demo_credential_not_found"});
});

it("rejects duplicate emails, bad input, and a cwd with no folder binding",async()=>{
  const f=await fixture(),demo=await import("./demo-credentials");
  await f.manage({action:"demo.create",confirm:true,cwd:f.aliceDir,email:EMAIL,password:DEMO_PASSWORD});
  await expect(f.manage({action:"demo.create",confirm:true,cwd:f.aliceDir,email:EMAIL,password:DEMO_PASSWORD})).rejects.toMatchObject({code:"demo_credential_exists"});
  await expect(f.manage({action:"demo.create",confirm:true,cwd:f.aliceDir,email:"not-an-email",password:DEMO_PASSWORD})).rejects.toMatchObject({code:"invalid_demo_email"});
  await expect(f.manage({action:"demo.create",confirm:true,cwd:f.aliceDir,email:"two words@example.test",password:DEMO_PASSWORD})).rejects.toMatchObject({code:"invalid_demo_email"});
  await expect(f.manage({action:"demo.create",confirm:true,cwd:f.aliceDir,email:"bad@e.test",password:"has\nnewline"})).rejects.toMatchObject({code:"invalid_demo_password"});
  await expect(f.manage({action:"demo.create",confirm:true,cwd:f.aliceDir,email:"bad@e.test",password:"nul\u0000inside"})).rejects.toMatchObject({code:"invalid_demo_password"});
  const unbound=path.join(root,"unbound-project");await fs.mkdir(unbound,{recursive:true});
  await expect(f.manage({action:"demo.list",cwd:unbound})).rejects.toMatchObject({code:"workspace_folder_not_bound"});
  await expect(demo.listDemoCredentials({})).rejects.toMatchObject({code:"workspace_cwd_required"});
});

it("never lists, reads, updates or deletes owner A's demo login as owner B",async()=>{
  const f=await fixture(),demo=await import("./demo-credentials");
  const created=await f.manage({action:"demo.create",confirm:true,cwd:f.aliceDir,email:EMAIL,password:DEMO_PASSWORD}) as unknown as DemoCredentialSummary;
  expect(((await f.manage({action:"demo.list",cwd:f.bobDir})) as unknown as DemoList).demoUsers).toHaveLength(0);
  for(const call of[
    ()=>demo.getDemoCredential({cwd:f.bobDir,id:created.id}),
    ()=>f.manage({action:"demo.update",confirm:true,cwd:f.bobDir,id:created.id,password:OTHER_PASSWORD}),
    ()=>f.manage({action:"demo.delete",confirm:true,cwd:f.bobDir,id:created.id}),
  ])await expect(call()).rejects.toMatchObject({code:"demo_credential_not_found"});
  // Still intact for the real owner and unchanged by B's attempts.
  expect((await demo.getDemoCredential({cwd:f.aliceDir,id:created.id})).password).toBe(DEMO_PASSWORD);
});

it("stores the file 0600 inside a 0700 directory, read through one handle",async()=>{
  const f=await fixture();await f.manage({action:"demo.create",confirm:true,cwd:f.aliceDir,email:EMAIL,password:DEMO_PASSWORD});
  // ONE handle for mode and content: stat-then-read on a path is js/file-system-race.
  const handle=await fs.open(storeFile,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const stat=await handle.stat(),raw=await handle.readFile("utf8");expect(stat.mode&0o777).toBe(0o600);expect(raw).toContain(EMAIL);}finally{await handle.close();}
  expect((await fs.stat(root)).mode&0o777).toBe(0o700);
});

it("refuses a symlinked store instead of following it",async()=>{
  const f=await fixture(),demo=await import("./demo-credentials"),outside=path.join(root,"outside.json");
  await fs.writeFile(outside,JSON.stringify({version:1,records:[]}),{mode:0o600});
  await fs.symlink(outside,storeFile);
  await expect(demo.listDemoCredentials({cwd:f.aliceDir})).rejects.toMatchObject({code:"invalid_or_unsafe_demo_store"});
});

it("refuses a secret-shaped key on the generic management actions",async()=>{
  const f=await fixture();
  // Only the demo.* actions accept a password; every other action keeps metadataOnly.
  await expect(f.manage({action:"user.create",confirm:true,user:"carol",password:DEMO_PASSWORD})).rejects.toMatchObject({code:"secret_input_forbidden"});
  await expect(f.manage({action:"connection.create",confirm:true,user:"alice",provider:"cloudflare",connection:"dns",password:DEMO_PASSWORD})).rejects.toMatchObject({code:"secret_input_forbidden"});
});

const A_KEY="synthetic_cloudflare_token_alice_0123456789",B_KEY="synthetic_cloudflare_token_bob_0123456789";
/** A direct connection with one secret field and one non-secret field. */
async function withCredentials(){
  const f=await fixture(),service=await import("./connection-service");
  for(const [user,key]of[["alice",A_KEY],["bob",B_KEY]]as const){
    await f.manage({action:"connection.create",confirm:true,user,provider:"cloudflare",connection:"dns",authMethod:"direct"});
    const snap=await service.credentialSnapshot("cloudflare",{user,connection:"dns"});
    await service.saveConnectionValues("cloudflare",{user,connection:"dns"},{apiToken:key,zoneId:"0123456789abcdef0123456789abcdef"},snap.connection);
  }
  return{...f,service};
}
const actorFor=(deviceId="test-device")=>({session:{device_id:deviceId} as never,role:"owner" as const,deviceId});

it("reveals only the requested secret field for its owner",async()=>{
  const f=await withCredentials(),demo=await import("./demo-credentials");void f;
  const out=await demo.revealSecret({user:"alice",provider:"cloudflare",connection:"dns",key:"apiToken"},actorFor());
  expect(out).toEqual({key:"apiToken",value:A_KEY});
  const audited=await import("@/lib/host/audit");await audited.audit({action:"infra.write"}); // flush chain
  const trail=await (await import("@/lib/host/audit-api")).readAuditTail({prefix:"infra.write"});
  expect(trail.some(row=>row.ok===true&&row.detail?.includes("secret-reveal"))).toBe(true);
  expect(JSON.stringify(trail)).not.toContain(A_KEY);
});

it("refuses a non-secret or unknown field, another owner, and a shared alias",async()=>{
  const f=await withCredentials(),demo=await import("./demo-credentials");
  // zoneId is not secret:true, and "nope" does not exist; both look identical.
  await expect(demo.revealSecret({user:"alice",provider:"cloudflare",connection:"dns",key:"zoneId"},actorFor())).rejects.toMatchObject({code:"secret_field_not_revealable",status:404});
  await expect(demo.revealSecret({user:"alice",provider:"cloudflare",connection:"dns",key:"nope"},actorFor())).rejects.toMatchObject({code:"secret_field_not_revealable",status:404});
  await f.manage({action:"connection.create",confirm:true,user:"alice",provider:"cloudflare",connection:"alice-only",authMethod:"direct"});
  // bob's own connection is "dns"; "alice-only" exists only for alice, so bob cannot
  // address it and the refusal is the same generic one as an unknown field.
  await expect(demo.revealSecret({user:"bob",provider:"cloudflare",connection:"alice-only",key:"apiToken"},actorFor())).rejects.toMatchObject({code:"secret_field_not_revealable"});
  await f.manage({action:"connection.share",confirm:true,user:"alice",provider:"cloudflare",connection:"dns",target:"bob",label:"shared"});
  const alias=(await f.service.integrationSnapshot({user:"bob"})).connections.find(c=>c.sharedFrom);
  await expect(demo.revealSecret({user:"bob",provider:"cloudflare",connection:alias!.id,key:"apiToken"},actorFor())).rejects.toMatchObject({code:"shared_alias_readonly",status:409});
});

it("audits every refusal and trips the per-device rate limit",async()=>{
  const f=await withCredentials(),demo=await import("./demo-credentials"),auditApi=await import("@/lib/host/audit-api");void f;
  for(let i=0;i<3;i++)await expect(demo.revealSecret({user:"alice",provider:"cloudflare",connection:"dns",key:"zoneId"},actorFor("device-refuse"))).rejects.toMatchObject({code:"secret_field_not_revealable"});
  const refusals=(await auditApi.readAuditTail({prefix:"infra.write"})).filter(row=>row.actor==="device-refuse"&&row.ok===false);
  expect(refusals.length).toBeGreaterThanOrEqual(3);
  // 5 reads per 60s per device+connection, refusals included.
  let limited=false;
  for(let i=0;i<6;i++){try{await demo.revealSecret({user:"alice",provider:"cloudflare",connection:"dns",key:"apiToken"},actorFor("device-limit"));}catch(e){limited=(e as {code?:string}).code==="rate_limited";break}}
  expect(limited).toBe(true);
});

it("keeps connectionSummary free of stored values",async()=>{
  const f=await withCredentials(),{connectionSummary}=await import("./connection-registry"),{readIntegrationState}=await import("./connection-storage");
  const state=await readIntegrationState(),connection=state.users.alice.connections.cloudflare.dns;
  const summary=connectionSummary("alice",connection);
  const text=JSON.stringify(summary);
  expect(text).not.toContain(A_KEY);expect(text).not.toContain("0123456789abcdef0123456789abcdef");
  expect(summary.fields.every(field=>!Object.hasOwn(field,"value"))).toBe(true);
  expect(summary.fields.find(field=>field.key==="apiToken")?.stored).toBe(true);
  // A full snapshot is the many-path summary surface: it must not carry the value either.
  expect(JSON.stringify(await f.service.integrationSnapshot({user:"alice"}))).not.toContain(A_KEY);
});

it("reveals a demo password and nothing else from the demo record",async()=>{
  const f=await fixture(),demo=await import("./demo-credentials");
  const created=await f.manage({action:"demo.create",confirm:true,cwd:f.aliceDir,email:EMAIL,password:DEMO_PASSWORD}) as unknown as DemoCredentialSummary;
  expect(await demo.revealSecret({cwd:f.aliceDir,demoId:created.id,key:"password"},actorFor())).toEqual({key:"password",value:DEMO_PASSWORD});
  await expect(demo.revealSecret({cwd:f.aliceDir,demoId:created.id,key:"email"},actorFor())).rejects.toMatchObject({code:"secret_field_not_revealable"});
  await expect(demo.revealSecret({cwd:f.bobDir,demoId:created.id,key:"password"},actorFor())).rejects.toMatchObject({code:"secret_field_not_revealable"});
});

it("is reachable from the agent-side dispatch, and only demo.* bypasses metadataOnly",async()=>{
  const f=await fixture(),dispatch=await import("./connection-dispatch");
  const created=await dispatch.executeIntegrationAction({operation:"demo.create",confirm:true,arguments:{cwd:f.aliceDir,email:EMAIL,password:DEMO_PASSWORD}}) as unknown as DemoCredentialSummary;
  expect(created.hasPassword).toBe(true);
  expect(JSON.stringify(await dispatch.executeIntegrationAction({operation:"demo.list",arguments:{cwd:f.aliceDir}}))).not.toContain(DEMO_PASSWORD);
  const full=await dispatch.executeIntegrationAction({operation:"demo.get",arguments:{cwd:f.aliceDir,id:created.id}}) as unknown as {password:string};
  expect(full.password).toBe(DEMO_PASSWORD);
  // The human reveal operation is not an agent operation.
  await expect(dispatch.executeIntegrationAction({operation:"secret.reveal",arguments:{key:"password"}})).rejects.toThrow();
  // A non-demo action still refuses secret-shaped input on both paths.
  await expect(dispatch.executeIntegrationAction({operation:"verify",password:DEMO_PASSWORD,user:"alice",provider:"cloudflare",connection:"dns"})).rejects.toMatchObject({code:"secret_input_forbidden"});
  await expect(dispatch.manageIntegrationAction({action:"demo.create",cwd:f.aliceDir,email:"x@example.test",password:DEMO_PASSWORD})).rejects.toMatchObject({code:"confirmation_required"});
  // Arguments can never override the dispatched operation or the confirmation gate.
  await expect(dispatch.executeIntegrationAction({operation:"demo.create",arguments:{action:"demo.get",confirm:true,cwd:f.aliceDir,id:created.id}})).rejects.toMatchObject({code:"invalid_management_fields"});
});

it("serves a reveal only to a live Owner session, private no-store, body {key,value} only",async()=>{
  const f=await withCredentials(),{POST}=await import("@/app/api/v1/integrations/route"),{NextRequest}=await import("next/server");
  const request=(body:unknown)=>new NextRequest("https://mso.example.test/api/v1/integrations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"reveal",...body as object})});
  const ok=await POST(request({user:"alice",provider:"cloudflare",connection:"dns",key:"apiToken"}));
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({key:"apiToken",value:A_KEY});
  expect(ok.headers.get("cache-control")).toBe("private, no-store");
  expect(ok.headers.get("pragma")).toBe("no-cache");
  // A refusal is the same shape and never mentions the value.
  const refused=await POST(request({user:"alice",provider:"cloudflare",connection:"dns",key:"zoneId"}));
  expect(refused.status).toBe(404);
  const refusedBody=await refused.json();expect(refusedBody).toEqual({error:"secret_field_not_revealable"});
  expect(refused.headers.get("cache-control")).toBe("private, no-store");
  expect(JSON.stringify(refusedBody)).not.toContain(A_KEY);
  // Live authorization withdrawn (revocation, scope/epoch change) fails closed.
  liveAuth.allowed=false;
  expect((await POST(request({user:"alice",provider:"cloudflare",connection:"dns",key:"apiToken"}))).status).toBe(403);
  liveAuth.allowed=true;
  expect(f.manage).toBeTypeOf("function");
});
