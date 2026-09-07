import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

let root:string;
const KEY="synthetic_dokploy_key_123456789";
beforeEach(async()=>{root=await fs.mkdtemp(path.join(os.tmpdir(),"mso-dokploy-app-"));process.env.OS_INFRA_STORE=path.join(root,"infra.json");vi.resetModules();});
afterEach(async()=>{delete process.env.OS_INFRA_STORE;vi.unstubAllGlobals();await fs.rm(root,{recursive:true,force:true});vi.resetModules();});
async function seeded(){
  const {integrationManage}=await import("./connection-manage");
  await integrationManage({action:"user.create",user:"alice",confirm:true});
  await integrationManage({action:"connection.create",user:"alice",provider:"dokploy",connection:"work",authMethod:"direct",source:"direct",confirm:true});
  const {withIntegrationSelection}=await import("./connection-service"),{setInfraProvider}=await import("./store");
  await withIntegrationSelection({user:"alice",connection:"work"},()=>setInfraProvider("dokploy",{apiUrl:"http://127.0.0.1:4123/api",apiKey:KEY}));
  return withIntegrationSelection;
}

it("idempotently creates a private GitHub-backed application through an accessible Dokploy provider",async()=>{
  const withSelection=await seeded();let created=false,sourceSaved=false;
  vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const req=new Request(input,init),url=new URL(req.url);
    if(url.pathname.endsWith("/github.one"))return new Response(JSON.stringify({githubId:"github_123",name:"Work"}),{status:200});
    if(url.pathname.endsWith("/github.getGithubRepositories"))return new Response(JSON.stringify([{name:"baton",owner:{login:"rahmanef63"}}]),{status:200});
    if(url.pathname.endsWith("/environment.byProjectId"))return new Response(JSON.stringify([{environmentId:"environment_123",name:"Production",isDefault:true,applications:created?[{applicationId:"application_123",name:"baton",appName:"baton",applicationStatus:"idle"}]:[]}]),{status:200});
    if(url.pathname.endsWith("/application.create")){expect(JSON.parse(await req.text())).toEqual({name:"baton",environmentId:"environment_123",sourceType:"github"});created=true;return new Response("{}",{status:200});}
    if(url.pathname.endsWith("/application.saveGithubProvider")){expect(JSON.parse(await req.text())).toEqual({applicationId:"application_123",repository:"baton",owner:"rahmanef63",buildPath:"/",githubId:"github_123",branch:"main",triggerType:"push",enableSubmodules:false,watchPaths:[]});sourceSaved=true;return new Response("{}",{status:200});}
    if(url.pathname.endsWith("/application.one"))return new Response(JSON.stringify({applicationId:"application_123",name:"baton",sourceType:sourceSaved?"github":"",githubId:"github_123",owner:"rahmanef63",repository:"baton",branch:"main",buildPath:"/"}),{status:200});
    return new Response("not found",{status:404});
  }));
  const {ensureDokployGithubApplication}=await import("./dokploy");
  const result=await withSelection({user:"alice",connection:"work"},()=>ensureDokployGithubApplication({projectId:"project_123",name:"baton",githubId:"github_123",owner:"rahmanef63",repository:"baton",branch:"main"}));
  expect(result).toMatchObject({applicationId:"application_123",sourceType:"github",owner:"rahmanef63",repository:"baton",created:true});
});

it("refuses a repository not exposed by the selected Dokploy GitHub provider",async()=>{
  const withSelection=await seeded();
  vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{const url=new URL(new Request(input).url);if(url.pathname.endsWith("/github.one"))return new Response(JSON.stringify({githubId:"github_123"}),{status:200});if(url.pathname.endsWith("/github.getGithubRepositories"))return new Response(JSON.stringify([{name:"other",owner:{login:"rahmanef63"}}]),{status:200});return new Response("not found",{status:404});}));
  const {ensureDokployGithubApplication}=await import("./dokploy");
  await expect(withSelection({user:"alice",connection:"work"},()=>ensureDokployGithubApplication({projectId:"project_123",name:"baton",githubId:"github_123",owner:"rahmanef63",repository:"baton",branch:"main"}))).rejects.toThrow(/not accessible/i);
});

it("ensures an HTTPS application domain and verifies it",async()=>{
  const withSelection=await seeded();let created=false;
  vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const req=new Request(input,init),url=new URL(req.url);if(url.pathname.endsWith("/domain.byApplicationId"))return new Response(JSON.stringify(created?[{domainId:"domain_123",host:"baton.rahmanef.com",port:3000,https:true}]:[]),{status:200});if(url.pathname.endsWith("/domain.create")){expect(JSON.parse(await req.text())).toEqual({host:"baton.rahmanef.com",port:3000,https:true,applicationId:"application_123",certificateType:"letsencrypt"});created=true;return new Response("{}",{status:200});}return new Response("not found",{status:404});}));
  const {ensureDokployApplicationDomain}=await import("./dokploy");
  const result=await withSelection({user:"alice",connection:"work"},()=>ensureDokployApplicationDomain({applicationId:"application_123",host:"baton.rahmanef.com",port:3000,https:true}));
  expect(result).toMatchObject({domainId:"domain_123",host:"baton.rahmanef.com",port:3000,https:true,created:true});
});
