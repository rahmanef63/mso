import { metadataOnly } from "@/lib/infra/identity";
import type { ProjectMcpTool } from "@/lib/contracts/project-mcp";

/** Managed SC keeps developer utilities, not a second account/provider control plane. */
const WORKSPACE_TOOLS = new Set([
  "sc.product.interview", "sc.deploy.plan", "sc.version", "sc.task.risk", "sc.task.prepare",
  "sc.skill.verify", "sc.verify", "sc.recipe.list", "sc.flow.list", "sc.flow.show", "sc.flow.validate",
]);
type NativeRoute = { view?: string; required: string[]; fields: string[]; description: string };
const ROUTES: Record<string, NativeRoute> = {
  "sc.user.list": { view: "users", required: [], fields: [], description: "List native MSO integration users; not the standalone SC store." },
  "sc.providers.list": { view: "catalog", required: [], fields: [], description: "List the native MSO provider catalog." },
  "sc.user.which": { view: "which", required: ["cwd"], fields: ["cwd"], description: "Resolve an exact directory using MSO folder bindings." },
  "sc.user.connections.list": { view: "connections", required: ["user"], fields: ["user", "provider"], description: "List an explicit user's native MSO connections." },
  "sc.user.connection.request": { view: "request", required: ["user", "provider"], fields: ["user", "provider", "connection", "source", "authMethod"], description: "Get native MSO setup metadata. Enter values only in MSO Integrations." },
  "sc.user.credentials.status": { view: "request", required: ["user", "provider", "connection"], fields: ["user", "provider", "connection"], description: "Inspect the exact native MSO connection without returning values." },
  "sc.user.provider.verify": { required: ["user", "provider", "connection"], fields: ["user", "provider", "connection"], description: "Verify one exact MSO connection; never fall back to standalone SC accounts." },
};
const nativeRoute = (name: string) => Object.hasOwn(ROUTES, name) ? ROUTES[name] : undefined;
export function managedScTools(tools: ProjectMcpTool[]): ProjectMcpTool[] {
  return tools.flatMap(tool => {
    const route = nativeRoute(tool.name);
    if (route) return [{ ...tool, description: "MSO-managed: " + route.description,
      inputSchema: { type: "object", properties: Object.fromEntries(route.fields.map(field => [field, { type: "string", maxLength: field === "cwd" ? 4096 : 64 }])), required: route.required, additionalProperties: false } }];
    return WORKSPACE_TOOLS.has(tool.name) ? [tool] : [];
  });
}
export async function managedScCall(name: string, raw: unknown, executeNative?: (mode: "query" | "execute", args: Record<string, unknown>) => Promise<unknown>): Promise<{ handled: false } | { handled: true; result: unknown }> {
  if (WORKSPACE_TOOLS.has(name)) return { handled: false };
  const route = nativeRoute(name);
  if (!route) throw new Error("Tool unavailable in MSO-managed SC. Use native MSO Integrations for provider actions, or explicitly use standalone SC.");
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("SC tool arguments must be an object");
  const args = raw as Record<string, unknown>;
  metadataOnly(args);
  if (Object.keys(args).some(key => !route.fields.includes(key)) || Object.values(args).some(value => typeof value !== "string")) throw new Error("invalid_managed_sc_fields");
  if (route.required.some(field => typeof args[field] !== "string" || !String(args[field]).trim())) throw new Error("explicit_mso_connection_context_required");
  const input = { ...args, ...(args.provider === "cf" ? { provider: "cloudflare" } : {}) };
  if (!executeNative) throw new Error("MSO-managed provider functions require the project_mcp_call capability");
  const result = await executeNative(route.view ? "query" : "execute", route.view ? { ...input, view: route.view } : { ...input, operation: "verify" });
  const structuredContent = { authority: "mso", result };
  return { handled: true, result: { content: [{ type: "text", text: JSON.stringify(structuredContent) }], structuredContent } };
}
