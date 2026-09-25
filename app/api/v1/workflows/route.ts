import { discoverOwnerGraphs, cloneOwnerGraph } from "@/lib/workflow/owner-discovery";
import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { roleAtLeast } from "@/lib/auth/roles";
import { createAgentSession, listAgentSessions } from "@/lib/agent/session-store";
import { agentSessionLabel } from "@/lib/agent/session-name";
import { readSetupJson } from "@/lib/infra/setup-http";
import { rateLimited } from "@/lib/host/limits-api";
import { maxScope } from "@/lib/mcp/scope";
import { TOOLS_BY_NAME } from "@/lib/mcp/tools";
import { msoCapabilityRuntime } from "@/lib/mcp/capability-runtime";
import { listProjects } from "@/lib/host/projects-api";
import { catalogSkillsDetailed } from "@/lib/skills/catalog";
import { cloneWorkflowGraph, createWorkflowGraph, deleteWorkflowGraph, getWorkflowGraph, listWorkflowGraphs, updateWorkflowGraph, workflowGraphOwner } from "@/lib/workflow/graph-store";
import { requestWorkflowGraphStop, startWorkflowGraph, workflowGraphRunStatus } from "@/lib/workflow/graph-engine";
import { deleteWorkflowGraphRun, listWorkflowGraphRuns, readWorkflowGraphRun } from "@/lib/workflow/graph-run-store";
import { listWorkflowGraphVersions, readWorkflowGraphVersion } from "@/lib/workflow/graph-version-store";
import { resolveWorkflowGraphNodeTarget } from "@/lib/workflow/graph-target";
import { deleteWorkflowVariable, listWorkflowVariables, setWorkflowVariable } from "@/lib/workflow/variables";
import { workflowNodeCatalog } from "@/lib/workflow/node-catalog";
import { workflowTemplate, workflowTemplates } from "@/lib/workflow/templates";
import { suggestWorkflowGraph } from "@/lib/workflow/ai-assist";
import { workflowMatchesQuery } from "@/lib/workflow/search";
import { resolveProjectHint } from "@/lib/host/projects-api";
import { listAutomationScripts, readAutomationScript } from "@/lib/orchestration/repo-memory-artifacts";
import { listLearnedRecipes, recipeMaturity } from "@/lib/workflow";
import { createWorkflowDataTable, deleteWorkflowDataTable, deleteWorkflowDataTableRow, getWorkflowDataTable, listWorkflowDataTables, upsertWorkflowDataTableRow } from "@/lib/workflow/data-table-store";
import { optimizeWorkflowGraph } from "@/lib/workflow/graph-optimizer";
import { createJevWorkflowOptimizerEvaluator } from "@/lib/workflow/jev-optimizer";
import { resolveJevIntegrationConfig } from "@/lib/workflow/jev-integration";
export const runtime="nodejs";export const dynamic="force-dynamic";const headers={"Cache-Control":"no-store, private"};
const fail=(error:unknown,status=400)=>NextResponse.json({error:error instanceof Error?error.message.slice(0,500):String(error).slice(0,500)||"workflow request failed"},{status,headers});
async function auth(minimum:"viewer"|"operator"|"owner"="viewer"){const context=await getSessionContext();if(!context?.session.device_id||!roleAtLeast(context.role,minimum))return null;return{context,principal:`web:${context.session.device_id}`};}
function definition(graph:NonNullable<Awaited<ReturnType<typeof getWorkflowGraph>>>){const{revision:_r,createdAt:_c,updatedAt:_u,version:_v,...rest}=graph;return rest;}
export async function GET(req:NextRequest){const q=req.nextUrl.searchParams,minimum=(q.has("variables")||q.has("data_tables")||q.has("data_table"))?"operator":"viewer",session=await auth(minimum);if(!session)return fail("unauthorized",401);try{
 if(q.get("owner_view")==="1"){if(session.context.role!=="owner")return fail("owner_required",403);return NextResponse.json(await discoverOwnerGraphs(session.context.role,session.principal,Number(q.get("owner_offset"))||0),{headers});}
 if(q.get("directory")==="1"){
  const query=(q.get("q")??"").toLowerCase().trim(),tools=msoCapabilityRuntime.list(maxScope()).filter((tool)=>!query||`${tool.name} ${tool.description} ${tool.scope}`.toLowerCase().includes(query)).slice(0,150);
  const operator=roleAtLeast(session.context.role,"operator");
  const [graphs,sessions,projectResult,skillResult]=await Promise.all([listWorkflowGraphs(session.principal),listAgentSessions(session.principal,50),operator?listProjects({query:query||undefined,limit:100}):Promise.resolve(null),operator?catalogSkillsDetailed():Promise.resolve(null)]);
  const projects=projectResult?.projects.map((row)=>({id:row.id,name:row.name,...(row.packageName?{packageName:row.packageName}:{}),...(row.packageVersion?{packageVersion:row.packageVersion}:{}),...(row.git?.branch?{branch:row.git.branch}:{}),...(row.git?.head?{head:row.git.head}:{})}))??[];
  const skills=skillResult?.skills.filter((row)=>!query||`${row.id} ${row.name} ${row.description} ${row.source} ${row.trust} ${row.project?.name??""}`.toLowerCase().includes(query)).slice(0,150).map((row)=>({id:row.id,name:row.name,description:row.description,source:row.source,trust:row.trust,...(row.project?{project:row.project.name}:{})}))??[];
  return NextResponse.json({tools,workflows:graphs.filter((graph)=>!query||`${graph.name} ${graph.description} ${(graph.metadata.tags??[]).join(" ")}`.toLowerCase().includes(query)).map((graph)=>({id:graph.id,name:graph.name,status:graph.status,nodeCount:graph.nodes.length,updatedAt:graph.updatedAt})),sessions:sessions.filter((row)=>!query||`${agentSessionLabel(row.name,row.title,row.cwd)} ${row.title} ${row.name} ${row.cwd??""}`.toLowerCase().includes(query)).map((row)=>({...row,label:agentSessionLabel(row.name,row.title,row.cwd)})),projects,skills},{headers});
 }
 if(q.get("scripts")==="1"){const hint=q.get("project")?.trim();if(!hint)throw new Error("project is required");const project=await resolveProjectHint(hint);if(!project||project.matchedBy==="fuzzy")throw new Error("exact project not found");const query=(q.get("q")??"").toLowerCase().trim(),scripts=(await listAutomationScripts(project.path)).filter((script)=>!query||`${script.id} ${script.intent} ${script.status} ${script.steps.map((step)=>step.tool).join(" ")}`.toLowerCase().includes(query)).map((script)=>({id:script.id,intent:script.intent,status:script.status,stepCount:script.steps.length,updatedAt:script.updatedAt,project:script.project,tools:script.steps.map((step)=>step.tool)}));return NextResponse.json({project:project.id,scripts},{headers});}
 if(q.get("learning")==="1"){if(!roleAtLeast(session.context.role,"owner"))return fail("owner_required",403);const recipes=(await listLearnedRecipes({ownerView:true})).slice(0,100);const rows=await Promise.all(recipes.map(async(recipe)=>{const maturity=recipeMaturity(recipe),sources=[...new Map(recipe.bestSteps.map((step)=>step.provenance).filter(Boolean).map((source)=>[source!.sessionLabel,source!])).values()];let scriptStatus:"candidate"|"tested"|undefined;if(recipe.project){const project=await resolveProjectHint(recipe.project).catch(()=>null);if(project&&project.matchedBy!=="fuzzy")scriptStatus=(await readAutomationScript(project.path,`script_${recipe.id}`).catch(()=>null))?.status;}return{id:recipe.id,intent:recipe.intent,project:recipe.project,maturity:maturity.maturity,stage:scriptStatus==="tested"?"tested":maturity.maturity,scriptStatus,attempts:recipe.attempts,successes:recipe.successes,failures:recipe.failures,successRate:Math.round(maturity.successRate*1000)/10,fastestDurationMs:recipe.fastestDurationMs,updatedAt:recipe.updatedAt,sourceSessions:sources.map((source)=>({label:source.sessionLabel,actionRef:source.actionRef,eventRef:source.eventRef,artifactRefs:source.artifactRefs??[]})),forge:{eligible:recipe.qualityVersion===1&&recipe.successes>=2&&recipe.attempts>0&&recipe.successes/recipe.attempts>=0.9&&recipe.bestSteps.length>0&&recipe.bestSteps.every((step)=>step.state==="completed"),promotion:"explicit" as const}};}));return NextResponse.json({recipes:rows},{headers});}
 if(q.get("catalog")==="1")return NextResponse.json({nodes:workflowNodeCatalog(q.get("q")??"")},{headers});
 if(q.get("templates")==="1")return NextResponse.json({templates:workflowTemplates()},{headers});
 if(q.get("variables")==="1")return NextResponse.json({variables:await listWorkflowVariables(session.principal)},{headers});
 if(q.get("data_tables")==="1")return NextResponse.json({tables:await listWorkflowDataTables(session.principal)},{headers});
 if(q.has("data_table"))return NextResponse.json({table:await getWorkflowDataTable(session.principal,q.get("data_table"))},{headers});
 if(q.get("runs")==="1")return NextResponse.json(await listWorkflowGraphRuns(workflowGraphOwner(session.principal),{graphId:q.get("graph_id")||undefined,state:(q.get("state")||undefined) as never,limit:Number(q.get("limit"))||30,offset:Number(q.get("offset"))||0}),{headers});
 if(q.has("versions")){const graphId=q.get("versions")!;return NextResponse.json({versions:await listWorkflowGraphVersions(workflowGraphOwner(session.principal),graphId)},{headers});}
 if(q.has("run_id"))return NextResponse.json(await workflowGraphRunStatus(session.principal,q.get("run_id")!,Number(q.get("wait_ms"))||0),{headers});
 if(q.has("graph_id")&&q.has("node_id")&&q.get("resolve")==="target"){const graph=await getWorkflowGraph(session.principal,q.get("graph_id")!);if(!graph)throw new Error("workflow graph not found");return NextResponse.json(await resolveWorkflowGraphNodeTarget(graph,q.get("node_id")!),{headers});}
 if(q.has("graph_id")){const graph=await getWorkflowGraph(session.principal,q.get("graph_id")!);if(!graph)return fail("workflow graph not found",404);return NextResponse.json({graph},{headers});}
 const graphs=await listWorkflowGraphs(session.principal),query=q.get("q")??"",filters={tag:q.get("tag")||undefined,status:q.get("status")||undefined,project:q.get("project")||undefined,folder:q.get("folder")||undefined,node:q.get("node")||undefined}; return NextResponse.json({graphs:graphs.filter((graph)=>workflowMatchesQuery(graph,query,filters))},{headers});
 }catch(error){return fail(error);}}
