import { describe, expect, it } from "vitest";
import { compileJevState, estimateJevTokens } from "./jev-state-compiler";
import { getJevDecisionDefinition, listJevDecisionDefinitions } from "./jev-decision-registry";
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
});
