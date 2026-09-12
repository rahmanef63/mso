import { resolveProjectHint } from "@/lib/host/projects-api";
import { readProjectFlows } from "@/lib/host/project-flow-manifest";
import { BUILTIN_FLOWS } from "./automation-builtins";
import { flowInputSchema } from "./automation-schema";

export async function flowCatalog(projectHint: string, id?: string) {
  const project = await resolveProjectHint(projectHint);
  if (!project || project.matchedBy === "fuzzy") throw new Error("exact project id/path/name required");
  const stored = await readProjectFlows(project.path);
  if (stored.flows.some(flow => BUILTIN_FLOWS.some(b => b.id === flow.id))) throw new Error("project flow cannot shadow a built-in flow");
  const all = [...BUILTIN_FLOWS, ...stored.flows];
  const flows = id ? all.filter(flow => flow.id === id) : all;
  if (id && !flows.length) throw new Error("unknown flow: " + id);
  return { project, revision: stored.revision, definitions: flows,
    flows: flows.map(flow => !id ? { id: flow.id, description: flow.description, inputs: Object.keys(flow.inputs), requiredScope: "exec", next: "flow_catalog with this flow id returns the complete input schema and steps." } : ({ id: flow.id, description: flow.description, inputSchema: flowInputSchema(flow), steps: flow.steps,
      source: BUILTIN_FLOWS.some(b => b.id === flow.id) ? "builtin" : ".mso/flows.json", requiredScope: "exec",
      context: ["project", "authenticated session", "idempotency_key", "exact user/provider/connection for API steps; server alias for project MCP"],
      execution: "flow_run starts one receipt; flow_status waits up to 25 seconds. Failed/uncertain mutations are never auto-replayed." })) };
}
