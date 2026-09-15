import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const dir=await mkdtemp(path.join(os.tmpdir(),"mso-workflow-vars-"));process.env.OS_AGENT_SESSIONS_DIR=dir;
const vars=await import("./variables");
afterAll(()=>rm(dir,{recursive:true,force:true}));beforeEach(()=>rm(path.join(dir,".workflow-variables"),{recursive:true,force:true}));
describe("workflow variables",()=>{
 it("keeps values isolated by principal and hides secret values from listings",async()=>{await vars.setWorkflowVariable("alice","PUBLIC_VALUE",{ok:true});await vars.setWorkflowVariable("alice","API_TOKEN","top-secret-value",true);expect(await vars.listWorkflowVariables("alice")).toEqual(expect.arrayContaining([expect.objectContaining({key:"PUBLIC_VALUE",value:{ok:true},secret:false}),expect.not.objectContaining({key:"API_TOKEN",value:"top-secret-value"})]));expect(await vars.workflowVariableValues("bob")).toEqual({});expect(await vars.workflowVariableValues("alice")).toMatchObject({API_TOKEN:"top-secret-value"});});
 it("rejects unsafe keys and oversized values",async()=>{await expect(vars.setWorkflowVariable("alice","bad-key","x")).rejects.toThrow("key");await expect(vars.setWorkflowVariable("alice","BIG","x".repeat(20_000))).rejects.toThrow("invalid");});
});
