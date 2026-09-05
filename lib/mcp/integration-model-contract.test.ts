import { inlineScripts } from "../../scripts/test-support/inline-scripts";
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {promises as fs} from "node:fs";
import os from "node:os";
import path from "node:path";
vi.mock("server-only",()=>({}));
let root:string;
beforeEach(async()=>{root=await fs.mkdtemp(path.join(os.tmpdir(),"mso-contract-model-"));process.env.OS_INFRA_STORE=path.join(root,"infra.json");vi.resetModules();});
afterEach(async()=>{delete process.env.OS_INFRA_STORE;await fs.rm(root,{recursive:true,force:true});vi.resetModules();});
it("uses the same native metadata services through actual MCP calls and rejects insufficient scope",async()=>{
  const {dispatch}=await import("./dispatch");
  const call=(id:number,name:string,args:Record<string,unknown>,scope:"read"|"write"|"exec"="exec")=>dispatch({id,method:"tools/call",params:{name,arguments:args}},scope,"test",{principal:"mcp-client:integration-contract",sessionId:"integration-contract",toolProfile:"chatgpt"});
  const denied=await call(1,"integration_manage",{action:"user.create",user:"alice",confirm:true},"read");expect(denied.error??denied.result).toBeTruthy();
  const {readIntegrationState}=await import("@/lib/infra/connection-storage");expect((await readIntegrationState()).users).toEqual({});
  const created=await call(2,"integration_manage",{action:"user.create",user:"alice",confirm:true});expect(created.error).toBeUndefined();expect((created.result as any)?.structuredContent?.result?.ok).toBe(true);
  const added=await call(3,"integration_manage",{action:"connection.create",user:"alice",provider:"convex-cloud",connection:"mimin-production",authMethod:"deployment",source:"direct",confirm:true});expect(added.error).toBeUndefined();
  const metadata=await call(4,"integration_query",{view:"resolve",user:"alice",provider:"convex-cloud",connection:"mimin-production"});expect((metadata.result as any)?.structuredContent?.result).toMatchObject({user:"alice",id:"mimin-production",source:"direct",authMethod:"deployment"});
  const inputRejected=await call(5,"integration_manage",{action:"user.create",user:"eve",confirm:true,token:"synthetic"});expect((await readIntegrationState()).users.eve).toBeUndefined();expect(inputRejected.error??(inputRejected.result as any)?.isError).toBeTruthy();
});
it("returns identity-bound setup only in UI-private metadata on both supported MCP profiles",async()=>{
  const {integrationManage}=await import("@/lib/infra/connection-manage");await integrationManage({action:"user.create",user:"alice",confirm:true});await integrationManage({action:"connection.create",user:"alice",provider:"github",connection:"work",source:"direct",authMethod:"direct",confirm:true});
  const {dispatch}=await import("./dispatch");
  for(const profile of ["full","chatgpt"] as const){
    const result=await dispatch({id:1,method:"tools/call",params:{name:"integration_setup_open",arguments:{user:"alice",provider:"github",connection:"work"}}},"write","test",{principal:"mcp-client:integration-contract",sessionId:"integration-contract",toolProfile:profile});
    const wire=result.result as any;expect(result.error).toBeUndefined();expect(wire.structuredContent.setup).toMatchObject({user:"alice",connection:"work",source:"direct"});
    const token=wire._meta?.integrationSetup?.token;expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);expect(JSON.stringify(wire.content)).not.toContain(token);expect(JSON.stringify(wire.structuredContent)).not.toContain(token);
  }
});
it("keeps current and older Page resources readable and emits no extra UI type",async()=>{
  const {readUiResource,listUiResources,MSO_PAGE_URI}=await import("./ui-resources");
  expect(listUiResources()).toHaveLength(2);const html=readUiResource(MSO_PAGE_URI)!.text;
  for(const version of [1,2,3,4,5,6])expect(readUiResource(`ui://mso/page-v${version}.html`)?.text).toBe(html);
  expect(html).toContain("mountConnectionManager");expect(html).toContain("data-display-mode");
  const script=inlineScripts(html)[0];expect(()=>new Function(script!)).not.toThrow();
});
