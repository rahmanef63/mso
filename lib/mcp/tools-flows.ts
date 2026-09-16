import { flowCatalog } from "@/lib/workflow/automation-catalog";
import { startFlow, flowStatus } from "@/lib/workflow/automation-engine";
import { BUILTIN_FLOWS } from "@/lib/workflow/automation-builtins";
import { manageProjectFlow } from "@/lib/host/project-flow-manifest";
import { type McpTool, S, str } from "./tool-kit";
import { cloneWorkflowGraph, createWorkflowGraph, deleteWorkflowGraph, getWorkflowGraph, listWorkflowGraphs, updateWorkflowGraph, workflowGraphOwner } from "@/lib/workflow/graph-store";
import { startWorkflowGraph, workflowGraphRunStatus } from "@/lib/workflow/graph-engine";
import { listWorkflowGraphRuns } from "@/lib/workflow/graph-run-store";
import { listWorkflowGraphVersions, readWorkflowGraphVersion } from "@/lib/workflow/graph-version-store";
import { workflowNodeCatalog } from "@/lib/workflow/node-catalog";
import { workflowTemplate, workflowTemplates } from "@/lib/workflow/templates";
import { deleteWorkflowVariable, listWorkflowVariables, setWorkflowVariable } from "@/lib/workflow/variables";
import { workflowMatchesQuery } from "@/lib/workflow/search";
import { resolveProjectHint } from "@/lib/host/projects-api";
import { listAutomationScripts } from "@/lib/orchestration/repo-memory-artifacts";
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
    actionContract: { phase: "discover", target: "project-flow", sourceOfTruth: "live", validators: ["project-selection", "flow-definition"], confirmation: "none", concurrency: "revision", presentation: "structured" },
    inputSchema: S({ project, flow }, ["project"]),
    run: async a => { const { project: p, flows, revision } = await flowCatalog(str(a, "project"), typeof a.flow === "string" ? a.flow : undefined); return { project: p.id, revision, flows }; } },
  { name: "flow_run", title: "Run Automation Flow", scope: "exec",
    description: "Run an inspected project flow with exact input/idempotency key. Returns a durable receipt; failed writes are not auto-retried.",
    chatgptDescription: "Run an inspected flow; use flow_status for its receipt.",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    actionContract: { phase: "execute", target: "project-flow", sourceOfTruth: "live", discover: ["flow_catalog"], validators: ["flow-input-schema", "idempotency-key"], verify: ["flow_status"], confirmation: "contextual", concurrency: "compare", presentation: "structured" }, audit: { action: "exec.run", targetArg: "flow" },
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
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    actionContract: { phase: "mutate", target: "project-flow", sourceOfTruth: "live", discover: ["flow_catalog"], validators: ["flow-definition", "revision"], verify: ["flow_catalog"], confirmation: "contextual", concurrency: "revision", presentation: "structured" }, audit: { action: "fs.write", targetArg: "project" },
    inputSchema: S({ project, flow, action: { type: "string", enum: ["upsert", "delete"] }, revision: { type: "string" }, definition: { type: "object", additionalProperties: true } }, ["project", "flow", "action", "revision"]),
    run: async a => {
      const id = str(a, "flow");
      if (BUILTIN_FLOWS.some(flow => flow.id === id)) throw new Error("built-in flow is immutable");
      if (a.action !== "upsert" && a.action !== "delete") throw new Error("action must be upsert or delete");
      const catalog = await flowCatalog(str(a, "project"));
      return manageProjectFlow(catalog.project.path, { action: a.action, id, flow: a.definition, revision: str(a, "revision") });
    } },
  { name: "workflow_graph", title: "Workflow Graph", scope: "exec", limit: { key: "workflow.graph", max: 20, windowMs: 60_000 },
    description: "Private workflow graph CRUD/run plus history, versions, templates, catalog and variable references. Definitions reject embedded secrets.",
    chatgptDescription: "CRUD/run workflows; read node logs.",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }, audit: { action: "exec.run", targetArg: "id" },
    inputSchema: S({ action: { type: "string", minLength: 1, maxLength: 32 }, id: { type: "string", maxLength: 96 }, data: { type: "object", additionalProperties: true }, wait_ms: { type: "integer", minimum: 0, maximum: 25_000 } }, ["action"]),
    run: async (a, context) => {
      const principal = privateGraphPrincipal(context), action = str(a, "action");
      const data = a.data && typeof a.data === "object" && !Array.isArray(a.data) ? a.data as Record<string, unknown> : {};
      if (action === "list" || action === "search") { const graphs = await listWorkflowGraphs(principal), query = typeof data.query === "string" ? data.query : "", filters = { tag: typeof data.tag === "string" ? data.tag : undefined, status: typeof data.status === "string" ? data.status : undefined, project: typeof data.project === "string" ? data.project : undefined, folder: typeof data.folder === "string" ? data.folder : undefined, node: typeof data.node === "string" ? data.node : undefined }; return { graphs: graphs.filter((graph) => workflowMatchesQuery(graph, query, filters)).map(graph => ({ id: graph.id, name: graph.name, description: graph.description, status: graph.status, revision: graph.revision, nodeCount: graph.nodes.length, updatedAt: graph.updatedAt, provenance: graph.metadata.provenance, project: graph.metadata.project, folder: graph.metadata.folder, tags: graph.metadata.tags ?? [] })) }; }
      if (action === "status") return workflowGraphRunStatus(principal, str(a, "id"), Number(a.wait_ms) || 0);
      if (action === "runs") return listWorkflowGraphRuns(workflowGraphOwner(principal), { graphId: typeof data.graph_id === "string" ? data.graph_id : undefined, limit: Number(data.limit) || 30, offset: Number(data.offset) || 0 });
      if (action === "scripts") { const hint = typeof data.project === "string" ? data.project : ""; if (!hint) throw new Error("project is required"); const project = await resolveProjectHint(hint); if (!project || project.matchedBy === "fuzzy") throw new Error("exact project not found"); const query = typeof data.query === "string" ? data.query.toLowerCase().trim() : ""; const scripts = (await listAutomationScripts(project.path)).filter((script) => !query || `${script.id} ${script.intent} ${script.status} ${script.steps.map((step) => step.tool).join(" ")}`.toLowerCase().includes(query)).map((script) => ({ id: script.id, intent: script.intent, status: script.status, stepCount: script.steps.length, updatedAt: script.updatedAt, project: script.project, tools: script.steps.map((step) => step.tool) })); return { project: project.id, scripts }; }
      if (action === "catalog") return { nodes: workflowNodeCatalog(typeof data.query === "string" ? data.query : "") };
      if (action === "templates") return { templates: workflowTemplates() };
      if (action === "variables") return { variables: await listWorkflowVariables(principal) };
      if (action === "variable_set") return setWorkflowVariable(principal, String(data.key ?? ""), data.value, data.secret === true);
      if (action === "variable_delete") return deleteWorkflowVariable(principal, String(data.key ?? ""));
      if (action === "create_from_template") { const row = workflowTemplate(String(data.template_id ?? "")); if (!row) throw new Error("workflow template not found"); return { graph: await createWorkflowGraph(principal, row.definition, "template") }; }
      if (action === "create") return { graph: await createWorkflowGraph(principal, data.definition ?? data) };
      const id = str(a, "id");
      if (action === "get") { const graph = await getWorkflowGraph(principal, id); if (!graph) throw new Error("workflow graph not found"); return { graph }; }
      if (action === "versions") return { versions: await listWorkflowGraphVersions(workflowGraphOwner(principal), id) };
      if (action === "restore") { const current = await getWorkflowGraph(principal, id), snapshot = await readWorkflowGraphVersion(workflowGraphOwner(principal), id, String(data.version ?? "")); if (!current || !snapshot) throw new Error("workflow graph/version not found"); const { revision: _r, createdAt: _c, updatedAt: _u, version: _v, ...definition } = snapshot.graph; return { graph: await updateWorkflowGraph(principal, id, String(data.revision ?? current.revision), definition, "restore") }; }
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
