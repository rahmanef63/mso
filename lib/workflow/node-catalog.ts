import type { WorkflowGraphNodeType } from "@/lib/contracts/workflow-graph";
export type WorkflowNodeCatalogItem={type:WorkflowGraphNodeType;title:string;category:string;description:string;handles?:string[];defaults:Record<string,unknown>};
export const WORKFLOW_NODE_CATALOG:WorkflowNodeCatalogItem[]=[
 {type:"manual",title:"Manual Trigger",category:"Triggers",description:"Start from UI, CLI or MCP.",defaults:{}},
 {type:"schedule",title:"Schedule Trigger",category:"Triggers",description:"Run by cron or minute interval on the MSO server.",defaults:{mode:"interval",everyMinutes:60}},
 {type:"webhook",title:"Webhook Trigger",category:"Triggers",description:"Public HTTP trigger with optional private-variable bearer auth.",defaults:{methods:["POST"],responseMode:"onReceived"}},
 {type:"condition",title:"If",category:"Flow",description:"Route to true/false handles.",handles:["true","false"],defaults:{path:"input"}},
 {type:"switch",title:"Switch",category:"Flow",description:"Route by multiple case handles plus default.",defaults:{path:"input",cases:[]}},
 {type:"merge",title:"Merge",category:"Flow",description:"Merge enabled incoming node outputs.",defaults:{mode:"combine"}},
 {type:"batch",title:"Split In Batches",category:"Flow",description:"Chunk an array into deterministic batches.",defaults:{size:10}},
 {type:"loop",title:"Loop Over Items",category:"Flow",description:"Run one bounded tool once per item without cyclic graph edges.",defaults:{concurrency:1}},
 {type:"wait",title:"Wait",category:"Flow",description:"Delay execution or wait until a timestamp within run timeout.",defaults:{delayMs:1000}},
 {type:"tool",title:"MSO Tool",category:"Actions",description:"Call one bounded MSO capability tool.",defaults:{}},
 {type:"project_function",title:"Project Function",category:"Actions",description:"Call a project-owned function.",defaults:{}},
 {type:"project_mcp",title:"Project MCP",category:"Actions",description:"Call a project-owned MCP tool.",defaults:{}},
 {type:"integration",title:"Integration",category:"Actions",description:"Execute through an existing MSO integration connection; credentials stay outside the graph.",defaults:{}},
 {type:"script",title:"Script",category:"Actions",description:"Run a learned RASMIC script.",defaults:{}},
 {type:"agent",title:"Agent",category:"AI",description:"Run a focused project agent action.",defaults:{wait:true,max_scope:"write"}},
 {type:"subflow",title:"Subflow",category:"Flow",description:"Run an existing project flow.",defaults:{}},
 {type:"project",title:"Project",category:"Context",description:"Resolve canonical project identity/path at runtime.",defaults:{}},
 {type:"folder",title:"Folder",category:"Context",description:"Resolve a real folder inside a canonical project.",defaults:{path:"."}},
 {type:"skill",title:"Skill",category:"Context",description:"Search trusted skill catalog with provenance.",defaults:{}},
 {type:"knowledge",title:"Knowledge",category:"Context",description:"Read project knowledge or memory.",defaults:{}},
 {type:"output",title:"Output",category:"Flow",description:"Collect workflow output.",defaults:{}},
];
export function workflowNodeCatalog(query=""){const q=query.trim().toLowerCase();return WORKFLOW_NODE_CATALOG.filter((item)=>!q||`${item.type} ${item.title} ${item.category} ${item.description}`.toLowerCase().includes(q));}
