import path from "node:path";
import { promises as fs } from "node:fs";
import { capabilityReportedFailure } from "@/lib/capabilities/result-outcome";
import { executeCapabilityCall } from "@/lib/capabilities/execute";
import { isCapabilityDirectResult, type CapabilityRunContext, type CapabilityTool } from "@/lib/capabilities/tool";
import { boundedResultText } from "@/lib/capabilities/result-budget";
import { resolveProjectHint } from "@/lib/host/projects-api";
import type { WorkflowGraph, WorkflowGraphNode, WorkflowGraphRun, WorkflowGraphRunNode } from "@/lib/contracts/workflow-graph";
import { graphObject } from "./graph-schema";

type Resolver = (name: string) => CapabilityTool | undefined;
type NodeExecutionResult = { output: unknown; branch?: boolean; log?: string };

const BLOCKED_TOOL_NODES = new Set(["workflow_start", "workflow_finish", "workflow_cancel", "flow_run", "flow_status"]);

function compact(value: unknown): unknown {
  try {
    return JSON.parse(boundedResultText(typeof value === "string" ? { text: value } : value, { maxTextBytes: 12 * 1024, overflowHint: "Open the underlying project/tool result for full details." }));
  } catch { return { text: String(value).slice(0, 12_000) }; }
}

function resultData(result: unknown): unknown {
  if (capabilityReportedFailure(result)) throw new Error("downstream tool reported an error");
  if (!isCapabilityDirectResult(result)) return result;
  if (result.isError) throw new Error("downstream tool reported an error");
  if (result.structuredContent) return result.structuredContent;
  const text = result.content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
  try { return JSON.parse(text); } catch { return { text }; }
}

function safePath(root: unknown, ref: string): unknown {
  const parts = ref.split(".");
  if (!parts.length || parts.length > 16 || parts.some((part) => !/^[A-Za-z0-9_:-]+$/.test(part) || ["__proto__", "constructor", "prototype"].includes(part))) throw new Error("invalid workflow reference");
  let value = root;
  for (const part of parts) {
    if ((!graphObject(value) && !Array.isArray(value)) || !Object.hasOwn(value, part)) throw new Error(`unresolved workflow reference: ${ref}`);
    value = (value as Record<string, unknown>)[part];
  }
  return structuredClone(value);
}

function bind(value: unknown, context: unknown, depth = 0): unknown {
  if (depth > 14) throw new Error("workflow references too deep");
  if (Array.isArray(value)) return value.map((item) => bind(item, context, depth + 1));
  if (!graphObject(value)) return value;
  if (Object.hasOwn(value, "$ref")) {
    if (Object.keys(value).length !== 1 || typeof value.$ref !== "string") throw new Error("workflow $ref must be the whole value");
    return safePath(context, value.$ref);
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, bind(child, context, depth + 1)]));
}

async function callTool(name: string, args: Record<string, unknown>, context: CapabilityRunContext, resolve: Resolver): Promise<unknown> {
  const tool = resolve(name);
  if (!tool) throw new Error(`workflow tool unavailable: ${name}`);
  const outcome = await executeCapabilityCall({ tool, args, scope: context.scope, actor: context.actor, context });
  if (outcome.kind !== "success") throw new Error(outcome.message);
  return resultData(outcome.result);
}

async function resolvedProject(hint: unknown): Promise<{ id: string; name: string; path: string; matchedBy: string }> {
  if (typeof hint !== "string" || !hint) throw new Error("project node requires config.project");
  const project = await resolveProjectHint(hint);
  if (!project || project.matchedBy === "fuzzy") throw new Error("project node requires an exact resolvable project");
  return { id: project.id, name: project.name, path: project.path, matchedBy: project.matchedBy };
}

