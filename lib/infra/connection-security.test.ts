import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {promises as fs} from "node:fs";
import os from "node:os";
import path from "node:path";
vi.mock("server-only",()=>({}));
let root:string;
const A="synthetic_secret_alice_project_key",B="synthetic_secret_bob_project_key";
beforeEach(async()=>{root=await fs.mkdtemp(path.join(os.tmpdir(),"mso-identity-security-"));process.env.OS_INFRA_STORE=path.join(root,"infra.json");vi.resetModules();});
afterEach(async()=>{vi.unstubAllGlobals();delete process.env.OS_INFRA_STORE;await fs.rm(root,{recursive:true,force:true});vi.resetModules();});
async function fixture(){
  const {integrationManage:manage}=await import("./connection-manage"),service=await import("./connection-service"),external=await import("./connection-external");
  for(const [user,key]of [["alice",A],["bob",B]]){
    await manage({action:"user.create",user,confirm:true});await manage({action:"connection.create",user,provider:"composio",connection:"broker",source:"direct",authMethod:"project",confirm:true});
    const snap=await service.credentialSnapshot("composio",{user,connection:"broker"});await service.saveConnectionValues("composio",{user,connection:"broker"},{apiKey:key},snap.connection);
    await manage({action:"connection.create",user,provider:"github",connection:"work",source:"composio",authMethod:"oauth2",confirm:true});
  }
  return{manage,...service,...external};
}
it("binds Composio authorization to this user's broker and installation-scoped remote identity",async()=>{
  const f=await fixture(),calls:Array<{url:string;headers:Headers;body:Record<string,unknown>|null}>=[];let remoteUser="";
  vi.stubGlobal("fetch",vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
    const req=new Request(url,init),body=req.method==="POST"?await req.json():null;calls.push({url:req.url,headers:req.headers,body});
    if(req.url.includes("/auth_configs/"))return new Response(JSON.stringify({id:"ac_1",toolkit:{slug:"github"},auth_scheme:"OAUTH2",status:"ENABLED"}));
    if(req.url.endsWith("/connected_accounts/link")){remoteUser=body.user_id;return new Response(JSON.stringify({connected_account_id:"ca_alice",redirect_url:"https://connect.composio.dev/link/test",link_token:"must-not-persist"}));}
    if(req.url.endsWith("/connected_accounts/ca_alice"))return new Response(JSON.stringify({id:"ca_alice",toolkit:{slug:"github"},auth_config:{id:"ac_1"},user_id:remoteUser,status:"ACTIVE",state:{access_token:"must-not-persist"}}));
    if(req.url.includes("/tools/execute/"))return new Response(JSON.stringify({data:{ok:true,access_token:"must-not-persist",echo:A}}));
    return new Response("{}",{status:404});
  }));
  const linked=await f.authorizeIntegration("github",{user:"alice",connection:"work"},{authConfigId:"ac_1",brokerConnection:"broker"});expect(linked.privateUrl).toContain("https://connect.composio.dev/");
  expect(remoteUser).toMatch(/^mso:[a-f0-9-]+:[a-f0-9-]+$/);expect(remoteUser).not.toContain("alice");
  const verified=await f.verifyExternalIntegration("github",{user:"alice",connection:"work"});expect(verified.ok).toBe(true);
  const output=await f.composioConnectionCall("github",{user:"alice",connection:"work"},"GITHUB_GET_THE_AUTHENTICATED_USER",{});expect(JSON.stringify(output)).not.toContain(A);expect(JSON.stringify(output)).not.toContain("must-not-persist");
  for(const c of calls)expect(c.headers.get("x-api-key")).toBe(A);expect(calls.find(c=>c.url.includes("/tools/execute/"))?.body?.connected_account_id).toBe("ca_alice");
  const stored=await fs.readFile(process.env.OS_INFRA_STORE!,"utf8");expect(stored).not.toContain("must-not-persist");expect(stored).not.toContain("https://connect.composio.dev/link/test");
  await expect(f.composioConnectionCall("github",{user:"bob",connection:"work"},"GITHUB_GET_THE_AUTHENTICATED_USER",{})).rejects.toMatchObject({code:"active_connected_account_required"});
});
it("reserves a connection during hosted auth and refuses concurrent authorization or credential rotation",async()=>{
  const f=await fixture();let release!:()=>void,entered!:()=>void;const reached=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);
  vi.stubGlobal("fetch",vi.fn(async(url:RequestInfo|URL)=>{
    if(String(url).includes("/auth_configs/")){entered();await wait;return new Response(JSON.stringify({id:"ac_1",toolkit:{slug:"github"},auth_scheme:"OAUTH2"}));}
    return new Response(JSON.stringify({connected_account_id:"ca_1",redirect_url:"https://connect.composio.dev/link/test"}));
  }));
  const first=f.authorizeIntegration("github",{user:"alice",connection:"work"},{authConfigId:"ac_1"});await reached;
  await expect(f.authorizeIntegration("github",{user:"alice",connection:"work"},{authConfigId:"ac_1"})).rejects.toMatchObject({code:"connection_busy"});
  await expect(f.manage({action:"connection.delete",user:"alice",provider:"github",connection:"work",confirm:true})).rejects.toMatchObject({code:"connection_busy"});
  const snap=await f.credentialSnapshot("composio",{user:"alice",connection:"broker"});await expect(f.saveConnectionValues("composio",{user:"alice",connection:"broker"},{apiKey:B},snap.connection)).rejects.toMatchObject({code:"connection_busy"});
  release();await first;expect((await f.credentialSnapshot("composio",{user:"alice",connection:"broker"})).connection.lease).toBeUndefined();
});
it("invalidates an open form after rotation or delete/recreate, without touching another named connection",async()=>{
  const f=await fixture();const setup=await import("./setup-capability");vi.stubGlobal("fetch",vi.fn(async()=>new Response("{}")));
  const grant=await setup.openIntegrationSetup("composio","test-principal","project",{user:"alice",connection:"broker"});
  const snap=await f.credentialSnapshot("composio",{user:"alice",connection:"broker"});await f.saveConnectionValues("composio",{user:"alice",connection:"broker"},{apiKey:B},snap.connection);
  await expect(setup.consumeIntegrationSetup(grant.token,{apiKey:A})).rejects.toMatchObject({code:"connection_changed_reopen_setup"});
  const renewed=await setup.openIntegrationSetup("composio","test-principal","project",{user:"alice",connection:"broker"});
  await f.manage({action:"connection.delete",user:"alice",provider:"composio",connection:"broker",confirm:true});
  await f.manage({action:"connection.create",user:"alice",provider:"composio",connection:"broker",authMethod:"project",confirm:true});
  await expect(setup.consumeIntegrationSetup(renewed.token,{apiKey:A})).rejects.toMatchObject({code:"connection_changed_reopen_setup"});
  expect((await f.credentialSnapshot("composio",{user:"bob",connection:"broker"})).connection.values.apiKey).toBe(B);
});
it("fails closed for symlink/malformed stores and refuses migration if backup bytes do not match",async()=>{
  const {readIntegrationState,migrateIntegrationStore}=await import("./connection-storage"),file=process.env.OS_INFRA_STORE!;
  await fs.writeFile(file,JSON.stringify({providers:{github:{apiKey:A}}}),{mode:0o600});await fs.writeFile(file+".v1-backup.json","different",{mode:0o600});
  await expect(migrateIntegrationStore()).rejects.toMatchObject({code:"migration_backup_conflict"});expect(JSON.parse(await fs.readFile(file,"utf8")).version).toBeUndefined();
  await fs.unlink(file);await fs.symlink(file+".v1-backup.json",file);await expect(readIntegrationState()).rejects.toThrow("unsafe");
});

