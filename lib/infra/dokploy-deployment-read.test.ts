import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

let root:string;
const KEY="synthetic_dokploy_key_123456789";
beforeEach(async()=>{root=await fs.mkdtemp(path.join(os.tmpdir(),"mso-dokploy-read-"));process.env.OS_INFRA_STORE=path.join(root,"infra.json");vi.resetModules();});
afterEach(async()=>{delete process.env.OS_INFRA_STORE;vi.unstubAllGlobals();await fs.rm(root,{recursive:true,force:true});vi.resetModules();});
async function seeded(){
  const {integrationManage}=await import("./connection-manage");
  await integrationManage({action:"user.create",user:"alice",confirm:true});
  await integrationManage({action:"connection.create",user:"alice",provider:"dokploy",connection:"work",authMethod:"direct",source:"direct",confirm:true});
  const {withIntegrationSelection}=await import("./connection-service"),{setInfraProvider}=await import("./store");
  await withIntegrationSelection({user:"alice",connection:"work"},()=>setInfraProvider("dokploy",{apiUrl:"http://127.0.0.1:4123/api",apiKey:KEY}));
  return withIntegrationSelection;
}
it("lists bounded deployment metadata and redacts secret-shaped fields",async()=>{
  const withSelection=await seeded();
  vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
    const url=new URL(new Request(input).url);
    if(url.pathname.endsWith("/deployment.all"))return new Response(JSON.stringify([{deploymentId:"deployment_123",status:"error",title:"Deploy",description:"token=abc123",errorMessage:"authorization=Bearer super-secret",createdAt:"2026-09-06T00:00:00Z"}]),{status:200});
    return new Response("not found",{status:404});
  }));
  const {listDokployDeployments}=await import("./dokploy");
  const rows=await withSelection({user:"alice",connection:"work"},()=>listDokployDeployments("application_123"));
  expect(rows[0]).toMatchObject({deploymentId:"deployment_123",status:"error",title:"Deploy"});
  expect(JSON.stringify(rows)).not.toContain("super-secret");
});
it("returns only redacted bounded deployment logs",async()=>{
  const withSelection=await seeded();
  vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
    const url=new URL(new Request(input).url);
    if(url.pathname.endsWith("/deployment.readLogs")){expect(url.searchParams.get("tail")).toBe("160");return new Response(JSON.stringify("build failed\nAPI_KEY=very-secret-value\n"),{status:200});}
    return new Response("not found",{status:404});
  }));
  const {readDokployDeploymentLogs}=await import("./dokploy");
  const result=await withSelection({user:"alice",connection:"work"},()=>readDokployDeploymentLogs("deployment_123"));
  expect(result.logs).toContain("build failed");
  expect(result.logs).not.toContain("very-secret-value");
});
it("recovers only an existing GitHub source to validated public HTTPS Git and redeploys",async()=>{
  const withSelection=await seeded();let sourceType="github",customGitUrl="",customGitBranch="",deploys=0;
  vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const req=new Request(input,init),url=new URL(req.url);
    if(url.pathname.endsWith("/application.one"))return new Response(JSON.stringify({applicationId:"application_123",sourceType,owner:"rahmanef63",repository:"CareerPack",branch:"main",buildPath:"/",watchPaths:[],enableSubmodules:false,customGitUrl,customGitBranch}),{status:200});
    if(url.pathname.endsWith("/application.saveGitProvider")){const body=JSON.parse(await req.text());expect(body).toEqual({applicationId:"application_123",customGitBuildPath:"/",customGitUrl:"https://github.com/rahmanef63/CareerPack.git",watchPaths:[],enableSubmodules:false,customGitBranch:"main",customGitSSHKeyId:null});sourceType="git";customGitUrl=body.customGitUrl;customGitBranch=body.customGitBranch;return new Response("{}",{status:200});}
    if(url.pathname.endsWith("/application.deploy")){deploys++;return new Response("{}",{status:200});}
    return new Response("not found",{status:404});
  }));
  const {recoverDokployPublicGithubToHttpsGit}=await import("./dokploy");
  const result=await withSelection({user:"alice",connection:"work"},()=>recoverDokployPublicGithubToHttpsGit("application_123"));
  expect(result).toMatchObject({sourceType:"git",customGitUrl:"https://github.com/rahmanef63/CareerPack.git",redeployQueued:true});expect(deploys).toBe(1);
});
