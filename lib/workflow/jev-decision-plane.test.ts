import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({evaluate:vi.fn(),record:vi.fn()}));
vi.mock("./jev-integration",()=>({resolveJevIntegrationConfig:vi.fn(async()=>({transport:"openrouter",provider:"openrouter",model:"typesafe/jev-1.13"}))}));
vi.mock("./jev-openrouter",()=>({evaluateOpenRouterJev:mocks.evaluate}));
vi.mock("./jev-telemetry",()=>({recordJevTelemetry:mocks.record}));
import { compileJevState, estimateJevTokens } from "./jev-state-compiler";
import { getJevDecisionDefinition, listJevDecisionDefinitions } from "./jev-decision-registry";
import { runJevChoice, runJevNoul, runJevScore } from "./jev-decision-plane";
beforeEach(()=>{mocks.evaluate.mockReset();mocks.record.mockReset();mocks.record.mockResolvedValue(undefined);});
describe("JEV decision registry and state compiler",()=>{
 it("keeps decision policy versioned and decision-specific",()=>{
  expect(getJevDecisionDefinition("action.select")).toMatchObject({version:1,type:"noul",threshold:.65,telemetryPolicy:"metadata-only"});
  expect(getJevDecisionDefinition("memory.admit").threshold).not.toBe(getJevDecisionDefinition("session.optimize").threshold);
  expect(listJevDecisionDefinitions().map(x=>x.id)).toContain("failure.triage");
 });
 it("removes credential-shaped keys and bounds oversized state",()=>{
  const state=compileJevState({ok:"yes",apiKey:"do-not-send",nested:{authorization:"Bearer do-not-send",note:"safe"},large:"x".repeat(40_000)});
  const json=JSON.stringify(state);
  expect(json).toContain("safe");
  expect(json).not.toContain("do-not-send");
  expect(Buffer.byteLength(json,"utf8")).toBeLessThanOrEqual(24*1024+512);
  expect(estimateJevTokens({a:"abcd"})).toBeGreaterThan(0);
 });
 it("rejects malformed provider decisions at the decision-plane boundary",async()=>{
  const envelope=(decision:unknown)=>({model:"typesafe/jev-1.13",provider:"TypeSafe",answers:{decision},latencyMs:1});
  mocks.evaluate.mockResolvedValueOnce(envelope({type:"choice",choice:"invented",probabilities:{invented:1},confidence:1}));
  await expect(runJevChoice("model.route",{})).rejects.toThrow("invalid choice answer");
  mocks.evaluate.mockResolvedValueOnce(envelope({type:"noul",noul:"yes"}));
  await expect(runJevNoul("action.verify",{})).rejects.toThrow("invalid noul answer");
  mocks.evaluate.mockResolvedValueOnce(envelope({type:"score",score:5,probabilities:{0:0,1:0,2:0,3:0,4:1},confidence:1}));
  await expect(runJevScore("recipe.promote",{})).rejects.toThrow("invalid score answer");
 });
});
