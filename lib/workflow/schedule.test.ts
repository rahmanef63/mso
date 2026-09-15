import { describe, expect, it } from "vitest";
import type { WorkflowGraphNode } from "@/lib/contracts/workflow-graph";
import { scheduleBucket } from "./schedule";
const node=(config:Record<string,unknown>):WorkflowGraphNode=>({id:"schedule",name:"Schedule",type:"schedule",position:{x:0,y:0},config});
describe("workflow schedule",()=>{
 it("matches deterministic minute intervals",()=>{const now=new Date("2026-09-15T05:30:00Z");expect(scheduleBucket(node({mode:"interval",everyMinutes:15}),now,"UTC")).toBeTruthy();expect(scheduleBucket(node({mode:"interval",everyMinutes:7}),now,"UTC")).toBeNull();});
 it("matches five-field cron in the configured timezone",()=>{const now=new Date("2026-09-15T05:30:00Z");expect(scheduleBucket(node({mode:"cron",cron:"30 12 * * *",timezone:"Asia/Jakarta"}),now,"UTC")).toContain("Asia/Jakarta");expect(scheduleBucket(node({mode:"cron",cron:"31 12 * * *",timezone:"Asia/Jakarta"}),now,"UTC")).toBeNull();});
 it("rejects malformed cron fields",()=>expect(()=>scheduleBucket(node({mode:"cron",cron:"* * *"}),new Date(),"UTC")).toThrow("5 fields"));
});
