import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const dir=await mkdtemp(path.join(os.tmpdir(),"mso-workflow-version-"));process.env.OS_AGENT_SESSIONS_DIR=dir;
const store=await import("./graph-store"),versions=await import("./graph-version-store");afterAll(()=>rm(dir,{recursive:true,force:true}));
const def=(name:string)=>({name,description:"",status:"draft" as const,inputs:{},metadata:{},nodes:[{id:"start",name:"Start",type:"manual" as const,position:{x:0,y:0},config:{}},{id:"out",name:"Out",type:"output" as const,position:{x:200,y:0},config:{}}],edges:[{id:"e",source:"start",target:"out"}]});
describe("workflow graph versions",()=>{it("snapshots creates and updates and can read an older revision",async()=>{const first=await store.createWorkflowGraph("version-owner",def("First")),second=await store.updateWorkflowGraph("version-owner",first.id,first.revision,def("Second"));const owner=store.workflowGraphOwner("version-owner"),history=await versions.listWorkflowGraphVersions(owner,first.id);expect(history.map((row)=>row.revision)).toEqual(expect.arrayContaining([first.revision,second.revision]));expect((await versions.readWorkflowGraphVersion(owner,first.id,first.revision))?.graph.name).toBe("First");});});
