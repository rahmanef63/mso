import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {promises as fs} from "node:fs";
import os from "node:os";
import path from "node:path";
vi.mock("server-only",()=>({}));
let root:string,file:string;
beforeEach(async()=>{root=await fs.mkdtemp(path.join(os.tmpdir(),"mso-model-test-"));file=path.join(root,"infra.json");process.env.OS_INFRA_STORE=file;vi.resetModules();});
afterEach(async()=>{vi.unstubAllGlobals();delete process.env.OS_INFRA_STORE;await fs.rm(root,{recursive:true,force:true});vi.resetModules();});
const KEY_A="synthetic_key_account_alpha_123456",KEY_B="synthetic_key_account_beta_1234567";
async function fixture(){
  const {integrationManage:manage}=await import("./connection-manage");
  const service=await import("./connection-service");
  await manage({action:"user.create",confirm:true,user:"alice"});await manage({action:"user.create",confirm:true,user:"bob"});
  async function add(user:string,provider:string,id:string,method:string,values:Record<string,string>,source="direct"){
    await manage({action:"connection.create",confirm:true,user,provider,connection:id,authMethod:method,source});
    if(source==="direct"&&Object.keys(values).length){const snap=await service.credentialSnapshot(provider,{user,connection:id});await service.saveConnectionValues(provider,{user,connection:id},values,snap.connection,true);}
  }
  return{manage,...service,add};
}
describe("native credential identity core",()=>{
  it("projects legacy state without writes, then atomically migrates with an exact protected backup",async()=>{
    const original=JSON.stringify({providers:{composio:{apiKey:KEY_A,orgApiKey:KEY_B},"convex-cloud":{personalToken:KEY_A,deployKey:KEY_B,deploymentName:"test-deployment"},github:{apiKey:KEY_A}}},null,2);
    await fs.writeFile(file,original,{mode:0o600});const {readIntegrationState,migrateIntegrationStore}=await import("./connection-storage");
    const projected=await readIntegrationState();expect(await fs.readFile(file,"utf8")).toBe(original);
    expect(Object.keys(projected.users.legacy.connections.composio)).toEqual(["project","organization"]);
    expect(projected.users.legacy.defaults.composio).toBe("organization");expect(projected.users.legacy.defaults["convex-cloud"]).toBe("deployment");
    await migrateIntegrationStore();const state=await readIntegrationState();expect(state.version).toBe(2);expect(state.users.legacy.connections.github.default.values.apiKey).toBe(KEY_A);
    expect(await fs.readFile(file+".v1-backup.json","utf8")).toBe(original);expect((await fs.stat(file+".v1-backup.json")).mode&0o777).toBe(0o600);
    expect((await readIntegrationState()).instanceId).toBe(state.instanceId);
  });
  it("isolates two users and five named Convex account/deployment connections",async()=>{
    const f=await fixture();await f.add("alice","convex-cloud","admin","personal",{personalToken:KEY_A});
    for(const id of ["baton","mimin-production","mimin-staging","play-together"]){await f.add("alice","convex-cloud",id,"deployment",{deployKey:KEY_A+id,deploymentName:id});}
    await f.add("bob","convex-cloud","mimin-production","deployment",{deployKey:KEY_B,deploymentName:"different-deployment"});
    const state=await f.integrationSnapshot({user:"alice"});expect(state.connections).toHaveLength(5);expect(JSON.stringify(state)).not.toContain(KEY_A);
    expect((await f.directConnectionValues("convex-cloud",{user:"bob",connection:"mimin-production"})).deployKey).toBe(KEY_B);
    expect((await f.resolveIntegration("convex-cloud",{user:"alice",connection:"mimin-production"})).scope).toBe("deployment");
    await expect(f.resolveIntegration("convex-cloud",{user:"missing",connection:"admin"})).rejects.toMatchObject({code:"user_not_found"});
    await expect(f.resolveIntegration("convex-cloud",{user:"alice",connection:"missing"})).rejects.toMatchObject({code:"connection_not_found"});
  });
  it("uses explicit user/connection before folder/default context and refuses ambiguity",async()=>{
    const f=await fixture();await f.add("alice","github","work","direct",{apiKey:KEY_A});await f.add("alice","github","personal","direct",{apiKey:KEY_B});await f.add("bob","github","work","direct",{apiKey:KEY_B});
    await f.manage({action:"folder.map",confirm:true,user:"alice",path:root,provider:"github",connection:"personal"});
    expect((await f.resolveIntegration("github",{cwd:path.join(root,"project")})).id).toBe("personal");
    expect((await f.resolveIntegration("github",{cwd:root,user:"bob"})).id).toBe("work");
    expect((await f.resolveIntegration("github",{cwd:root,user:"alice",connection:"work"})).id).toBe("work");
    await expect(f.manage({action:"connection.delete",confirm:true,user:"alice",provider:"github",connection:"personal"})).rejects.toMatchObject({code:"connection_has_folder_binding"});
    await f.manage({action:"folder.unmap",confirm:true,path:root});
    const {mutateIntegrationState}=await import("./connection-storage");await mutateIntegrationState(d=>{delete d.users.alice.defaults.github;});
    await expect(f.resolveIntegration("github",{user:"alice"})).rejects.toMatchObject({code:"connection_ambiguous"});
  });
  it("shares the selected credential with the actual Dokploy client without mixing concurrent calls",async()=>{
    const f=await fixture();await f.add("alice","dokploy","work","direct",{apiUrl:"http://127.0.0.1:4123",apiKey:KEY_A});await f.add("bob","dokploy","work","direct",{apiUrl:"http://127.0.0.1:4124",apiKey:KEY_B});
    const calls:Array<{url:string;key:string|null}>=[];vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const req=new Request(input,init);calls.push({url:req.url,key:req.headers.get("x-api-key")});await new Promise(r=>setTimeout(r,5));return new Response(JSON.stringify([{projectId:"one",name:"Project"}]),{status:200});}));
    const {listDokployProjects}=await import("./dokploy");
    await Promise.all([f.withIntegrationSelection({user:"alice",connection:"work"},()=>listDokployProjects()),f.withIntegrationSelection({user:"bob",connection:"work"},()=>listDokployProjects())]);
    expect(calls).toContainEqual({url:"http://127.0.0.1:4123/api/project.all",key:KEY_A});expect(calls).toContainEqual({url:"http://127.0.0.1:4124/api/project.all",key:KEY_B});
  });
  it("updates one Dokploy public build env privately, preserves build settings, and redeploys once",async()=>{
    const f=await fixture();await f.add("alice","dokploy","work","direct",{apiUrl:"http://127.0.0.1:4123",apiKey:KEY_A});
    let env="PRIVATE_TOKEN=synthetic-private\nNEXT_PUBLIC_CONVEX_URL=https://old.example\n";let deploys=0;
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const req=new Request(input,init),url=new URL(req.url);
      if(url.pathname.endsWith("/application.one"))return new Response(JSON.stringify({applicationId:"application_123",env,buildArgs:"BUILD=1",buildSecrets:"SYNTHETIC_BUILD_SECRET",createEnvFile:true}),{status:200});
      if(url.pathname.endsWith("/application.saveEnvironment")){const body=JSON.parse(await req.text());expect(body).toMatchObject({applicationId:"application_123",buildArgs:"BUILD=1",buildSecrets:"SYNTHETIC_BUILD_SECRET",createEnvFile:true});env=body.env;return new Response("{}",{status:200});}
      if(url.pathname.endsWith("/application.deploy")){deploys+=1;return new Response("{}",{status:200});}
      return new Response("not found",{status:404});
    }));
    const {upsertDokployPublicBuildEnv}=await import("./dokploy");
    const result=await f.withIntegrationSelection({user:"alice",connection:"work"},()=>upsertDokployPublicBuildEnv({applicationId:"application_123",key:"NEXT_PUBLIC_CONVEX_URL",value:"https://api.example.com"}));
    expect(result).toEqual({applicationId:"application_123",key:"NEXT_PUBLIC_CONVEX_URL",changed:true,redeployQueued:true});expect(deploys).toBe(1);
    expect(env).toContain("PRIVATE_TOKEN=synthetic-private");expect(env).toContain("NEXT_PUBLIC_CONVEX_URL=https://api.example.com");expect(JSON.stringify(result)).not.toContain("api.example.com");
  });
  it("pins credentials for the duration of a compound operation and never changes defaults",async()=>{
    const f=await fixture();await f.add("alice","github","work","direct",{apiKey:KEY_A});
    await f.withIntegrationSelection({user:"alice",connection:"work"},async()=>{
      expect((await f.directConnectionValues("github")).apiKey).toBe(KEY_A);const snap=await f.credentialSnapshot("github",{user:"alice",connection:"work"});await f.saveConnectionValues("github",{user:"alice",connection:"work"},{apiKey:KEY_B},snap.connection);
      expect((await f.directConnectionValues("github")).apiKey).toBe(KEY_A);
    });expect((await f.directConnectionValues("github",{user:"alice",connection:"work"})).apiKey).toBe(KEY_B);
  });
  it("distinguishes external sources and refuses silent local-key substitution",async()=>{
    const f=await fixture();await f.add("alice","github","direct","direct",{apiKey:KEY_A});await f.add("alice","github","hosted","oauth2",{},"composio");await f.add("alice","vercel","native","provider-oauth",{},"native-mcp");
    await expect(f.directConnectionValues("github",{user:"alice",connection:"hosted"})).rejects.toMatchObject({code:"external_source_requires_own_executor"});
    const native=await f.resolveIntegration("vercel",{user:"alice",connection:"native"});expect(native.execution).toMatchObject({route:"provider-mcp",endpoint:"https://mcp.vercel.com"});
    await expect(f.resolveIntegration("github",{user:"alice",connection:"hosted",source:"direct"})).rejects.toMatchObject({code:"connection_source_mismatch"});
  });
  it("duplicates metadata by default, requires explicit key copying, and migrates folder mappings on rename",async()=>{
    const f=await fixture();await f.add("alice","github","work","direct",{apiKey:KEY_A});
    await f.manage({action:"user.duplicate",confirm:true,user:"alice",target:"empty-copy"});expect(await f.directConnectionValues("github",{user:"empty-copy",connection:"work"})).toEqual({});
    await f.manage({action:"user.duplicate",confirm:true,user:"alice",target:"key-copy",copyCredentials:true});expect((await f.directConnectionValues("github",{user:"key-copy",connection:"work"})).apiKey).toBe(KEY_A);
    await f.manage({action:"folder.map",confirm:true,user:"alice",path:root});await f.manage({action:"user.rename",confirm:true,user:"alice",target:"renamed"});expect((await f.integrationQuery({view:"which",cwd:root}) as {user:string}).user).toBe("renamed");
  });
  it("shares direct credentials as read-only aliases with live backing, safe ids, rename/default, duplication, and unshare invariants",async()=>{
    const f=await fixture();await f.add("alice","github","work","direct",{apiKey:KEY_A});
    const shared=await f.manage({action:"connection.share",confirm:true,user:"alice",provider:"github",connection:"work",target:"bob",label:"Shared Work GitHub"}) as {connection:{id:string}};
    expect(shared.connection.id).toBe("shared-work-github");
    let bob=await f.integrationSnapshot({user:"bob"});const alias=bob.connections.find(c=>c.id===shared.connection.id)!;expect(alias.sharedFrom).toEqual({user:"alice",provider:"github",connection:"work"});expect(alias.fields.find(f=>f.key==="apiKey")?.stored).toBe(true);expect(JSON.stringify(alias)).not.toContain(KEY_A);
    expect((await f.directConnectionValues("github",{user:"bob",connection:alias.id})).apiKey).toBe(KEY_A);
    await expect(f.credentialSnapshot("github",{user:"bob",connection:alias.id})).rejects.toMatchObject({code:"shared_alias_readonly"});
    await expect(f.manage({action:"credential.delete",confirm:true,user:"bob",provider:"github",connection:alias.id,key:"apiKey"})).rejects.toMatchObject({code:"shared_alias_readonly"});
    await expect(f.manage({action:"connection.share",confirm:true,user:"bob",provider:"github",connection:alias.id,target:"alice",label:"No reshare"})).rejects.toMatchObject({code:"shared_alias_cannot_share"});
    await f.manage({action:"connection.rename",confirm:true,user:"bob",provider:"github",connection:alias.id,label:"Renamed shared account"});await f.manage({action:"connection.default",confirm:true,user:"bob",provider:"github",connection:alias.id});
    const owner=await f.credentialSnapshot("github",{user:"alice",connection:"work"});await f.saveConnectionValues("github",{user:"alice",connection:"work"},{apiKey:KEY_B},owner.connection);expect((await f.directConnectionValues("github",{user:"bob",connection:alias.id})).apiKey).toBe(KEY_B);
    await expect(f.manage({action:"connection.delete",confirm:true,user:"alice",provider:"github",connection:"work"})).rejects.toMatchObject({code:"connection_has_shared_dependents"});await expect(f.manage({action:"user.delete",confirm:true,user:"alice"})).rejects.toMatchObject({code:"user_has_shared_dependents"});
    await f.manage({action:"user.rename",confirm:true,user:"alice",target:"owner-renamed"});bob=await f.integrationSnapshot({user:"bob"});expect(bob.connections.find(c=>c.id===alias.id)?.sharedFrom?.user).toBe("owner-renamed");
    await f.manage({action:"user.duplicate",confirm:true,user:"bob",target:"bob-empty"});const empty=await f.integrationSnapshot({user:"bob-empty"});expect(empty.connections[0].sharedFrom).toBeNull();expect(await f.directConnectionValues("github",{user:"bob-empty",connection:alias.id})).toEqual({});
    await f.manage({action:"user.duplicate",confirm:true,user:"bob",target:"bob-copy",copyCredentials:true});const copied=await f.integrationSnapshot({user:"bob-copy"});expect(copied.connections[0].sharedFrom).toBeNull();expect((await f.directConnectionValues("github",{user:"bob-copy",connection:alias.id})).apiKey).toBe(KEY_B);
    await f.manage({action:"connection.unshare",confirm:true,user:"bob",provider:"github",connection:alias.id});expect((await f.integrationSnapshot({user:"bob"})).connections).toHaveLength(0);await expect(f.manage({action:"connection.unshare",confirm:true,user:"bob-copy",provider:"github",connection:alias.id})).rejects.toMatchObject({code:"connection_not_shared"});
    await f.manage({action:"connection.delete",confirm:true,user:"owner-renamed",provider:"github",connection:"work"});
  });
  it("rejects sharing external sources and deletes one direct credential field without exposing values",async()=>{
    const f=await fixture();await f.add("alice","github","hosted","oauth2",{},"composio");await expect(f.manage({action:"connection.share",confirm:true,user:"alice",provider:"github",connection:"hosted",target:"bob",label:"Hosted share"})).rejects.toMatchObject({code:"external_connections_cannot_share"});
    await f.add("alice","convex-cloud","deploy","deployment",{deployKey:KEY_A,deploymentName:"test-deployment"});await f.manage({action:"credential.delete",confirm:true,user:"alice",provider:"convex-cloud",connection:"deploy",key:"deploymentName"});const values=await f.directConnectionValues("convex-cloud",{user:"alice",connection:"deploy"});expect(values).toEqual({deployKey:KEY_A});const row=(await f.integrationSnapshot({user:"alice"})).connections.find(c=>c.id==="deploy")!;expect(row.missing).toContain("deploymentName");expect(JSON.stringify(row)).not.toContain(KEY_A);
  });
  it("rejects secret-shaped machine input, unconfirmed writes, and identity pollution",async()=>{
    const f=await fixture();await expect(f.manage({action:"user.create",user:"eve"})).rejects.toMatchObject({code:"confirmation_required"});
    await expect(f.integrationQuery({view:"snapshot",nested:{token:"synthetic"}})).rejects.toMatchObject({code:"secret_input_forbidden"});
    await expect(f.manage({action:"user.create",confirm:true,user:"constructor"})).rejects.toThrow("invalid_user");
    expect(JSON.stringify(await f.integrationSnapshot())).not.toContain(KEY_A);
  });
});
