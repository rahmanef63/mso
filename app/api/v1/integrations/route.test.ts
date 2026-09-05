import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {NextRequest} from "next/server";
import {promises as fs} from "node:fs";
import path from "node:path";
import os from "node:os";
const auth=vi.hoisted(()=>({role:"owner" as string|null}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/auth/require-session",()=>({getSessionContext:async()=>auth.role?{role:auth.role,session:{device_id:"synthetic-test-owner"}}:null}));
vi.mock("@/lib/host/audit-api",()=>({audit:vi.fn()}));
let root:string;
beforeEach(async()=>{auth.role="owner";root=await fs.mkdtemp(path.join(os.tmpdir(),"mso-integration-api-"));process.env.OS_INFRA_STORE=path.join(root,"infra.json");vi.resetModules();});
afterEach(async()=>{delete process.env.OS_INFRA_STORE;await fs.rm(root,{recursive:true,force:true});vi.resetModules();});
const req=(body:unknown)=>new NextRequest("https://mso.rahmanef.com/api/v1/integrations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
it("enforces Owner on profile metadata and mutations regardless of selected credential user",async()=>{
  const {GET,POST}=await import("./route");for(const role of [null,"viewer","operator"]){auth.role=role;expect((await GET(new NextRequest("https://mso.rahmanef.com/api/v1/integrations"))).status).toBe(403);expect((await POST(req({mode:"manage",action:"user.create",confirm:true,user:"owner"}))).status).toBe(403);}
});
it("shares confirmed actions with the CLI/MCP core and rejects secret-shaped metadata",async()=>{
  const {GET,POST}=await import("./route");
  expect((await POST(req({mode:"manage",action:"user.create",user:"alice"}))).status).toBe(403);
  expect((await POST(req({mode:"manage",action:"user.create",confirm:true,user:"alice",token:"synthetic"}))).status).toBe(400);
  expect((await POST(req({mode:"manage",action:"user.create",confirm:true,user:"alice"}))).status).toBe(200);
  const response=await GET(new NextRequest("https://mso.rahmanef.com/api/v1/integrations?view=users"));expect(await response.json()).toMatchObject({users:[{id:"alice"}],user:"alice"});
});