it("refuses a symlinked migration backup without touching either file",async()=>{
  const {migrateIntegrationStore}=await import("./connection-storage"),file=process.env.OS_INFRA_STORE!;
  const original=JSON.stringify({providers:{github:{apiKey:A}}}),target=path.join(root,"outside.json");
  await fs.writeFile(file,original,{mode:0o600});await fs.writeFile(target,original,{mode:0o600});await fs.symlink(target,file+".v1-backup.json");
  await expect(migrateIntegrationStore()).rejects.toThrow();
  expect(await fs.readFile(file,"utf8")).toBe(original);expect(await fs.readFile(target,"utf8")).toBe(original);
});
it("removes only the selected direct connection and does not mutate object prototypes",async()=>{
  const f=await fixture(),{removeInfraProvider}=await import("./store");
  await f.manage({action:"connection.create",user:"alice",provider:"github",connection:"direct-work",source:"direct",authMethod:"direct",confirm:true});
  await f.withIntegrationSelection({user:"alice",connection:"direct-work"},()=>removeInfraProvider("github"));
  const {readIntegrationState}=await import("./connection-storage");const state=await readIntegrationState();
  expect(state.users.alice.connections.github["direct-work"]).toBeUndefined();expect(state.users.alice.connections.github.work.source).toBe("composio");
  expect(state.users.bob.connections.github.work.source).toBe("composio");
  await expect(f.withIntegrationSelection({user:"constructor",connection:"work"},()=>removeInfraProvider("github"))).rejects.toThrow();
  expect(Object.prototype).not.toHaveProperty("work");
});
