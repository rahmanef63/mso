import { flowCatalog } from "@/lib/workflow/automation-catalog";
import { startFlow, flowStatus } from "@/lib/workflow/automation-engine";
import { BUILTIN_FLOWS } from "@/lib/workflow/automation-builtins";
import { manageProjectFlow } from "@/lib/host/project-flow-manifest";
import { type McpTool, S, str } from "./tool-kit";
import { cloneWorkflowGraph, createWorkflowGraph, deleteWorkflowGraph, getWorkflowGraph, listWorkflowGraphs, updateWorkflowGraph } from "@/lib/workflow/graph-store";
import { startWorkflowGraph, workflowGraphRunStatus } from "@/lib/workflow/graph-engine";
const project = { type: "string", maxLength: 4096 };
const flow = { type: "string", maxLength: 64 };

function privateGraphPrincipal(context: Parameters<McpTool["run"]>[1]): string {
  const principal = context.recipeActor ?? context.workflowActor ?? context.actor ?? context.principal;
  if (!principal) throw new Error("workflow graph requires an authenticated principal");
  return principal;
}
export const FLOW_TOOLS: McpTool[] = [
  { name: "flow_catalog", title: "Discover Automation Flows", scope: "read",
    description: "Discover project API/MCP flows, schemas and ordered steps. Inspect before flow_run.",
    chatgptDescription: "Discover project flows and inputs before flow_run.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: S({ project, flow }, ["project"]),
    run: async a => { const { project: p, flows, revision } = await flowCatalog(str(a, "project"), typeof a.flow === "string" ? a.flow : undefined); return { project: p.id, revision, flows }; } },
  { name: "flow_run", title: "Run Automation Flow", scope: "exec",
    description: "Run an inspected project flow with exact input/idempotency key. Returns a durable receipt; failed writes are not auto-retried.",
    chatgptDescription: "Run an inspected flow; use flow_status for its receipt.",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }, audit: { action: "exec.run", targetArg: "flow" },
    limit: { key: "flow.run", max: 20, windowMs: 60_000 },
    inputSchema: S({ project, flow, input: { type: "object", additionalProperties: true }, idempotency_key: { type: "string", minLength: 1, maxLength: 128 } }, ["project", "flow", "input", "idempotency_key"]),
    run: async (a, context) => {
      const catalog = await flowCatalog(str(a, "project"), str(a, "flow"));
      const { TOOLS_BY_NAME } = await import("./tools");
      return startFlow(catalog.definitions[0], catalog.project.id, a.input, str(a, "idempotency_key"), context, name => TOOLS_BY_NAME.get(name));
    } },
  { name: "flow_status", title: "Automation Flow Status", scope: "read",
    description: "Read this principal's flow receipt; wait_ms may reduce polling.",
    chatgptDescription: "Read flow step results; wait_ms may reduce polling.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: S({ run_id: { type: "string", pattern: "^[a-f0-9]{32}$" }, wait_ms: { type: "integer", minimum: 0, maximum: 25_000 } }, ["run_id"]),
    run: (a, context) => flowStatus(str(a, "run_id"), context, Number(a.wait_ms) || 0) },
  { name: "flow_manage", limit: { key: "flow.manage", max: 20, windowMs: 60_000 }, title: "Save Project Automation", scope: "write",
    description: "Create/update/delete a project flow with flow_catalog revision. Built-ins are immutable; credentials are forbidden.",
    chatgptDescription: "Save/delete a project flow by revision; no credentials.",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }, audit: { action: "fs.write", targetArg: "project" },
    inputSchema: S({ project, flow, action: { type: "string", enum: ["upsert", "delete"] }, revision: { type: "string" }, definition: { type: "object", additionalProperties: true } }, ["project", "flow", "action", "revision"]),
    run: async a => {
      const id = str(a, "flow");
      if (BUILTIN_FLOWS.some(flow => flow.id === id)) throw new Error("built-in flow is immutable");
      if (a.action !== "upsert" && a.action !== "delete") throw new Error("action must be upsert or delete");
      const catalog = await flowCatalog(str(a, "project"));
      return manageProjectFlow(catalog.project.path, { action: a.action, id, flow: a.definition, revision: str(a, "revision") });
    } },
  { name: "workflow_graph", title: "Workflow Graph", scope: "exec", limit: { key: "workflow.graph", max: 20, windowMs: 60_000 },
    description: "Private Workflow Graph v2 CRUD/run/status. Use action list|get|create|update|delete|clone|run|status. Definitions reject secrets; runs keep per-node receipts.",
    chatgptDescription: "CRUD/run workflows; read node logs.",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }, audit: { action: "exec.run", targetArg: "id" },
    inputSchema: S({ action: { type: "string", enum: ["list", "get", "create", "update", "delete", "clone", "run", "status"] }, id: { type: "string", maxLength: 96 }, data: { type: "object", additionalProperties: true }, wait_ms: { type: "integer", minimum: 0, maximum: 25_000 } }, ["action"]),
    run: async (a, context) => {
      const principal = privateGraphPrincipal(context), action = str(a, "action");
      const data = a.data && typeof a.data === "object" && !Array.isArray(a.data) ? a.data as Record<string, unknown> : {};
      if (action === "list") { const graphs = await listWorkflowGraphs(principal); return { graphs: graphs.map(graph => ({ id: graph.id, name: graph.name, status: graph.status, revision: graph.revision, nodeCount: graph.nodes.length, updatedAt: graph.updatedAt, provenance: graph.metadata.provenance, project: graph.metadata.project })) }; }
      if (action === "status") return workflowGraphRunStatus(principal, str(a, "id"), Number(a.wait_ms) || 0);
      if (action === "create") return { graph: await createWorkflowGraph(principal, data.definition ?? data) };
      const id = str(a, "id");
      if (action === "get") { const graph = await getWorkflowGraph(principal, id); if (!graph) throw new Error("workflow graph not found"); return { graph }; }
      if (action === "clone") return { graph: await cloneWorkflowGraph(principal, id) };
      if (action === "update") return { graph: await updateWorkflowGraph(principal, id, String(data.revision ?? ""), data.definition) };
      if (action === "delete") return deleteWorkflowGraph(principal, id, String(data.revision ?? ""));
      if (action === "run") {
        const graph = await getWorkflowGraph(principal, id); if (!graph) throw new Error("workflow graph not found");
        const { TOOLS_BY_NAME } = await import("./tools");
        return startWorkflowGraph(graph, data.input ?? {}, String(data.key ?? ""), context, name => TOOLS_BY_NAME.get(name), principal);
      }
      throw new Error("unsupported workflow graph action");
    } },
];
