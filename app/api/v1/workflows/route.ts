import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { roleAtLeast } from "@/lib/auth/roles";
import { createAgentSession, listAgentSessions } from "@/lib/agent/session-store";
import { readSetupJson } from "@/lib/infra/setup-http";
import { rateLimited } from "@/lib/host/limits-api";
import { maxScope } from "@/lib/mcp/scope";
import { TOOLS_BY_NAME } from "@/lib/mcp/tools";
import { msoCapabilityRuntime } from "@/lib/mcp/capability-runtime";
import { listProjects } from "@/lib/host/projects-api";
import { catalogSkillsDetailed } from "@/lib/skills/catalog";
import { cloneWorkflowGraph, createWorkflowGraph, deleteWorkflowGraph, getWorkflowGraph, listWorkflowGraphs, updateWorkflowGraph, workflowGraphOwner } from "@/lib/workflow/graph-store";
import { startWorkflowGraph, workflowGraphRunStatus } from "@/lib/workflow/graph-engine";
import { listWorkflowGraphRuns } from "@/lib/workflow/graph-run-store";
import { listWorkflowGraphVersions, readWorkflowGraphVersion } from "@/lib/workflow/graph-version-store";
import { resolveWorkflowGraphNodeTarget } from "@/lib/workflow/graph-target";
import { deleteWorkflowVariable, listWorkflowVariables, setWorkflowVariable } from "@/lib/workflow/variables";
import { workflowNodeCatalog } from "@/lib/workflow/node-catalog";
import { workflowTemplate, workflowTemplates } from "@/lib/workflow/templates";
import { suggestWorkflowGraph } from "@/lib/workflow/ai-assist";
export const runtime="nodejs";export const dynamic="force-dynamic";const headers={"Cache-Control":"no-store, private"};
const fail=(error:unknown,status=400)=>NextResponse.json({error:error instanceof Error?error.message.slice(0,500):String(error).slice(0,500)||"workflow request failed"},{status,headers});
async function auth(minimum:"viewer"|"operator"|"owner"="viewer"){const context=await getSessionContext();if(!context?.session.device_id||!roleAtLeast(context.role,minimum))return null;return{context,principal:`web:${context.session.device_id}`};}
function definition(graph:NonNullable<Awaited<ReturnType<typeof getWorkflowGraph>>>){const{revision:_r,createdAt:_c,updatedAt:_u,version:_v,...rest}=graph;return rest;}
export async function GET(req:NextRequest){const q=req.nextUrl.searchParams,minimum=q.has("variables")?"operator":"viewer",session=await auth(minimum);if(!session)return fail("unauthorized",401);try{
 if(q.get("directory")==="1"){
  const query=(q.get("q")??"").toLowerCase().trim(),tools=msoCapabilityRuntime.list(maxScope()).filter((tool)=>!query||`${tool.name} ${tool.description} ${tool.scope}`.toLowerCase().includes(query)).slice(0,150);
  const operator=roleAtLeast(session.context.role,"operator");
  const [graphs,sessions,projectResult,skillResult]=await Promise.all([listWorkflowGraphs(session.principal),listAgentSessions(session.principal,50),operator?listProjects({query:query||undefined,limit:100}):Promise.resolve(null),operator?catalogSkillsDetailed():Promise.resolve(null)]);
  const projects=projectResult?.projects.map((row)=>({id:row.id,name:row.name,...(row.packageName?{packageName:row.packageName}:{}),...(row.packageVersion?{packageVersion:row.packageVersion}:{}),...(row.git?.branch?{branch:row.git.branch}:{}),...(row.git?.head?{head:row.git.head}:{})}))??[];
  const skills=skillResult?.skills.filter((row)=>!query||`${row.id} ${row.name} ${row.description} ${row.source} ${row.trust} ${row.project?.name??""}`.toLowerCase().includes(query)).slice(0,150).map((row)=>({id:row.id,name:row.name,description:row.description,source:row.source,trust:row.trust,...(row.project?{project:row.project.name}:{})}))??[];
  return NextResponse.json({tools,workflows:graphs.filter((graph)=>!query||`${graph.name} ${graph.description} ${(graph.metadata.tags??[]).join(" ")}`.toLowerCase().includes(query)).map((graph)=>({id:graph.id,name:graph.name,status:graph.status,nodeCount:graph.nodes.length,updatedAt:graph.updatedAt})),sessions:sessions.filter((row)=>!query||`${row.title} ${row.name} ${row.cwd??""}`.toLowerCase().includes(query)),projects,skills},{headers});
 }
 if(q.get("catalog")==="1")return NextResponse.json({nodes:workflowNodeCatalog(q.get("q")??"")},{headers});
 if(q.get("templates")==="1")return NextResponse.json({templates:workflowTemplates()},{headers});
 if(q.get("variables")==="1")return NextResponse.json({variables:await listWorkflowVariables(session.principal)},{headers});
 if(q.get("runs")==="1")return NextResponse.json(await listWorkflowGraphRuns(workflowGraphOwner(session.principal),{graphId:q.get("graph_id")||undefined,state:(q.get("state")||undefined) as never,limit:Number(q.get("limit"))||30,offset:Number(q.get("offset"))||0}),{headers});
 if(q.has("versions")){const graphId=q.get("versions")!;return NextResponse.json({versions:await listWorkflowGraphVersions(workflowGraphOwner(session.principal),graphId)},{headers});}
 if(q.has("run_id"))return NextResponse.json(await workflowGraphRunStatus(session.principal,q.get("run_id")!,Number(q.get("wait_ms"))||0),{headers});
 if(q.has("graph_id")&&q.has("node_id")&&q.get("resolve")==="target"){const graph=await getWorkflowGraph(session.principal,q.get("graph_id")!);if(!graph)throw new Error("workflow graph not found");return NextResponse.json(await resolveWorkflowGraphNodeTarget(graph,q.get("node_id")!),{headers});}
 if(q.has("graph_id")){const graph=await getWorkflowGraph(session.principal,q.get("graph_id")!);if(!graph)return fail("workflow graph not found",404);return NextResponse.json({graph},{headers});}
 return NextResponse.json({graphs:await listWorkflowGraphs(session.principal)},{headers});
 }catch(error){return fail(error);}}
