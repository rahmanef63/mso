import { describe, expect, it } from "vitest";
import type { WorkflowGraph, WorkflowGraphNode } from "@/lib/contracts/workflow-graph";
import { executeFlowNode } from "./graph-flow-nodes";
const make=(type:WorkflowGraphNode["type"],config:Record<string,unknown>={}):WorkflowGraphNode=>({id:type,name:type,type,position:{x:0,y:0},config});
const graph=(node:WorkflowGraphNode,edges:WorkflowGraph["edges"]=[]):WorkflowGraph=>({version:2,id:"g",name:"G",description:"",status:"draft",inputs:{},nodes:[node],edges,metadata:{},createdAt:"2026-01-01T00:00:00Z",updatedAt:"2026-01-01T00:00:00Z",revision:"r"});
describe("workflow flow nodes",()=>{
 it("routes switch handles with default fallback",async()=>{const node=make("switch",{path:"input.kind",cases:[{handle:"alpha",equals:"a"},{handle:"beta",equals:"b"}]});expect((await executeFlowNode(node,node.config,graph(node),{},{input:{kind:"b"}}))?.handles).toEqual(["beta"]);expect((await executeFlowNode(node,node.config,graph(node),{},{input:{kind:"x"}}))?.handles).toEqual(["default"]);});
 it("merges incoming outputs by source",async()=>{const node=make("merge",{mode:"combine"}),g=graph(node,[{id:"a",source:"left",target:"merge"},{id:"b",source:"right",target:"merge"}]);expect((await executeFlowNode(node,node.config,g,{left:{a:1},right:{b:2}},{}))?.output).toEqual({left:{a:1},right:{b:2}});});
 it("splits bounded batches",async()=>{const node=make("batch",{itemsPath:"input.items",size:2}),result=await executeFlowNode(node,node.config,graph(node),{},{input:{items:[1,2,3,4,5]}});expect(result?.output).toMatchObject({count:3,size:2,batches:[[1,2],[3,4],[5]]});});
 it("supports zero-delay wait without timer drift",async()=>{const node=make("wait",{delayMs:0}),result=await executeFlowNode(node,node.config,graph(node),{},{});expect(result?.output).toMatchObject({waitedMs:0});});
});
