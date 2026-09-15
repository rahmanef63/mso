import path from "node:path";
import { promises as fs } from "node:fs";
import { capabilityReportedFailure } from "@/lib/capabilities/result-outcome";
import { executeCapabilityCall } from "@/lib/capabilities/execute";
import { isCapabilityDirectResult, type CapabilityRunContext, type CapabilityTool } from "@/lib/capabilities/tool";
import { boundedResultText } from "@/lib/capabilities/result-budget";
import { resolveProjectHint } from "@/lib/host/projects-api";
import type { WorkflowGraph, WorkflowGraphNode, WorkflowGraphRun, WorkflowGraphRunNode } from "@/lib/contracts/workflow-graph";
import { graphObject } from "./graph-schema";
import { bindLoopItem, bindWorkflowValue } from "./graph-bindings";
import { executeFlowNode, workflowItems, type FlowNodeResult } from "./graph-flow-nodes";
import { workflowVariableValues } from "./variables";

type Resolver = (name: string) => CapabilityTool | undefined;
type NodeExecutionResult = FlowNodeResult;
const BLOCKED_TOOL_NODES = new Set(["workflow_start", "workflow_finish", "workflow_cancel", "flow_run", "flow_status", "workflow_graph"]);

function compact(value: unknown): unknown {
  try { return JSON.parse(boundedResultText(typeof value === "string" ? { text: value } : value, { maxTextBytes: 12 * 1024, overflowHint: "Open the underlying project/tool result for full details." })); }
  catch { return { text: String(value).slice(0, 12_000) }; }
}
function resultData(result: unknown): unknown {
  if (capabilityReportedFailure(result)) throw new Error("downstream tool reported an error");
  if (!isCapabilityDirectResult(result)) return result;
  if (result.isError) throw new Error("downstream tool reported an error");
  if (result.structuredContent) return result.structuredContent;
  const text = result.content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
  try { return JSON.parse(text); } catch { return { text }; }
}
async function callTool(name: string, args: Record<string, unknown>, context: CapabilityRunContext, resolve: Resolver): Promise<unknown> {
  const tool = resolve(name); if (!tool) throw new Error(`workflow tool unavailable: ${name}`);
  const outcome = await executeCapabilityCall({ tool, args, scope: context.scope, actor: context.actor, context });
  if (outcome.kind !== "success") throw new Error(outcome.message); return resultData(outcome.result);
}
async function resolvedProject(hint: unknown): Promise<{ id: string; name: string; path: string; matchedBy: string }> {
  if (typeof hint !== "string" || !hint) throw new Error("project node requires config.project");
  const project = await resolveProjectHint(hint); if (!project || project.matchedBy === "fuzzy") throw new Error("project node requires an exact resolvable project");
  return { id: project.id, name: project.name, path: project.path, matchedBy: project.matchedBy };
}
async function loopTool(config: Record<string, unknown>, runtime: unknown, context: CapabilityRunContext, resolve: Resolver) {
  const tool = typeof config.tool === "string" ? config.tool : ""; if (!tool || BLOCKED_TOOL_NODES.has(tool)) throw new Error("loop node requires a bounded tool");
  const all = workflowItems(config, runtime), concurrency = Math.max(1, Math.min(4, Math.trunc(Number(config.concurrency) || 1))), results: unknown[] = [];
  for (let start = 0; start < all.length; start += concurrency) {
    const batch = all.slice(start, start + concurrency);
    results.push(...await Promise.all(batch.map(async (item, offset) => {
      const args = bindLoopItem(graphObject(config.arguments) ? config.arguments : {}, item, start + offset) as Record<string, unknown>;
      if (context.workflowId) args.workflow_id = context.workflowId; return callTool(tool, args, context, resolve);
    })));
  }
  return { output: { count: all.length, results }, log: `Looped ${all.length} item(s) through ${tool}.` };
}

