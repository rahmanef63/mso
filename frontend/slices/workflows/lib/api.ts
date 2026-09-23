import type { SessionGraphView, SessionPage } from "@/lib/contracts/session-monitor";
import type { WorkflowGraph, WorkflowGraphRun, WorkflowGraphStatus } from "@/lib/contracts/workflow-graph";
import type { WorkflowNodeCatalogItem } from "@/lib/workflow/node-catalog";
import { cachedWorkflowResource, invalidateWorkflowResources, seedWorkflowResource } from "./resource-cache";
async function json<T>(input:RequestInfo,init?:RequestInit):Promise<T>{const response=await fetch(input,{...init,cache:"no-store",headers:{"Content-Type":"application/json",...(init?.headers??{})}}),body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(typeof body.error==="string"?body.error:`request failed (${response.status})`);return body as T;}
const post=<T>(body:Record<string,unknown>)=>json<T>("/api/v1/workflows",{method:"POST",body:JSON.stringify(body)});
export async function listGraphs(force=false){const load=async()=> (await json<{graphs:WorkflowGraph[]}>("/api/v1/workflows")).graphs;return force?load():cachedWorkflowResource("graphs",4000,load);}
export async function getGraph(id:string,force=false){const key=`graph:${id}`,load=async()=> (await json<{graph:WorkflowGraph}>(`/api/v1/workflows?graph_id=${encodeURIComponent(id)}`)).graph;return force?load():cachedWorkflowResource(key,8000,load);}
export async function createGraph(graph:unknown){const next=(await post<{graph:WorkflowGraph}>({action:"create",graph})).graph;invalidateWorkflowResources("graphs");seedWorkflowResource(`graph:${next.id}`,next,8000);return next;}
export async function updateGraph(graph:WorkflowGraph){const{revision,createdAt:_c,updatedAt:_u,version:_v,...definition}=graph,next=(await post<{graph:WorkflowGraph}>({action:"update",graph_id:graph.id,expected_revision:revision,graph:definition})).graph;invalidateWorkflowResources("graphs");seedWorkflowResource(`graph:${next.id}`,next,8000);return next;}
export async function deleteGraph(graph:WorkflowGraph){await post({action:"delete",graph_id:graph.id,expected_revision:graph.revision});invalidateWorkflowResources();}
export async function cloneGraph(id:string){const next=(await post<{graph:WorkflowGraph}>({action:"clone",graph_id:id})).graph;invalidateWorkflowResources("graphs");seedWorkflowResource(`graph:${next.id}`,next,8000);return next;}
export async function runGraph(id:string,input:Record<string,unknown>={}){return post<WorkflowGraphRun&{pollAfterMs?:number}>({action:"run",graph_id:id,input,idempotency_key:`ui-${Date.now()}-${Math.random().toString(36).slice(2,8)}`});}
export async function runStatus(id:string){return json<WorkflowGraphRun&{pollAfterMs?:number}>(`/api/v1/workflows?run_id=${encodeURIComponent(id)}&wait_ms=1500`);}
export async function stopRun(id:string){return post<WorkflowGraphRun&{stopRequested?:boolean}>({action:"run_stop",run_id:id});}
export async function retryRun(id:string){return post<WorkflowGraphRun&{pollAfterMs?:number}>({action:"run_retry",run_id:id,idempotency_key:`ui-retry-${Date.now()}-${Math.random().toString(36).slice(2,8)}`});}
export async function deleteRun(id:string){return post<{id:string;deleted:boolean}>({action:"run_delete",run_id:id});}
export async function listRuns(graphId?:string,state?:WorkflowGraphStatus|string,offset=0){const q=new URLSearchParams({runs:"1",limit:"30",offset:String(offset)});if(graphId)q.set("graph_id",graphId);if(state)q.set("state",state);return json<{total:number;runs:Array<Pick<WorkflowGraphRun,"id"|"graphId"|"graphRevision"|"graphName"|"state"|"startedAt"|"updatedAt"|"finishedAt"|"failedNodeId"|"failedNodeName"|"trigger">>;nextOffset?:number}>(`/api/v1/workflows?${q}`);}
export async function listVersions(graphId:string){return(await json<{versions:Array<{revision:string;savedAt:string;reason:string;name:string;nodeCount:number}>}>(`/api/v1/workflows?versions=${encodeURIComponent(graphId)}`)).versions;}
export async function restoreVersion(graph:WorkflowGraph,revision:string){return(await post<{graph:WorkflowGraph}>({action:"restore_version",graph_id:graph.id,expected_revision:graph.revision,revision})).graph;}
export async function listNodeCatalog(query=""){return cachedWorkflowResource(`catalog:${query}`,60000,async()=> (await json<{nodes:WorkflowNodeCatalogItem[]}>(`/api/v1/workflows?catalog=1&q=${encodeURIComponent(query)}`)).nodes);}
export async function listTemplates(){return cachedWorkflowResource("templates",60000,async()=> (await json<{templates:Array<{id:string;title:string;description:string;tags:string[];nodeCount:number}>}>("/api/v1/workflows?templates=1")).templates);}
export async function createFromTemplate(id:string){return(await post<{graph:WorkflowGraph}>({action:"create_from_template",template_id:id})).graph;}
export async function listVariables(){return(await json<{variables:Array<{key:string;secret:boolean;updatedAt:string;value?:unknown}>}>("/api/v1/workflows?variables=1")).variables;}
export async function setVariable(key:string,value:unknown,secret=false){return post({action:"variable_set",key,value,secret});}
export async function deleteVariable(key:string){return post({action:"variable_delete",key});}
export type WorkflowDataTableSummary={id:string;name:string;columns:string[];rowCount:number;createdAt:string;updatedAt:string};
export type WorkflowDataTableRow={id:string;values:Record<string,unknown>;createdAt:string;updatedAt:string};
export type WorkflowDataTable={id:string;name:string;columns:string[];rows:WorkflowDataTableRow[];createdAt:string;updatedAt:string};
export async function listDataTables(){return(await json<{tables:WorkflowDataTableSummary[]}>("/api/v1/workflows?data_tables=1")).tables;}
export async function getDataTable(id:string){return(await json<{table:WorkflowDataTable}>(`/api/v1/workflows?data_table=${encodeURIComponent(id)}`)).table;}
export async function createDataTable(name:string,columns:string[]){return(await post<{table:WorkflowDataTable}>({action:"data_table_create",name,columns})).table;}
export async function deleteDataTable(id:string){return post<{id:string;deleted:boolean}>({action:"data_table_delete",table_id:id});}
export async function upsertDataTableRow(tableId:string,values:Record<string,unknown>,rowId?:string){return(await post<{row:WorkflowDataTableRow}>({action:"data_table_row_upsert",table_id:tableId,...(rowId?{row_id:rowId}:{}),values})).row;}
export async function deleteDataTableRow(tableId:string,rowId:string){return post<{tableId:string;rowId:string;deleted:boolean}>({action:"data_table_row_delete",table_id:tableId,row_id:rowId});}
export async function aiSuggest(prompt:string){return(await post<{definition:Omit<WorkflowGraph,"version"|"id"|"revision"|"createdAt"|"updatedAt">}>({action:"ai_suggest",prompt})).definition;}
export async function resolveNode(graphId:string,nodeId:string){return json<{project:string;name:string;path:string;relativePath:string}>(`/api/v1/workflows?graph_id=${encodeURIComponent(graphId)}&node_id=${encodeURIComponent(nodeId)}&resolve=target`);}

