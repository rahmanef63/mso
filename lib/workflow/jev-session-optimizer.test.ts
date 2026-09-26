import { expect, it, vi } from "vitest";
vi.mock("./jev-integration",()=>({resolveJevIntegrationConfig:vi.fn(async()=>({transport:"openrouter",provider:"openrouter",model:"~typesafe/jev-latest"}))}));
vi.mock("./jev-evaluator",()=>({createResolvedJevWorkflowOptimizerEvaluator:vi.fn(()=>async(_state:unknown,candidates:Array<{id:string}>)=>({provider:"jev",probabilities:Object.fromEntries(candidates.map(c=>[c.id,.9]))}))}));
import { optimizeSessionWithJev } from "./jev-session-optimizer";
const action=(ref:string,tool:string)=>({id:ref,ref,eventRef:`E${ref}`,title:ref,category:"implement" as const,at:new Date().toISOString(),kind:"tool",tool,state:"completed"});
it("returns a bounded LLM-consumable JEV packet without executable arguments",async()=>{
 const view:any={session:{id:"s",name:"a",label:"agent-project",title:"Ship feature",source:"mcp",status:"offline",receiverConnected:false,lastSeenAt:"",createdAt:"",eventCount:3,archiveCount:0,cwd:"/project"},graph:{},steps:[{id:"1",ref:"S1",title:"Implement",category:"implement",summary:"work",startedAt:"",finishedAt:"",groups:[],actions:[action("S1.A1","fs_read"),action("S1.A2","fs_read"),action("S1.A3","exec_run")]}],totalEvents:3,shownEvents:3,omittedEvents:0,observedAt:new Date().toISOString()};
 const result=await optimizeSessionWithJev(view);
 expect(result.provider).toBe("jev"); expect(result.recommendations.length).toBeGreaterThan(0); expect(result.llmContext.kind).toBe("mso.jev-session-optimization.v1"); expect(result.llmContext.recommendations.every(row => !Object.hasOwn(row,"arguments"))).toBe(true);
});