async function executeNode(node: WorkflowGraphNode, run: WorkflowGraphRun, graph: WorkflowGraph, graphInput: Record<string, unknown>, outputs: Record<string, unknown>, context: CapabilityRunContext, resolve: Resolver): Promise<NodeExecutionResult> {
  const runtime = { input: graphInput, trigger: run.trigger, nodes: Object.fromEntries(Object.entries(outputs).map(([id, output]) => [id, { output }])), graph: { id: graph.id, name: graph.name, metadata: graph.metadata } };
  const principal = context.principal ?? context.actor; if (!principal) throw new Error("workflow node requires principal");
  const config = bindWorkflowValue(node.config, runtime, await workflowVariableValues(principal)) as Record<string, unknown>;
  const project = typeof config.project === "string" ? config.project : graph.metadata.project;
  if (["manual", "schedule", "webhook"].includes(node.type)) return { output: graphInput, log: `${node.type} trigger accepted.` };
  if (node.type === "project") return { output: await resolvedProject(config.project ?? project), log: "Canonical project resolved at runtime." };
  if (node.type === "folder") {
    const resolved = await resolvedProject(config.project ?? project), relative = typeof config.path === "string" ? config.path : ".", target = path.resolve(resolved.path, relative), root = resolved.path.endsWith(path.sep) ? resolved.path : resolved.path + path.sep;
    if (target !== resolved.path && !target.startsWith(root)) throw new Error("folder node path escapes project root"); const stat = await fs.stat(target); if (!stat.isDirectory()) throw new Error("folder node target is not a directory");
    return { output: { project: resolved.id, path: target, relativePath: path.relative(resolved.path, target) || "." }, log: "Folder resolved inside the canonical project root." };
  }
  if (node.type === "skill") { const query = typeof config.query === "string" ? config.query : typeof config.key === "string" ? config.key : node.name; return { output: await callTool("skills_search", { query, top_k: Number(config.top_k) || 8, ...(context.workflowId ? { workflow_id: context.workflowId } : {}) }, context, resolve), log: "Skill catalog queried with provenance/trust metadata." }; }
  if (node.type === "knowledge") {
    if (!project) throw new Error("knowledge node requires project binding");
    if (typeof config.query === "string" && config.query) return { output: await callTool("project_memory_search", { project, query: config.query, limit: Number(config.limit) || 8, ...(context.workflowId ? { workflow_id: context.workflowId } : {}) }, context, resolve), log: "Project memory queried." };
    return { output: await callTool("project_knowledge_get", { project, ...(context.workflowId ? { workflow_id: context.workflowId } : {}) }, context, resolve), log: "Project knowledge resolved." };
  }
  const flow = await executeFlowNode(node, config, graph, outputs, runtime); if (flow) return flow;
  if (node.type === "output") return { output: Object.hasOwn(config, "value") ? config.value : { nodes: outputs }, log: "Workflow output collected." };
  if (node.type === "loop") return loopTool(config, runtime, context, resolve);
  if (node.type === "tool") {
    const tool = typeof config.tool === "string" ? config.tool : ""; if (!tool || BLOCKED_TOOL_NODES.has(tool)) throw new Error("tool node requires a bounded non-workflow tool");
    const args = graphObject(config.arguments) ? structuredClone(config.arguments) : {}; if (context.workflowId) args.workflow_id = context.workflowId;
    return { output: await callTool(tool, args, context, resolve), log: `Tool ${tool} completed.` };
  }
  if (node.type === "integration") {
    for (const key of ["user", "provider", "connection", "operation"]) if (typeof config[key] !== "string" || !config[key]) throw new Error(`integration node requires ${key}`);
    const args = { user: config.user, provider: config.provider, connection: config.connection, operation: config.operation, ...(typeof config.tool === "string" ? { tool: config.tool } : {}), ...(graphObject(config.arguments) ? { arguments: config.arguments } : {}), ...(config.confirm === true ? { confirm: true } : {}), ...(context.workflowId ? { workflow_id: context.workflowId } : {}) };
    return { output: await callTool("integration_execute", args, context, resolve), log: `Integration ${config.provider}/${config.connection} completed.` };
  }
  if (node.type === "project_function") { if (!project || typeof config.name !== "string") throw new Error("project_function node requires project and name"); return { output: await callTool("project_function_call", { project, name: config.name, input: graphObject(config.input) ? config.input : {}, ...(context.workflowId ? { workflow_id: context.workflowId } : {}) }, context, resolve), log: `Project function ${config.name} completed.` }; }
  if (node.type === "project_mcp") { if (!project || typeof config.server !== "string" || typeof config.tool !== "string") throw new Error("project_mcp node requires project/server/tool"); return { output: await callTool("project_mcp_call", { project, server: config.server, tool: config.tool, arguments: graphObject(config.arguments) ? config.arguments : {}, ...(context.workflowId ? { workflow_id: context.workflowId } : {}) }, context, resolve), log: `Project MCP ${config.server}.${config.tool} completed.` }; }
  if (node.type === "script") { if (!project || typeof config.script_id !== "string") throw new Error("script node requires project and script_id"); return { output: await callTool("project_script_run", { project, script_id: config.script_id, ...(context.workflowId ? { workflow_id: context.workflowId } : {}) }, context, resolve), log: `Script ${config.script_id} completed.` }; }
  if (node.type === "agent") { if (!project || typeof config.message !== "string") throw new Error("agent node requires project and message"); const args: Record<string, unknown> = { project, message: config.message, wait: config.wait !== false, plan_mode: Boolean(config.plan_mode), max_scope: ["read", "write", "exec"].includes(String(config.max_scope)) ? config.max_scope : "write" }; if (context.workflowId) args.workflow_id = context.workflowId; return { output: await callTool("project_agent_run", args, context, resolve), log: "Project agent action completed." }; }
  if (node.type === "subflow") {
    if (typeof config.workflowId === "string" && config.workflowId) {
      const principal = context.principal ?? context.actor; if (!principal) throw new Error("workflow subflow requires principal");
      const { getWorkflowGraph } = await import("./graph-store"), { startWorkflowGraph, workflowGraphRunStatus } = await import("./graph-engine"), child = await getWorkflowGraph(principal, config.workflowId);
      if (!child) throw new Error("subflow workflow graph not found");
      const started = await startWorkflowGraph(child, graphObject(config.input) ? config.input : {}, `${run.id}:${node.id}`, context, resolve, principal, { type: "system", receivedAt: new Date().toISOString() }, run.ancestry ?? [graph.id]);
      let latest = started; for (let tries = 0; tries < 24 && latest.state === "running"; tries += 1) latest = await workflowGraphRunStatus(principal, latest.id, 25_000);
      if (latest.state === "failed" || latest.state === "interrupted" || latest.state === "running") throw new Error(`subflow workflow ${child.name} did not complete successfully`);
      return { output: latest, log: `Workflow subflow ${child.name} completed.` };
    }
    if (!project || typeof config.flow !== "string") throw new Error("subflow node requires workflowId or project/flow"); const started = await callTool("flow_run", { project, flow: config.flow, input: graphObject(config.input) ? config.input : {}, idempotency_key: `${run.id}:${node.id}`, ...(context.workflowId ? { workflow_id: context.workflowId } : {}) }, context, resolve) as Record<string, unknown>;
    const runId = typeof started.id === "string" ? started.id : typeof started.run_id === "string" ? started.run_id : undefined; if (!runId) return { output: started, log: `Subflow ${config.flow} started.` };
    let latest: unknown = started; for (let tries = 0; tries < 24; tries += 1) { latest = await callTool("flow_status", { run_id: runId, wait_ms: 25_000 }, context, resolve); if (graphObject(latest) && latest.state !== "running") break; }
    if (graphObject(latest) && !["completed", "completed_with_errors"].includes(String(latest.state))) throw new Error(`subflow ${config.flow} did not complete successfully`); return { output: latest, log: `Subflow ${config.flow} completed.` };
  }
  throw new Error(`unsupported workflow node type: ${node.type}`);
}
export function nodeRuntimeView(row: WorkflowGraphRunNode): WorkflowGraphRunNode { return structuredClone(row); }
export { executeNode, compact };
