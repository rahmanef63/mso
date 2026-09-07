import { directConnectionValues } from "@/lib/infra/connection-service";
import { normalizeMcpEndpoint, parseMcpToolAllowlist } from "@/lib/infra/mcp-policy";
import type { ProjectMcpServer } from "./project-mcp-config";

export async function projectMcpAuthorization(server: ProjectMcpServer) {
  const binding = server.integration;
  if (!binding) return { server, allowed: null as string[] | null, redact: (value: unknown) => value };
  if (server.transport !== "http") throw new Error("integration bindings require HTTP MCP");
  const values = await directConnectionValues("mcp", { user: binding.user, connection: binding.connection });
  if (!values.accessToken || !values.endpoint) throw new Error("project MCP connection requires private setup in MSO Integrations");
  if (normalizeMcpEndpoint(server.url) !== normalizeMcpEndpoint(values.endpoint)) {
    throw new Error("project MCP endpoint does not match the private connection");
  }
  const allowed = parseMcpToolAllowlist(values.allowedTools);
  const token = values.accessToken;
  const redact = (value: unknown): unknown => {
    // A downstream server can echo credentials in descriptions, errors or results.
    if (typeof value === "string") return value.split(token).join("[redacted]");
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [String(redact(key)), redact(item)]));
    return value;
  };
  return {
    server: { ...server, headers: { ...server.headers, Authorization: "Bearer " + token } },
    allowed, redact
  };
}
