import { beforeEach, describe, expect, it, vi } from "vitest";
const {getSessionContext,getKey,readWindows,readCalibration,routeModel}=vi.hoisted(()=>({
  getSessionContext:vi.fn(),getKey:vi.fn(),readWindows:vi.fn(),readCalibration:vi.fn(),routeModel:vi.fn(),
}));
vi.mock("@/lib/auth/require-session",()=>({getSessionContext}));
vi.mock("@/lib/config/store",()=>({hostCredentialStore:()=>({getKey})}));
vi.mock("@/lib/workflow/jev-telemetry",()=>({readJevTelemetryWindows:readWindows,readJevCalibration:readCalibration}));
vi.mock("@/lib/agent/session-jev-preservation",()=>({jevPreservationStatus:vi.fn(async()=>({model:"~typesafe/jev-latest",credentialSource:"settings-ai/openrouter",openrouterConnected:true,liveSessions:3,archives:0,preservedLive:3,preservedArchives:0,pending:0}))}));
vi.mock("@/lib/workflow/jev-services",()=>({
  routeModelWithJev:routeModel,
  budgetContextWithJev:vi.fn(),classifyMemoryAdmissionWithJev:vi.fn(),triageFailureWithJev:vi.fn(),assessRecipePromotionWithJev:vi.fn(),verifyActionOutcomeWithJev:vi.fn(),
}));
const {GET,POST}=await import("./route");
beforeEach(()=>{getSessionContext.mockReset();getKey.mockReset();readWindows.mockReset();readCalibration.mockReset();routeModel.mockReset();getSessionContext.mockResolvedValue({role:"owner",session:{device_id:"dev-1"}});getKey.mockResolvedValue("never-return-me");readWindows.mockResolvedValue({today:{totalDecisions:1},days7:{totalDecisions:2},days30:{totalDecisions:3}});readCalibration.mockResolvedValue([]);routeModel.mockResolvedValue({kind:"mso.jev-decision.v1",route:"no-llm"});});
describe("owner JEV control plane",()=>{
 it("reports connection boolean and telemetry without exposing the OpenRouter key",async()=>{const r=await GET(),body=await r.json();expect(r.status).toBe(200);expect(body).toMatchObject({kind:"mso.jev-control-plane.v1",openrouterConnected:true,windows:{days30:{totalDecisions:3}},preservation:{liveSessions:3,preservedLive:3,pending:0}});expect(JSON.stringify(body)).not.toContain("never-return-me");});
 it("runs a bounded lab decision without executing tools",async()=>{const req=new Request("http://mso.test/api/v1/jev",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({decision_id:"model.route",state:{task:"route this"}})});const r=await POST(req as never);expect(r.status).toBe(200);expect(await r.json()).toMatchObject({route:"no-llm"});expect(routeModel).toHaveBeenCalledWith({task:"route this"},undefined,{correlationId:"web:dev-1"});});
 it("fails closed for non-owner callers",async()=>{getSessionContext.mockResolvedValue({role:"operator",session:{device_id:"dev-2"}});expect((await GET()).status).toBe(403);const req=new Request("http://mso.test/api/v1/jev",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});expect((await POST(req as never)).status).toBe(403);});
});
