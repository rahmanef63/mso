import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowOptimizerCandidate } from "./graph-optimizer";
const getKey=vi.fn(),safeProviderFetch=vi.fn();
vi.mock("@/lib/config/store",()=>({hostCredentialStore:()=>({getKey})}));
vi.mock("@/lib/host/ssrf",()=>({safeProviderFetch}));
const {createOpenRouterJevWorkflowOptimizerEvaluator}=await import("./jev-openrouter");
const candidate=(id:string):WorkflowOptimizerCandidate=>({id,kind:"presentation-group",title:`Candidate ${id}`,description:"Improve a bounded route.",nodeIds:["a","b"],risk:"safe",estimatedNodeDelta:1,hostEligible:true});
beforeEach(()=>{getKey.mockReset();safeProviderFetch.mockReset();});
describe("OpenRouter Jev evaluator",()=>{
 it("reuses the Settings AI OpenRouter key and Decisions API without exposing it in state",async()=>{
  getKey.mockResolvedValue("private-key");
  safeProviderFetch.mockResolvedValue(new Response(JSON.stringify({model:"typesafe/jev-1.13",answers:{q1:{type:"noul",noul:.93}},usage:{input_tokens:123}}),{status:200,headers:{"content-type":"application/json"}}));
  const result=await createOpenRouterJevWorkflowOptimizerEvaluator()({workflow:{nodeCount:2}},[candidate("c1")]);
  expect(result).toEqual({provider:"jev",probabilities:{c1:.93}});
  expect(getKey).toHaveBeenCalledWith(undefined,"openrouter");
  const [url,init]=safeProviderFetch.mock.calls[0];expect(url).toBe("https://openrouter.ai/api/alpha/decisions");
  const body=JSON.parse(String(init.body));expect(body.model).toBe("~typesafe/jev-latest");expect(body.state).toEqual({workflow:{nodeCount:2}});expect(JSON.stringify(body)).not.toContain("private-key");
  expect(init.headers.authorization).toBe("Bearer private-key");
 });
 it("uses no token and does not require an OpenRouter key when there is no decision candidate",async()=>{getKey.mockResolvedValue(null);await expect(createOpenRouterJevWorkflowOptimizerEvaluator()({},[])).resolves.toEqual({provider:"jev",probabilities:{}});expect(getKey).not.toHaveBeenCalled();expect(safeProviderFetch).not.toHaveBeenCalled();});
 it("fails closed when OpenRouter is not connected",async()=>{getKey.mockResolvedValue(null);await expect(createOpenRouterJevWorkflowOptimizerEvaluator()({},[candidate("c1")])).rejects.toThrow("OpenRouter is not connected");expect(safeProviderFetch).not.toHaveBeenCalled();});
});
