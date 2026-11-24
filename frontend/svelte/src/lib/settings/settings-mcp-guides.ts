import type { McpClientGuide } from "./settings-mcp-types.ts";
import { normalizeMcpOrigin } from "./settings-mcp-origin.ts";

export function buildMcpClientGuides(rawOrigin: string, patToken?: string): McpClientGuide[] {
  const origin = normalizeMcpOrigin(rawOrigin);
  const mcpUrl = `${origin}/mcp`;
  const authHeader = `Bearer ${patToken?.trim() || "<YOUR_PAT_TOKEN>"}`;
  return [
    {
      id: "claude-code",
      label: "Claude Code",
      summary: "Remote Streamable HTTP with browser OAuth or bearer PAT.",
      steps: [
        "Run the CLI add command below in your terminal.",
        "Start Claude Code and approve the OAuth prompt or pass a Personal Access Token header.",
      ],
      snippetLabel: "Claude Code CLI",
      snippet: `claude mcp add --transport http mso ${mcpUrl}`,
    },
    {
      id: "cursor",
      label: "Cursor",
      summary: "Add MSO as a remote MCP server inside .cursor/mcp.json.",
      steps: [
        "Open Cursor Settings -> Tools & MCP -> Add Custom MCP.",
        "Paste the JSON block into ~/.cursor/mcp.json and reload MCP tools.",
      ],
      snippetLabel: "mcp.json",
      snippet: JSON.stringify(
        { mcpServers: { mso: { url: mcpUrl, headers: { Authorization: authHeader } } } },
        null,
        2,
      ),
    },
    {
      id: "chatgpt",
      label: "ChatGPT",
      summary: "Connect via ChatGPT Apps / Plugins with OAuth discovery.",
      steps: [
        "Open ChatGPT Settings -> Apps / Connectors -> Create new MCP app.",
        `Enter ${mcpUrl} as the MCP Server URL and select OAuth authentication.`,
        "Complete the MSO owner approval screen to grant scoped access.",
      ],
      snippetLabel: "MCP Endpoint URL",
      snippet: mcpUrl,
    },
    {
      id: "codex",
      label: "Codex",
      summary: "Register MSO in ~/.codex/config.toml.",
      steps: [
        "Add the TOML block below to ~/.codex/config.toml.",
        "Restart Codex to load the MSO toolset.",
      ],
      snippetLabel: "config.toml",
      snippet: `[mcp_servers.mso]\nurl = "${mcpUrl}"`,
    },
    {
      id: "vscode",
      label: "VS Code",
      summary: "Configure Streamable HTTP MCP in .vscode/mcp.json.",
      steps: [
        "Run Command Palette -> MCP: Open User Configuration.",
        "Paste the server entry below and authenticate when prompted.",
      ],
      snippetLabel: "mcp.json",
      snippet: JSON.stringify(
        { servers: { mso: { type: "http", url: mcpUrl } } },
        null,
        2,
      ),
    },
    {
      id: "antigravity",
      label: "Antigravity",
      summary: "Attach MSO with a scoped Personal Access Token header.",
      steps: [
        "Generate a Personal Access Token below with the lowest scope needed.",
        "Add the JSON block to your Antigravity MCP configuration.",
      ],
      snippetLabel: "MCP Config",
      snippet: JSON.stringify(
        { mso: { url: mcpUrl, headers: { Authorization: authHeader } } },
        null,
        2,
      ),
    },
  ];
}
