import { callMcpServerTool, listMcpServerTools } from "@/lib/host/project-mcp-client";
import type { ProjectMcpServer } from "@/lib/host/project-mcp-config";
import { IntegrationError, type ConnectionSelector } from "./identity";
import { normalizeMcpEndpoint, parseMcpToolAllowlist } from "./mcp-policy";
import { directConnectionValues } from "./connection-service";

function serverFrom(values: Record<string, string>): ProjectMcpServer {
  if (!values.endpoint || !values.accessToken) throw new IntegrationError("required_fields_missing");
  return {
    name: "integration-mcp",
    transport: "http",
    url: normalizeMcpEndpoint(values.endpoint),
    headers: { Authorization: `Bearer ${values.accessToken}` },
    oauthConfigured: false,
  };
}

function allowedTool(values: Record<string, string>, tool: string): void {
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(tool)) throw new IntegrationError("invalid_tool_arguments");
  const allowed = parseMcpToolAllowlist(values.allowedTools);
  if (allowed && !allowed.includes(tool)) throw new IntegrationError("mcp_tool_not_allowed", 403);
}

export async function listNamedMcpConnectionTools(selector: ConnectionSelector) {
  const values = await directConnectionValues("mcp", selector);
  const tools = await listMcpServerTools(serverFrom(values));
  const allowed = parseMcpToolAllowlist(values.allowedTools);
  return allowed ? tools.filter((tool) => allowed.includes(tool.name)) : tools;
}

export async function callNamedMcpConnectionTool(selector: ConnectionSelector, tool: string, args: Record<string, unknown>) {
  const values = await directConnectionValues("mcp", selector);
  allowedTool(values, tool);
  return callMcpServerTool(serverFrom(values), tool, args);
}
