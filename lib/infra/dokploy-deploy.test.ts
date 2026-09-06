import { expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

it("queues one exact Dokploy application deploy without exposing provider credentials", async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"mso-dokploy-deploy-"));process.env.OS_INFRA_STORE=path.join(root,"infra.json");
  try{
    vi.resetModules();
    const { integrationManage }=await import("./connection-manage"),{ withIntegrationSelection }=await import("./connection-service"),{ setInfraProvider }=await import("./store");
    await integrationManage({action:"user.create",user:"alice",confirm:true});await integrationManage({action:"connection.create",user:"alice",provider:"dokploy",connection:"default",source:"direct",authMethod:"direct",confirm:true});
    await withIntegrationSelection({user:"alice",connection:"default"},()=>setInfraProvider("dokploy",{apiUrl:"http://127.0.0.1:4123/api",apiKey:"synthetic_dokploy_key_1234567890"}));
    const mock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const req=new Request(input,init);expect(req.url).toBe("http://127.0.0.1:4123/api/application.deploy");expect(req.method).toBe("POST");expect(JSON.parse(await req.text())).toEqual({applicationId:"ABCDEFGH1234"});return new Response("{}",{status:200});});vi.stubGlobal("fetch",mock);
    const {deployDokployApplication}=await import("./dokploy");
    const result=await withIntegrationSelection({user:"alice",connection:"default"},()=>deployDokployApplication("ABCDEFGH1234"));expect(result).toEqual({applicationId:"ABCDEFGH1234",redeployQueued:true});expect(JSON.stringify(result)).not.toContain("synthetic_dokploy_key");
  }finally{delete process.env.OS_INFRA_STORE;await fs.rm(root,{recursive:true,force:true});vi.unstubAllGlobals();}
});