export async function POST(req:NextRequest){const session=await auth("operator");if(!session)return fail("operator_required",403);try{const body=await readSetupJson(req),action=typeof body.action==="string"?body.action:"";if(rateLimited(`workflow:${action}:${session.context.session.device_id}`,action==="run"?60:30,60_000))return fail("rate_limited",429);
 if(action==="create")return NextResponse.json({graph:await createWorkflowGraph(session.principal,body.graph)},{headers});
 if(action==="update")return NextResponse.json({graph:await updateWorkflowGraph(session.principal,String(body.graph_id??""),String(body.expected_revision??""),body.graph)},{headers});
 if(action==="delete")return NextResponse.json(await deleteWorkflowGraph(session.principal,String(body.graph_id??""),String(body.expected_revision??"")),{headers});
 if(action==="clone")return NextResponse.json({graph:await cloneWorkflowGraph(session.principal,String(body.graph_id??""))},{headers});
 if(action==="create_from_template"){const row=workflowTemplate(String(body.template_id??""));if(!row)throw new Error("workflow template not found");return NextResponse.json({graph:await createWorkflowGraph(session.principal,row.definition,"template")},{headers});}
 if(action==="restore_version"){const id=String(body.graph_id??""),snapshot=await readWorkflowGraphVersion(workflowGraphOwner(session.principal),id,String(body.revision??""));if(!snapshot)throw new Error("workflow version not found");return NextResponse.json({graph:await updateWorkflowGraph(session.principal,id,String(body.expected_revision??""),definition(snapshot.graph),"restore")},{headers});}
 if(action==="variable_set"||action==="variable_delete"){if(!roleAtLeast(session.context.role,"owner"))return fail("owner_required",403);return NextResponse.json(action==="variable_set"?await setWorkflowVariable(session.principal,String(body.key??""),body.value,body.secret===true):await deleteWorkflowVariable(session.principal,String(body.key??"")),{headers});}
 if(action==="ai_suggest"){if(!roleAtLeast(session.context.role,"owner"))return fail("owner_required",403);return NextResponse.json({definition:await suggestWorkflowGraph(String(body.prompt??""))},{headers});}
 if(action==="run"){const graph=await getWorkflowGraph(session.principal,String(body.graph_id??""));if(!graph)throw new Error("workflow graph not found");const agentSession=await createAgentSession(session.principal,"cli",{title:`Workflow: ${graph.name}`,titleSource:"auto"}),context={principal:session.principal,actor:session.principal,sessionId:agentSession.id,scope:maxScope(),capabilities:msoCapabilityRuntime} as const;return NextResponse.json(await startWorkflowGraph(graph,body.input??{},String(body.idempotency_key??`${Date.now()}`),context,(name)=>TOOLS_BY_NAME.get(name)),{headers});}
 throw new Error("unknown workflow action");}catch(error){return fail(error);}}