export async function POST(req:NextRequest){const session=await auth("operator");if(!session)return fail("operator_required",403);try{const body=await readSetupJson(req),action=typeof body.action==="string"?body.action:"";if(rateLimited(`workflow:${action}:${session.context.session.device_id}`,action==="run"?60:30,60_000))return fail("rate_limited",429);
 if(action==="owner_clone"){if(session.context.role!=="owner")return fail("owner_required",403);return NextResponse.json({graph:await cloneOwnerGraph(session.context.role,session.principal,String(body.origin_owner??""),String(body.graph_id??""))},{headers});}
 if(action==="create")return NextResponse.json({graph:await createWorkflowGraph(session.principal,body.graph,"create",{remember:true})},{headers});
 if(action==="update")return NextResponse.json({graph:await updateWorkflowGraph(session.principal,String(body.graph_id??""),String(body.expected_revision??""),body.graph,"update",{remember:true})},{headers});
 if(action==="delete")return NextResponse.json(await deleteWorkflowGraph(session.principal,String(body.graph_id??""),String(body.expected_revision??"")),{headers});
 if(action==="clone")return NextResponse.json({graph:await cloneWorkflowGraph(session.principal,String(body.graph_id??""),{remember:true})},{headers});
 if(action==="create_from_template"){const row=workflowTemplate(String(body.template_id??""));if(!row)throw new Error("workflow template not found");return NextResponse.json({graph:await createWorkflowGraph(session.principal,row.definition,"template",{remember:true})},{headers});}
 if(action==="restore_version"){const id=String(body.graph_id??""),snapshot=await readWorkflowGraphVersion(workflowGraphOwner(session.principal),id,String(body.revision??""));if(!snapshot)throw new Error("workflow version not found");return NextResponse.json({graph:await updateWorkflowGraph(session.principal,id,String(body.expected_revision??""),definition(snapshot.graph),"restore",{remember:true})},{headers});}
 if(action==="variable_set"||action==="variable_delete"){if(!roleAtLeast(session.context.role,"owner"))return fail("owner_required",403);return NextResponse.json(action==="variable_set"?await setWorkflowVariable(session.principal,String(body.key??""),body.value,body.secret===true):await deleteWorkflowVariable(session.principal,String(body.key??"")),{headers});}
 if(action==="ai_suggest"){if(!roleAtLeast(session.context.role,"owner"))return fail("owner_required",403);return NextResponse.json({definition:await suggestWorkflowGraph(String(body.prompt??""))},{headers});}
 if(action==="optimize_preview"||action==="optimize_clone"){
  const graph=await getWorkflowGraph(session.principal,String(body.graph_id??""));if(!graph)throw new Error("workflow graph not found");
  if(action==="optimize_clone"&&String(body.expected_revision??"")!==graph.revision)throw new Error("workflow graph revision changed; refresh before optimizing");
  const mode=body.mode==="jev"?"jev" as const:"deterministic" as const;let evaluator;
  if(mode==="jev"){
   if(!roleAtLeast(session.context.role,"owner"))return fail("owner_required",403);
   evaluator=createJevWorkflowOptimizerEvaluator(await resolveJevIntegrationConfig(body.jev));
  }
  const optimized=await optimizeWorkflowGraph(graph,{mode,threshold:Number(body.threshold)||undefined,applyReview:body.apply_review===true,evaluator,resolveTool:name=>TOOLS_BY_NAME.get(name)});
  if(action==="optimize_preview")return NextResponse.json({optimization:optimized.preview},{headers});
  if(optimized.preview.summary.selectedCount<1)throw new Error("no optimization candidate selected; analyze first or enable review transformations");
  const next=optimized.definition as Record<string,unknown>,meta=next.metadata&&typeof next.metadata==="object"&&!Array.isArray(next.metadata)?next.metadata as Record<string,unknown>:{},tags=Array.isArray(meta.tags)?meta.tags.filter((value):value is string=>typeof value==="string"):[];
  next.name=typeof body.name==="string"&&body.name.trim()?body.name.trim().slice(0,160):`${graph.name} · Optimized`.slice(0,160);next.status="draft";next.metadata={...meta,provenance:"ai-assisted",fingerprint:undefined,tags:[...new Set([...tags,"optimized",optimized.preview.provider==="jev"?"jev":"deterministic"])].slice(0,32)};
  return NextResponse.json({graph:await createWorkflowGraph(session.principal,next,"create",{remember:true}),optimization:optimized.preview},{headers});
 }
 if(action==="data_table_create")return NextResponse.json({table:await createWorkflowDataTable(session.principal,body.name,body.columns)},{headers});
 if(action==="data_table_delete")return NextResponse.json(await deleteWorkflowDataTable(session.principal,body.table_id),{headers});
 if(action==="data_table_row_upsert")return NextResponse.json({row:await upsertWorkflowDataTableRow(session.principal,body.table_id,body.row_id,body.values)},{headers});
 if(action==="data_table_row_delete")return NextResponse.json(await deleteWorkflowDataTableRow(session.principal,body.table_id,body.row_id),{headers});
 if(action==="run_stop")return NextResponse.json(await requestWorkflowGraphStop(session.principal,String(body.run_id??"")),{headers});
 if(action==="run_delete")return NextResponse.json(await deleteWorkflowGraphRun(workflowGraphOwner(session.principal),String(body.run_id??"")),{headers});
 if(action==="run_retry"){const prior=await readWorkflowGraphRun(workflowGraphOwner(session.principal),String(body.run_id??""));if(!prior)throw new Error("workflow execution not found");if(prior.state==="running")throw new Error("running execution must be stopped before retry");if(!prior.runtimeInput)throw new Error("execution predates retry input retention; run the workflow again instead");const graph=await getWorkflowGraph(session.principal,prior.graphId);if(!graph)throw new Error("workflow graph not found");if(graph.revision!==prior.graphRevision)throw new Error("workflow changed since this execution; run the current workflow instead of retrying stale input");const agentSession=await createAgentSession(session.principal,"cli",{title:`Workflow retry: ${graph.name}`,titleSource:"auto"}),context={principal:session.principal,actor:session.principal,sessionId:agentSession.id,scope:maxScope(),capabilities:msoCapabilityRuntime} as const;return NextResponse.json(await startWorkflowGraph(graph,prior.runtimeInput,String(body.idempotency_key??`retry:${prior.id}:${Date.now()}`),context,(name)=>TOOLS_BY_NAME.get(name)),{headers});}
 if(action==="run"){const graph=await getWorkflowGraph(session.principal,String(body.graph_id??""));if(!graph)throw new Error("workflow graph not found");const agentSession=await createAgentSession(session.principal,"cli",{title:`Workflow: ${graph.name}`,titleSource:"auto"}),context={principal:session.principal,actor:session.principal,sessionId:agentSession.id,scope:maxScope(),capabilities:msoCapabilityRuntime} as const;return NextResponse.json(await startWorkflowGraph(graph,body.input??{},String(body.idempotency_key??`${Date.now()}`),context,(name)=>TOOLS_BY_NAME.get(name)),{headers});}
 throw new Error("unknown workflow action");}catch(error){return fail(error);}}
