import { callMcpServerTool, listMcpServerTools } from "@/lib/host/project-mcp-client";
import type { ProjectMcpServer } from "@/lib/host/project-mcp-config";
import { composioKeyKind } from "./composio";
import { COMPOSIO_MCP_HOSTS, redactComposioMessage } from "./composio-session-contract";
import { IntegrationError } from "./identity";
import { normalizeMcpEndpoint } from "./mcp-policy";
import type { InfraProviderValues } from "./types";

/**
 * Composio Connect (`ck_…`) is a different product from the Platform API, not a
 * lesser key: it is a client credential for the Connect MCP server. The endpoint
 * is a constant, never caller input and never derived from a stored value, so a
 * stored key can never retarget where its own credential is sent.
 */
export const COMPOSIO_CONNECT_MCP_URL = "https://connect.composio.dev/mcp";

/** Same shape the MCP client enforces; kept identical so the guard never loosens it. */
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;

/** One redactor for every message and every payload: an upstream server can echo the key. */
function redactConnectValue(value: unknown, token: string): unknown {
  if (typeof value === "string") return redactComposioMessage(value, [token]);
  if (Array.isArray(value)) return value.map((item) => redactConnectValue(item, token));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [String(redactConnectValue(key, token)), redactConnectValue(item, token)]));
  return value;
}

function connectToken(values: InfraProviderValues): string {
  // Guard order: a Platform key or an empty form must fail before any request,
  // because connect.composio.dev must never receive a Platform credential.
  if (composioKeyKind(values) !== "connect") throw new IntegrationError("composio_connect_key_required", 409);
  const token = (values.apiKey?.trim().startsWith("ck_") ? values.apiKey : values.orgApiKey ?? "").trim();
  if (!/^ck_[\x21-\x7e]{1,4090}$/.test(token)) throw new IntegrationError("invalid_composio_connect_key", 409);
  return token;
}

/** In-memory HTTP server descriptor; no stored integration binding, the caller resolved the token. */
export function composioConnectServer(values: InfraProviderValues): ProjectMcpServer & { transport: "http"; url: string; headers: { Authorization: string } } {
  const token = connectToken(values);
  let url: string;
  try { url = normalizeMcpEndpoint(COMPOSIO_CONNECT_MCP_URL); }
  catch { throw new IntegrationError("invalid_composio_mcp_endpoint", 502); }
  // Constant endpoint: the allowlist check documents the invariant instead of trusting it.
  if (!COMPOSIO_MCP_HOSTS.includes(new URL(url).hostname)) throw new IntegrationError("invalid_composio_mcp_host", 502);
  return { name: "composio-connect", transport: "http", url, headers: { Authorization: "Bearer " + token }, oauthConfigured: false };
}

export async function listComposioConnectTools(values: InfraProviderValues): Promise<{ tools: { name: string; description: string }[] }> {
  const token = connectToken(values);
  let tools;
  try { tools = await listMcpServerTools(composioConnectServer(values)); }
  catch (error) { throw new IntegrationError(String(redactConnectValue(error instanceof Error ? error.message : "composio_connect_tools_failed", token)), 502); }
  return {
    tools: tools
      .map((tool) => ({ name: String(redactConnectValue(tool.name, token)), description: String(redactConnectValue(tool.description ?? "", token)) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function callComposioConnectTool(values: InfraProviderValues, tool: string, args: unknown): Promise<unknown> {
  const token = connectToken(values);
  if (!TOOL_NAME.test(tool)) throw new IntegrationError("invalid_tool_arguments");
  let result: unknown;
  try { result = await callMcpServerTool(composioConnectServer(values), tool, args); }
  catch (error) { throw new IntegrationError(String(redactConnectValue(error instanceof Error ? error.message : "composio_connect_tool_failed", token)), 502); }
  return redactConnectValue(result, token);
}