async function executeNode(node: WorkflowGraphNode, run: WorkflowGraphRun, graph: WorkflowGraph, graphInput: Record<string, unknown>, outputs: Record<string, unknown>, context: CapabilityRunContext, resolve: Resolver): Promise<NodeExecutionResult> {
  const runtimeContext = { input: graphInput, nodes: Object.fromEntries(Object.entries(outputs).map(([id, output]) => [id, { output }])), graph: { id: graph.id, name: graph.name, metadata: graph.metadata } };
  const config = bind(node.config, runtimeContext) as Record<string, unknown>;
  const project = typeof config.project === "string" ? config.project : graph.metadata.project;
  if (node.type === "manual") return { output: graphInput, log: "Manual trigger accepted." };
  if (node.type === "project") return { output: await resolvedProject(config.project ?? project), log: "Canonical project resolved at runtime." };
  if (node.type === "folder") {
    const resolved = await resolvedProject(config.project ?? project), relative = typeof config.path === "string" ? config.path : ".";
    const target = path.resolve(resolved.path, relative), root = resolved.path.endsWith(path.sep) ? resolved.path : resolved.path + path.sep;
    if (target !== resolved.path && !target.startsWith(root)) throw new Error("folder node path escapes project root");
    const stat = await fs.stat(target); if (!stat.isDirectory()) throw new Error("folder node target is not a directory");
    return { output: { project: resolved.id, path: target, relativePath: path.relative(resolved.path, target) || "." }, log: "Folder resolved inside the canonical project root." };
  }
  if (node.type === "skill") {
    const query = typeof config.query === "string" ? config.query : typeof config.key === "string" ? config.key : node.name;
    return { output: await callTool("skills_search", { query, top_k: Number(config.top_k) || 8, ...(context.workflowId ? { workflow_id: context.workflowId } : {}) }, context, resolve), log: "Skill catalog queried with provenance/trust metadata." };
  }
  if (node.type === "knowledge") {
    if (!project) throw new Error("knowledge node requires project binding");
    if (typeof config.query === "string" && config.query) return { output: await callTool("project_memory_search", { project, query: config.query, limit: Number(config.limit) || 8, ...(context.workflowId ? { workflow_id: context.workflowId } : {}) }, context, resolve), log: "Project memory queried." };
    return { output: await callTool("project_knowledge_get", { project, ...(context.workflowId ? { workflow_id: context.workflowId } : {}) }, context, resolve), log: "Project knowledge resolved." };
  }
  if (node.type === "condition") {
    const ref = typeof config.path === "string" ? config.path : "input";
    const value = safePath(runtimeContext, ref), branch = Object.hasOwn(config, "equals") ? JSON.stringify(value) === JSON.stringify(config.equals) : Boolean(value);
    return { output: { value, branch }, branch, log: `Condition evaluated to ${branch}.` };
  }
  if (node.type === "output") return { output: Object.hasOwn(config, "value") ? config.value : { nodes: outputs }, log: "Workflow output collected." };
  if (node.type === "tool") {
    const tool = typeof config.tool === "string" ? config.tool : "";
    if (!tool || BLOCKED_TOOL_NODES.has(tool)) throw new Error("tool node requires a bounded non-workflow tool");
    const args = graphObject(config.arguments) ? structuredClone(config.arguments) : {};
    if (context.workflowId) args.workflow_id = context.workflowId;
    return { output: await callTool(tool, args, context, resolve), log: `Tool ${tool} completed.` };
  }
  if (node.type === "project_function") {
    if (!project || typeof config.name !== "string") throw new Error("project_function node requires project and name");
    return { output: await callTool("project_function_call", { project, name: config.name, input: graphObject(config.input) ? config.input : {}, ...(context.workflowId ? { workflow_id: context.workflowId } : {}) }, context, resolve), log: `Project function ${config.name} completed.` };
  }
  if (node.type === "project_mcp") {
    if (!project || typeof config.server !== "string" || typeof config.tool !== "string") throw new Error("project_mcp node requires project/server/tool");
    return { output: await callTool("project_mcp_call", { project, server: config.server, tool: config.tool, arguments: graphObject(config.arguments) ? config.arguments : {}, ...(context.workflowId ? { workflow_id: context.workflowId } : {}) }, context, resolve), log: `Project MCP ${config.server}.${config.tool} completed.` };
  }
  if (node.type === "script") {
    if (!project || typeof config.script_id !== "string") throw new Error("script node requires project and script_id");
    return { output: await callTool("project_script_run", { project, script_id: config.script_id, ...(context.workflowId ? { workflow_id: context.workflowId } : {}) }, context, resolve), log: `Script ${config.script_id} completed.` };
  }
  if (node.type === "agent") {
    if (!project || typeof config.message !== "string") throw new Error("agent node requires project and message");
    const args: Record<string, unknown> = { project, message: config.message, wait: config.wait !== false, plan_mode: Boolean(config.plan_mode), max_scope: ["read", "write", "exec"].includes(String(config.max_scope)) ? config.max_scope : "write" };
    if (context.workflowId) args.workflow_id = context.workflowId;
    return { output: await callTool("project_agent_run", args, context, resolve), log: "Project agent action completed." };
  }
  if (node.type === "subflow") {
    if (!project || typeof config.flow !== "string") throw new Error("subflow node requires project and flow");
    const started = await callTool("flow_run", { project, flow: config.flow, input: graphObject(config.input) ? config.input : {}, idempotency_key: `${run.id}:${node.id}`, ...(context.workflowId ? { workflow_id: context.workflowId } : {}) }, context, resolve) as Record<string, unknown>;
    const runId = typeof started.id === "string" ? started.id : typeof started.run_id === "string" ? started.run_id : undefined;
    if (!runId) return { output: started, log: `Subflow ${config.flow} started.` };
    let latest: unknown = started;
    for (let tries = 0; tries < 24; tries += 1) {
      latest = await callTool("flow_status", { run_id: runId, wait_ms: 25_000 }, context, resolve);
      if (graphObject(latest) && latest.state !== "running") break;
    }
    if (graphObject(latest) && latest.state !== "completed") throw new Error(`subflow ${config.flow} did not complete successfully`);
    return { output: latest, log: `Subflow ${config.flow} completed.` };
  }
  throw new Error(`unsupported workflow node type: ${node.type}`);
}

export function nodeRuntimeView(row: WorkflowGraphRunNode): WorkflowGraphRunNode { return structuredClone(row); }
export { executeNode, compact };
