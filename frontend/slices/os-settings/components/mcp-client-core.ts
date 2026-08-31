export type McpClientId =
  | "chatgpt"
  | "codex"
  | "claude-code"
  | "cursor"
  | "gemini"
  | "vscode"
  | "other";

export type McpEndpointSet = {
  origin: string;
  mcp: string;
  authorize: string;
  token: string;
  register: string;
  protectedResource: string;
  authorizationServer: string;
};

export type McpGuideStep = {
  title: string;
  body: string;
  copy?: { label: string; value: string; multiline?: boolean };
};

export type McpProbeCheckId = "mcp" | "challenge" | "resource" | "oauth";

export type McpProbeResult = {
  ready: boolean;
  checks: Array<{ id: McpProbeCheckId; ok: boolean }>;
};

export const MCP_CLIENTS: Array<{
  id: McpClientId;
  label: string;
  description: string;
  kind: "hosted" | "desktop" | "cli" | "editor" | "generic";
}> = [
  { id: "chatgpt", label: "ChatGPT", description: "Apps / Plugins with OAuth", kind: "hosted" },
  { id: "codex", label: "Codex", description: "CLI, desktop, and IDE", kind: "cli" },
  { id: "claude-code", label: "Claude Code", description: "Remote HTTP + browser OAuth", kind: "cli" },
  { id: "cursor", label: "Cursor", description: "Remote MCP in mcp.json", kind: "editor" },
  { id: "gemini", label: "Gemini CLI", description: "Remote HTTP server", kind: "cli" },
  { id: "vscode", label: "VS Code", description: "MCP: Add Server / mcp.json", kind: "editor" },
  { id: "other", label: "Other MCP", description: "Any Streamable HTTP client", kind: "generic" },
];

export const MCP_PROBE_LABELS: Record<McpProbeCheckId, string> = {
  mcp: "MCP endpoint",
  challenge: "OAuth challenge",
  resource: "Protected resource",
  oauth: "OAuth metadata",
};

export function mcpEndpoints(rawOrigin: string): McpEndpointSet {
  const origin = new URL(rawOrigin).origin;
  return {
    origin,
    mcp: `${origin}/mcp`,
    authorize: `${origin}/oauth/authorize`,
    token: `${origin}/oauth/token`,
    register: `${origin}/oauth/register`,
    protectedResource: `${origin}/.well-known/oauth-protected-resource`,
    authorizationServer: `${origin}/.well-known/oauth-authorization-server`,
  };
}

export function isRemoteMcpOrigin(rawOrigin: string): boolean {
  try {
    const url = new URL(rawOrigin);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && host !== "localhost" && host !== "::1" && host !== "[::1]" && !host.startsWith("127.");
  } catch {
    return false;
  }
}

export function cursorMcpConfig(rawOrigin: string): string {
  const { mcp } = mcpEndpoints(rawOrigin);
  return JSON.stringify({ mcpServers: { mso: { url: mcp } } }, null, 2);
}

export function vscodeMcpConfig(rawOrigin: string): string {
  const { mcp } = mcpEndpoints(rawOrigin);
  return JSON.stringify({ servers: { mso: { type: "http", url: mcp } } }, null, 2);
}

export function codexMcpConfig(rawOrigin: string): string {
  const { mcp } = mcpEndpoints(rawOrigin);
  return `[mcp_servers.mso]\nurl = "${mcp}"`;
}
