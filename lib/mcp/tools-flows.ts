import { flowCatalog } from "@/lib/workflow/automation-catalog";
import { startFlow, flowStatus } from "@/lib/workflow/automation-engine";
import { BUILTIN_FLOWS } from "@/lib/workflow/automation-builtins";
import { manageProjectFlow } from "@/lib/host/project-flow-manifest";
import { type McpTool, S, str } from "./tool-kit";
import { cloneWorkflowGraph, createWorkflowGraph, deleteWorkflowGraph, getWorkflowGraph, listWorkflowGraphs, updateWorkflowGraph } from "@/lib/workflow/graph-store";
import { startWorkflowGraph, workflowGraphRunStatus } from "@/lib/workflow/graph-engine";
const project = { type: "string", maxLength: 4096, description: "Exact project id/path/name." };
const flow = { type: "string", maxLength: 64, description: "Flow id from flow_catalog." };

function privateGraphPrincipal(context: Parameters<McpTool["run"]>[1]): string {
  const principal = context.recipeActor ?? context.workflowActor ?? context.actor ?? context.principal;
  if (!principal) throw new Error("workflow graph requires an authenticated principal");
  return principal;
}
export const FLOW_TOOLS: McpTool[] = [
  { name: "flow_catalog", title: "Discover Automation Flows", scope: "read",
    description: "Discover reusable API/MCP flows for an exact project. Returns input schema, ordered steps, account context and required scope. Inspect a flow before flow_run; project flows live in .mso/flows.json.",
    chatgptDescription: "Discover project automation flows, required inputs and ordered steps. Inspect before flow_run.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: S({ project, flow }, ["project"]),
    run: async a => { const { project: p, flows, revision } = await flowCatalog(str(a, "project"), typeof a.flow === "string" ? a.flow : undefined); return { project: p.id, revision, flows }; } },
  { name: "flow_run", title: "Run Automation Flow", scope: "exec",
    description: "Start one inspected API/MCP flow with exact project, input and idempotency_key. Child tools retain scope, connection guards and audits. Same key/input returns the existing receipt; changed input is refused. Returns durable run id; use flow_status for progress. Never auto-retries a failed mutation.",
    chatgptDescription: "Run an inspected flow for exact project/input/idempotency_key. Returns a run id; flow_status reads progress.",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }, audit: { action: "exec.run", targetArg: "flow" },
    limit: { key: "flow.run", max: 20, windowMs: 60_000 },
    inputSchema: S({ project, flow, input: { type: "object", additionalProperties: true }, idempotency_key: { type: "string", minLength: 1, maxLength: 128 } }, ["project", "flow", "input", "idempotency_key"]),
    run: async (a, context) => {
      const catalog = await flowCatalog(str(a, "project"), str(a, "flow"));
      const { TOOLS_BY_NAME } = await import("./tools");
      return startFlow(catalog.definitions[0], catalog.project.id, a.input, str(a, "idempotency_key"), context, name => TOOLS_BY_NAME.get(name));
    } },
  { name: "flow_status", title: "Automation Flow Status", scope: "read",
    description: "Read a durable flow receipt owned by this authenticated principal. Optional wait_ms (0-25000) reduces client polling. Reports step results and interrupted outcomes; never replays work.",
    chatgptDescription: "Read a flow run's step results. wait_ms up to 25000 reduces polling. Interrupted writes need outcome inspection.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: S({ run_id: { type: "string", pattern: "^[a-f0-9]{32}$" }, wait_ms: { type: "integer", minimum: 0, maximum: 25_000 } }, ["run_id"]),
    run: (a, context) => flowStatus(str(a, "run_id"), context, Number(a.wait_ms) || 0) },
  { name: "flow_manage", limit: { key: "flow.manage", max: 20, windowMs: 60_000 }, title: "Save Project Automation", scope: "write",
    description: "Create/update/delete one project flow in .mso/flows.json using the revision from flow_catalog (new for absent manifest). Built-ins cannot be overwritten. Definitions contain metadata and exact API/MCP tool steps; credentials are forbidden.",
    chatgptDescription: "Save or delete a project flow with revision from flow_catalog. Never include credentials; built-ins are immutable.",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }, audit: { action: "fs.write", targetArg: "project" },
    inputSchema: S({ project, flow, action: { type: "string", enum: ["upsert", "delete"] }, revision: { type: "string" }, definition: { type: "object", additionalProperties: true } }, ["project", "flow", "action", "revision"]),
    run: async a => {
      const id = str(a, "flow");
      if (BUILTIN_FLOWS.some(flow => flow.id === id)) throw new Error("built-in flow is immutable");
      if (a.action !== "upsert" && a.action !== "delete") throw new Error("action must be upsert or delete");
      const catalog = await flowCatalog(str(a, "project"));
      return manageProjectFlow(catalog.project.path, { action: a.action, id, flow: a.definition, revision: str(a, "revision") });
    } },
  { name: "workflow_graph_catalog", title: "Workflow Graph Catalog", scope: "read",
    description: "List private Workflow Graph v2 definitions for this authenticated principal, or inspect one exact graph. Graphs are isolated per principal and never contain provider secrets.",
    chatgptDescription: "List or inspect this user's private n8n-like workflow graphs before managing/running one.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: S({ graph_id: { type: "string", maxLength: 96 } }),
    run: async (a, context) => {
      const principal = privateGraphPrincipal(context);
      if (typeof a.graph_id === "string" && a.graph_id) { const graph = await getWorkflowGraph(principal, a.graph_id); if (!graph) throw new Error("workflow graph not found"); return { graph }; }
      const graphs = await listWorkflowGraphs(principal);
      return { graphs: graphs.map(graph => ({ id: graph.id, name: graph.name, description: graph.description, status: graph.status, revision: graph.revision, nodeCount: graph.nodes.length, updatedAt: graph.updatedAt, provenance: graph.metadata.provenance, project: graph.metadata.project })) };
    } },
  { name: "workflow_graph_manage", title: "Manage Workflow Graph", scope: "write", limit: { key: "workflow.graph.manage", max: 30, windowMs: 60_000 },
    description: "Create, update, clone or delete one private Workflow Graph v2 definition. Updates/deletes require expected_revision. Definitions are metadata-only; secret-like fields are rejected.",
    chatgptDescription: "CRUD a private n8n-like workflow graph with revision conflict protection.",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }, audit: { action: "fs.write", targetArg: "graph_id" },
    inputSchema: S({ action: { type: "string", enum: ["create", "update", "delete", "clone"] }, graph_id: { type: "string", maxLength: 96 }, expected_revision: { type: "string", maxLength: 128 }, definition: { type: "object", additionalProperties: true } }, ["action"]),
    run: async (a, context) => {
      const principal = privateGraphPrincipal(context), action = str(a, "action");
      if (action === "create") return { graph: await createWorkflowGraph(principal, a.definition) };
      const id = str(a, "graph_id");
      if (action === "clone") return { graph: await cloneWorkflowGraph(principal, id) };
      if (action === "update") return { graph: await updateWorkflowGraph(principal, id, str(a, "expected_revision"), a.definition) };
      if (action === "delete") return deleteWorkflowGraph(principal, id, str(a, "expected_revision"));
      throw new Error("unsupported workflow graph action");
    } },
  { name: "workflow_graph_run", title: "Run Workflow Graph", scope: "exec", limit: { key: "workflow.graph.run", max: 20, windowMs: 60_000 },
    description: "Run one inspected private Workflow Graph v2 with exact input/idempotency key. Execution remains bounded by normal capability scopes and returns a durable per-node receipt.",
    chatgptDescription: "Run a private workflow graph and return the per-node run receipt id.",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }, audit: { action: "exec.run", targetArg: "graph_id" },
    inputSchema: S({ graph_id: { type: "string", maxLength: 96 }, input: { type: "object", additionalProperties: true }, idempotency_key: { type: "string", minLength: 1, maxLength: 128 } }, ["graph_id", "input", "idempotency_key"]),
    run: async (a, context) => {
      const principal = privateGraphPrincipal(context), graph = await getWorkflowGraph(principal, str(a, "graph_id"));
      if (!graph) throw new Error("workflow graph not found");
      const { TOOLS_BY_NAME } = await import("./tools");
      return startWorkflowGraph(graph, a.input, str(a, "idempotency_key"), context, name => TOOLS_BY_NAME.get(name), principal);
    } },
  { name: "workflow_graph_status", title: "Workflow Graph Run Status", scope: "read",
    description: "Read a private Workflow Graph v2 run receipt with node states, logs, durations and failed-node identity. Optional wait_ms reduces polling.",
    chatgptDescription: "Read node-by-node workflow graph status/logs and identify the failed node.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: S({ run_id: { type: "string", pattern: "^[a-f0-9]{32}$" }, wait_ms: { type: "integer", minimum: 0, maximum: 25_000 } }, ["run_id"]),
    run: (a, context) => workflowGraphRunStatus(privateGraphPrincipal(context), str(a, "run_id"), Number(a.wait_ms) || 0) },
];
