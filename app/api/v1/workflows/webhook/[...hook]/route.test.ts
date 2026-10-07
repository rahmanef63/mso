import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks=vi.hoisted(()=>({
  source:vi.fn(), secret:vi.fn(), untrusted:vi.fn(()=>false), privileged:vi.fn(()=>false),
  authority:vi.fn(), session:vi.fn(), start:vi.fn(), status:vi.fn(),
}));
vi.mock("@/lib/workflow/graph-triggers",()=>({findActiveWebhookSource:mocks.source}));
vi.mock("@/lib/workflow/variables",()=>({workflowWebhookSecret:mocks.secret}));
vi.mock("@/lib/host/limits-api",()=>({rateLimitedUntrusted:mocks.untrusted,rateLimited:mocks.privileged}));
vi.mock("@/lib/host/request-ip",()=>({clientIp:()=>"203.0.113.4"}));
vi.mock("@/lib/workflow/graph-authority",()=>({workflowExecutionContext:mocks.authority}));
vi.mock("@/lib/agent/session-store",()=>({createAgentSession:mocks.session}));
vi.mock("@/lib/workflow/graph-engine",()=>({startWorkflowGraph:mocks.start,workflowGraphRunStatus:mocks.status}));
vi.mock("@/lib/mcp/scope",()=>({maxScope:()=>"exec"}));
vi.mock("@/lib/mcp/capability-runtime",()=>({msoCapabilityRuntime:{}}));
vi.mock("@/lib/mcp/tools",()=>({TOOLS_BY_NAME:new Map()}));
const {POST}=await import("./route");
const webhookSecret="w".repeat(16);
const graph={id:"graph1",name:"Fixture"} as never;
const base={principal:"web:aaaaaaaaaaaaaaaa",owner:"owner",graph,node:{id:"hook1",type:"webhook",disabled:false,config:{methods:["POST"],authVariable:"WEBHOOK_TOKEN"}}};
const request=(token?:string,body="{}")=>new NextRequest("https://mso.example/api/v1/workflows/webhook/graph1/hook1",{method:"POST",headers:{"content-type":"application/json",...(token?{authorization:"Bearer "+token}:{})},body});
const ctx={params:Promise.resolve({hook:["graph1","hook1"]})};
beforeEach(()=>{vi.clearAllMocks();mocks.untrusted.mockReturnValue(false);mocks.privileged.mockReturnValue(false);mocks.source.mockResolvedValue(base);mocks.secret.mockResolvedValue(webhookSecret);mocks.authority.mockResolvedValue({principal:base.principal,actor:base.principal,scope:"exec"});mocks.session.mockResolvedValue({id:"20261007_120000_aaaaaaaa"});mocks.start.mockResolvedValue({id:"run1",state:"running"});});
describe("workflow webhook security boundary",()=>{
 it("requires an explicit secret variable",async()=>{mocks.source.mockResolvedValue({...base,node:{...base.node,config:{methods:["POST"]}}});expect((await POST(request(webhookSecret),ctx)).status).toBe(503);expect(mocks.start).not.toHaveBeenCalled();});
 it("authenticates before charging the privileged execution bucket",async()=>{const response=await POST(request("wrong"),ctx);expect(response.status).toBe(401);expect(mocks.privileged).not.toHaveBeenCalled();expect(mocks.start).not.toHaveBeenCalled();});
 it("rate-limits random lookup work before graph discovery",async()=>{mocks.untrusted.mockReturnValueOnce(true);expect((await POST(request(webhookSecret),ctx)).status).toBe(429);expect(mocks.source).not.toHaveBeenCalled();});
 it("bounds the body only after authentication",async()=>{const response=await POST(request(webhookSecret,"x".repeat(70*1024)),ctx);expect(response.status).toBe(413);expect(mocks.start).not.toHaveBeenCalled();});
 it("starts an authenticated owner workflow with live authority",async()=>{const response=await POST(request(webhookSecret),ctx);expect(response.status).toBe(202);expect(mocks.authority).toHaveBeenCalled();expect(mocks.privileged).toHaveBeenCalled();expect(mocks.start).toHaveBeenCalled();});
});