export async function listWorkflowSessions(page=1,query=""){const q=new URLSearchParams({view:"monitor",includeOffline:"1",page:String(page)});if(query.trim())q.set("q",query.trim());return json<SessionPage>(`/api/v1/agent-sessions?${q}`);}
export async function getSessionGraph(id:string){return json<SessionGraphView>(`/api/v1/agent-sessions?view=graph&id=${encodeURIComponent(id)}&limit=120`);}

export type SessionArtifactHistoryView = {
  capture:{state:"legacy"|"captured";exactAtCapture:boolean;sha256?:string;bytes?:number;gitHead?:string;gitBlob?:string};
  current:{available:boolean;path?:string;sha256?:string;bytes?:number;matchesCapture?:boolean};
  historical:{available:boolean;exact?:true;source?:"git-blob"|"current-match";sha256?:string;bytes?:number;blobOid?:string;content?:string;previewRedacted?:boolean;truncated?:boolean;reason?:string};
  diff:{available:boolean;changed?:boolean;unifiedDiff?:string;previewRedacted?:boolean;reason?:string};
};
export type SessionArtifactHistoryResponse = {artifact:{ref:string;revisionRef:string;path:string;relativePath:string;label:string;kind:"file"|"script";language?:string};history:SessionArtifactHistoryView};
export async function getSessionArtifactHistory(id:string,actionRef:string){const q=new URLSearchParams({view:"artifact",id,action_ref:actionRef});return json<SessionArtifactHistoryResponse>(`/api/v1/agent-sessions?${q}`);}

