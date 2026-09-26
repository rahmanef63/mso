import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
vi.mock("server-only",()=>({}));
let root:string;
beforeEach(async()=>{root=await fs.mkdtemp(path.join(os.tmpdir(),"mso-jev-ref-"));process.env.OS_INFRA_STORE=path.join(root,"infra.json");vi.resetModules();});
afterEach(async()=>{delete process.env.OS_INFRA_STORE;await fs.rm(root,{recursive:true,force:true});vi.resetModules();});

describe("Jev routing resolution",()=>{
  it("uses the shared OpenRouter AI credential path by default and preserves explicit MCP overrides",async()=>{
    const {integrationManage}=await import("@/lib/infra/connection-manage");
    await integrationManage({action:"user.create",confirm:true,user:"alice"});
    await integrationManage({action:"connection.create",confirm:true,user:"alice",provider:"mcp",connection:"jev",source:"direct",authMethod:"direct"});
    await integrationManage({action:"connection.create",confirm:true,user:"alice",provider:"mcp",connection:"alternate",source:"direct",authMethod:"direct"});
    await integrationManage({action:"variable.set",confirm:true,key:"JEV",user:"alice",provider:"mcp",connection:"jev"});
    const {resolveJevIntegrationConfig}=await import("./jev-integration");
    await expect(resolveJevIntegrationConfig()).resolves.toEqual({transport:"openrouter",provider:"openrouter",model:"~typesafe/jev-latest"});
    await expect(resolveJevIntegrationConfig({model:"typesafe/jev-1.13"})).resolves.toEqual({transport:"openrouter",provider:"openrouter",model:"typesafe/jev-1.13"});
    await expect(resolveJevIntegrationConfig({variable:"JEV",model:"decision-model"})).resolves.toEqual({transport:"mcp",user:"alice",connection:"jev",model:"decision-model"});
    await expect(resolveJevIntegrationConfig({user:"alice",connection:"alternate"})).resolves.toEqual({transport:"mcp",user:"alice",connection:"alternate"});
    await expect(resolveJevIntegrationConfig({user:"alice"})).rejects.toThrow("both integration user and connection");
  });
  it("rejects an explicit legacy variable that points to a non-MCP provider",async()=>{
    const {integrationManage}=await import("@/lib/infra/connection-manage");
    await integrationManage({action:"user.create",confirm:true,user:"alice"});
    await integrationManage({action:"connection.create",confirm:true,user:"alice",provider:"github",connection:"work",source:"direct",authMethod:"direct"});
    await integrationManage({action:"variable.set",confirm:true,key:"JEV",user:"alice",provider:"github",connection:"work"});
    const {resolveJevIntegrationConfig}=await import("./jev-integration");
    await expect(resolveJevIntegrationConfig({variable:"JEV"})).rejects.toThrow("must reference provider mcp");
  });
});
