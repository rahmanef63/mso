import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
let dir="";
beforeEach(async()=>{dir=await fs.mkdtemp(path.join(os.tmpdir(),"mso-jev-telemetry-"));process.env.OS_JEV_TELEMETRY_STORE=path.join(dir,"private","jev.json");vi.resetModules();});
afterEach(async()=>{delete process.env.OS_JEV_TELEMETRY_STORE;await fs.rm(dir,{recursive:true,force:true});});
describe("JEV telemetry",()=>{
 it("keeps actual provider usage separate from estimated avoided impact and records decision version",async()=>{
  const t=await import("./jev-telemetry");
  await t.recordJevTelemetry({event:"decision",decisionId:"session.optimize",decisionVersion:2,decisionType:"noul",candidateCount:4,selected:["handoff-packet"],threshold:.5,actual:{inputTokens:120,costUsd:.00002}});
  await t.recordJevTelemetry({event:"impact",decisionId:"context.admit",decisionVersion:1,decisionType:"noul",estimated:{llmAvoided:true,modelAvoided:"frontier-x",inputTokensAvoided:900,costAvoidedUsd:.02,latencyMsAvoided:1500}});
  const w=await t.readJevTelemetryWindows();
  expect(w.days30.actual).toMatchObject({jevInputTokens:120,jevCostUsd:.00002});
  expect(w.days30.estimated).toMatchObject({frontierCallsAvoided:1,inputTokensAvoided:900,costAvoidedUsd:.02,latencyMsAvoided:1500});
  const raw=await fs.readFile(process.env.OS_JEV_TELEMETRY_STORE!,"utf8");
  expect(raw).toContain('"decisionVersion":2');
  expect(raw).not.toContain('"jevCostUsd"');
 });
 it("redacts secret-shaped values and prunes telemetry older than 30 days",async()=>{
  const t=await import("./jev-telemetry");
  await t.recordJevTelemetry({event:"decision",timestamp:new Date(Date.now()-31*24*60*60_000).toISOString(),decisionId:"session.optimize",decisionVersion:1,decisionType:"noul",selected:["sk-abcdefghijklmnopqrstuvwxyz"],model:"Bearer abcdefghijklmnop"});
  await t.recordJevTelemetry({event:"decision",decisionId:"session.optimize",decisionVersion:1,decisionType:"noul",selected:["safe"]});
  const raw=await fs.readFile(process.env.OS_JEV_TELEMETRY_STORE!,"utf8");
  expect(raw).not.toContain("abcdefghijklmnopqrstuvwxyz");
  expect(raw).not.toContain("Bearer abcdefghijklmnop");
  expect(JSON.parse(raw).events).toHaveLength(1);
 });
});