export type WorkflowDirectory = {
  tools:Array<{name:string;description:string;scope:string;inputSchema:Record<string,unknown>}>;
  workflows:Array<{id:string;name:string;status:string;nodeCount:number;updatedAt:string}>;
  sessions:Array<{id:string;label?:string;title:string;name:string;updatedAt:string;cwd?:string;source:string}>;
  projects:Array<{id:string;name:string;packageName?:string;packageVersion?:string;branch?:string;head?:string}>;
  skills:Array<{id:string;name:string;description:string;source:string;trust:string;project?:string}>;
};
export async function listWorkflowDirectory(query=""){return cachedWorkflowResource(`directory:${query}`,15000,()=>json<WorkflowDirectory>(`/api/v1/workflows?directory=1&q=${encodeURIComponent(query)}`));}

export type WorkflowScriptSummary = { id:string; intent:string; status:"candidate"|"tested"; stepCount:number; updatedAt:string; project?:string; tools:string[] };
export async function listWorkflowScripts(project:string,query=""){const q=new URLSearchParams({scripts:"1",project});if(query.trim())q.set("q",query.trim());return cachedWorkflowResource(`scripts:${project}:${query}`,15000,async()=> (await json<{project:string;scripts:WorkflowScriptSummary[]}>(`/api/v1/workflows?${q}`)).scripts);}

export type WorkflowLearningRecipeSummary = {
  id:string; intent:string; project?:string; maturity:"observed"|"candidate"|"verified"; stage:"observed"|"candidate"|"verified"|"tested";
  scriptStatus?:"candidate"|"tested"; attempts:number; successes:number; failures:number; successRate:number; fastestDurationMs?:number; updatedAt:string;
  sourceSessions:Array<{label:string;actionRef:string;eventRef:string;artifactRefs:string[]}>; forge:{eligible:boolean;promotion:"explicit"};
};
export async function listWorkflowLearning(force=false){const load=async()=> (await json<{recipes:WorkflowLearningRecipeSummary[]}>("/api/v1/workflows?learning=1")).recipes;return force?load():cachedWorkflowResource("learning",10000,load);}
export async function saveSessionWorkflowDraft(id:string,stepRef?:string){
  const next=(await json<{graph:WorkflowGraph}>("/api/v1/agent-sessions",{method:"POST",body:JSON.stringify({action:"save-workflow-draft",id,...(stepRef?{step_ref:stepRef}:{})})})).graph;
  invalidateWorkflowResources("graphs"); seedWorkflowResource(`graph:${next.id}`,next,8000); return next;
}
