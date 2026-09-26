import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const {evaluate,verify}=vi.hoisted(()=>({evaluate:vi.fn(),verify:vi.fn()}));
vi.mock("./jev-decision-plane",()=>({createJevDecisionEvaluator:()=>evaluate}));
vi.mock("./jev-services",()=>({verifyActionOutcomeWithJev:verify}));
vi.mock("./jev-telemetry",()=>({recordJevTelemetry:vi.fn(async()=>undefined)}));
import { clearJevActionProposalsForTests, executeJevAction, proposeJevActions } from "./jev-action-layer";
import type { CapabilityTool } from "@/lib/capabilities/tool";
const tool=(name:string,args:Record<string,unknown>={},limit?:CapabilityTool["limit"]):CapabilityTool=>({name,scope:"read",description:name,inputSchema:{type:"object",properties:{mode:{type:"string"},workflow_id:{type:"string"}}},annotations:{readOnlyHint:true,destructiveHint:false},...(limit?{limit}:{}),run:async()=>({ok:true,args})});
beforeEach(()=>{clearJevActionProposalsForTests();evaluate.mockReset();verify.mockReset();evaluate.mockResolvedValue({provider:"jev",probabilities:{a:.95}});verify.mockResolvedValue({verification:"pass",provider:"jev"});});
describe("JEV action execution preserves Capability Runtime authority",()=>{
 it("keeps allowedTools denial effective",async()=>{
  const t=tool("bounded_read"),p=await proposeJevActions({},[{id:"a",tool:t.name,arguments:{},rationale:"read",risk:"safe"}],n=>n===t.name?t:undefined);
  const out=await executeJevAction(p.proposalId,"a",{scope:"read",actor:"jev-auth",context:{scope:"read",allowedTools:[]}},n=>n===t.name?t:undefined);
  expect(out.execution).toMatchObject({kind:"error",message:"tool is not allowed for this token"});
 });
 it("keeps argument constraints effective",async()=>{
  const t=tool("bounded_read",{mode:"bad"}),p=await proposeJevActions({},[{id:"a",tool:t.name,arguments:{mode:"bad"},rationale:"read",risk:"safe"}],n=>n===t.name?t:undefined);
  const out=await executeJevAction(p.proposalId,"a",{scope:"read",actor:"jev-args",context:{scope:"read",toolArgumentConstraints:{bounded_read:{mode:["ok"]}}}},n=>n===t.name?t:undefined);
  expect(out.execution).toMatchObject({kind:"error",message:"tool input is not allowed for this token"});
 });
 it("keeps workflow correlation effective",async()=>{
  const t=tool("bounded_read"),p=await proposeJevActions({},[{id:"a",tool:t.name,arguments:{workflow_id:"missing-jev-workflow"},rationale:"read",risk:"safe"}],n=>n===t.name?t:undefined);
  const out=await executeJevAction(p.proposalId,"a",{scope:"read",actor:"jev-workflow",context:{scope:"read"}},n=>n===t.name?t:undefined);
  expect(out.execution.kind).toBe("error");if(out.execution.kind==="error")expect(out.execution.message).toContain("workflow_id was not found");
 });
 it("keeps rate limits effective",async()=>{
  const t=tool("bounded_read",{}, {key:randomUUID(),max:1,windowMs:60_000}),resolve=(n:string)=>n===t.name?t:undefined;
  const p=await proposeJevActions({},[{id:"a",tool:t.name,arguments:{},rationale:"read",risk:"safe"}],resolve);
  expect((await executeJevAction(p.proposalId,"a",{scope:"read",actor:"jev-rate",context:{scope:"read"}},resolve)).execution.kind).toBe("success");
  const second=await executeJevAction(p.proposalId,"a",{scope:"read",actor:"jev-rate",context:{scope:"read"}},resolve);
  expect(second.execution.kind).toBe("error");if(second.execution.kind==="error")expect(second.execution.message).toContain("rate limited");
 });
});
