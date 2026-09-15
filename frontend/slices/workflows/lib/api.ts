import type { WorkflowGraph, WorkflowGraphRun, WorkflowGraphStatus } from "@/lib/contracts/workflow-graph";
import type { WorkflowNodeCatalogItem } from "@/lib/workflow/node-catalog";
async function json<T>(input:RequestInfo,init?:RequestInit):Promise<T>{const response=await fetch(input,{...init,cache:"no-store",headers:{"Content-Type":"application/json",...(init?.headers??{})}}),body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(typeof body.error==="string"?body.error:`request failed (${response.status})`);return body as T;}
const post=<T>(body:Record<string,unknown>)=>json<T>("/api/v1/workflows",{method:"POST",body:JSON.stringify(body)});
export async function listGraphs(){return(await json<{graphs:WorkflowGraph[]}>("/api/v1/workflows")).graphs;}
export async function getGraph(id:string){return(await json<{graph:WorkflowGraph}>(`/api/v1/workflows?graph_id=${encodeURIComponent(id)}`)).graph;}
export async function createGraph(graph:unknown){return(await post<{graph:WorkflowGraph}>({action:"create",graph})).graph;}
export async function updateGraph(graph:WorkflowGraph){const{revision,createdAt:_c,updatedAt:_u,version:_v,...definition}=graph;return(await post<{graph:WorkflowGraph}>({action:"update",graph_id:graph.id,expected_revision:revision,graph:definition})).graph;}
export async function deleteGraph(graph:WorkflowGraph){await post({action:"delete",graph_id:graph.id,expected_revision:graph.revision});}
export async function cloneGraph(id:string){return(await post<{graph:WorkflowGraph}>({action:"clone",graph_id:id})).graph;}
export async function runGraph(id:string,input:Record<string,unknown>={}){return post<WorkflowGraphRun&{pollAfterMs?:number}>({action:"run",graph_id:id,input,idempotency_key:`ui-${Date.now()}-${Math.random().toString(36).slice(2,8)}`});}
export async function runStatus(id:string){return json<WorkflowGraphRun&{pollAfterMs?:number}>(`/api/v1/workflows?run_id=${encodeURIComponent(id)}&wait_ms=1500`);}
export async function listRuns(graphId?:string,state?:WorkflowGraphStatus|string,offset=0){const q=new URLSearchParams({runs:"1",limit:"30",offset:String(offset)});if(graphId)q.set("graph_id",graphId);if(state)q.set("state",state);return json<{total:number;runs:Array<Pick<WorkflowGraphRun,"id"|"graphId"|"graphRevision"|"graphName"|"state"|"startedAt"|"updatedAt"|"finishedAt"|"failedNodeId"|"failedNodeName"|"trigger">>;nextOffset?:number}>(`/api/v1/workflows?${q}`);}
export async function listVersions(graphId:string){return(await json<{versions:Array<{revision:string;savedAt:string;reason:string;name:string;nodeCount:number}>}>(`/api/v1/workflows?versions=${encodeURIComponent(graphId)}`)).versions;}
export async function restoreVersion(graph:WorkflowGraph,revision:string){return(await post<{graph:WorkflowGraph}>({action:"restore_version",graph_id:graph.id,expected_revision:graph.revision,revision})).graph;}
export async function listNodeCatalog(query=""){return(await json<{nodes:WorkflowNodeCatalogItem[]}>(`/api/v1/workflows?catalog=1&q=${encodeURIComponent(query)}`)).nodes;}
export async function listTemplates(){return(await json<{templates:Array<{id:string;title:string;description:string;tags:string[];nodeCount:number}>}>("/api/v1/workflows?templates=1")).templates;}
export async function createFromTemplate(id:string){return(await post<{graph:WorkflowGraph}>({action:"create_from_template",template_id:id})).graph;}
export async function listVariables(){return(await json<{variables:Array<{key:string;secret:boolean;updatedAt:string;value?:unknown}>}>("/api/v1/workflows?variables=1")).variables;}
export async function setVariable(key:string,value:unknown,secret=false){return post({action:"variable_set",key,value,secret});}
export async function deleteVariable(key:string){return post({action:"variable_delete",key});}
export async function aiSuggest(prompt:string){return(await post<{definition:Omit<WorkflowGraph,"version"|"id"|"revision"|"createdAt"|"updatedAt">}>({action:"ai_suggest",prompt})).definition;}
export async function resolveNode(graphId:string,nodeId:string){return json<{project:string;name:string;path:string;relativePath:string}>(`/api/v1/workflows?graph_id=${encodeURIComponent(graphId)}&node_id=${encodeURIComponent(nodeId)}&resolve=target`);}
