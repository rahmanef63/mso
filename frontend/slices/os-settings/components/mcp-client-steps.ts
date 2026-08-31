import {
  codexMcpConfig,
  cursorMcpConfig,
  mcpEndpoints,
  vscodeMcpConfig,
  type McpClientId,
  type McpGuideStep,
} from "./mcp-client-core";

export function mcpClientSteps(client: McpClientId, rawOrigin: string): McpGuideStep[] {
  const endpoints = mcpEndpoints(rawOrigin);

  if (client === "chatgpt") {
    return [
      {
        title: "Enable Developer Mode when required",
        body: "On ChatGPT web, enable Developer Mode if your plan or workspace requires it. Workspace admins can restrict who may create custom MCP apps.",
      },
      {
        title: "Create the MSO app / MCP plugin",
        body: "Open ChatGPT Settings → Plugins → New Plugin. If your workspace still shows Apps → Create, use that equivalent flow. Choose Server URL / Streamable HTTP and paste this endpoint.",
        copy: { label: "Server URL", value: endpoints.mcp },
      },
      {
        title: "Choose OAuth",
        body: "Set Authentication to OAuth. MSO publishes protected-resource and authorization-server discovery, uses PKCE S256, and does not require a client secret.",
      },
      {
        title: "Authorize and scan tools",
        body: "Continue in the browser, sign in to MSO on an approved owner device, choose the lowest scope you need, then return to ChatGPT and run Scan Tools before creating the app.",
      },
      {
        title: "Enable MSO in the chat",
        body: "Enable the MSO app/plugin from ChatGPT's tools or + menu. Start with a read-only request before authorizing write or exec workflows.",
      },
    ];
  }

  if (client === "codex") {
    return [
      {
        title: "Add the remote server",
        body: "Codex CLI, desktop, and the IDE extension share MCP configuration. Add MSO as a Streamable HTTP server.",
        copy: { label: "Codex CLI", value: `codex mcp add mso --url ${endpoints.mcp}`, multiline: true },
      },
      {
        title: "Authenticate with OAuth",
        body: "Run the OAuth login after the URL is registered. Codex opens the browser flow and stores its client-side credential separately from config.toml.",
        copy: { label: "OAuth login", value: "codex mcp login mso" },
      },
      {
        title: "Optional config.toml form",
        body: "Use this when you prefer editing ~/.codex/config.toml directly. Keep secrets out of the file; MSO does not need a static bearer token.",
        copy: { label: "~/.codex/config.toml", value: codexMcpConfig(endpoints.origin), multiline: true },
      },
    ];
  }

  if (client === "claude-code") {
    return [
      {
        title: "Add a remote HTTP MCP server",
        body: "Claude Code supports remote HTTP MCP servers. Register MSO at user or project scope as appropriate.",
        copy: { label: "Claude Code CLI", value: `claude mcp add --transport http mso ${endpoints.mcp}` },
      },
      {
        title: "Complete OAuth from /mcp",
        body: "Open /mcp in Claude Code, choose MSO, and follow the browser authorization flow. Do not put your MSO password or bearer token in the command.",
      },
      {
        title: "Verify the connection",
        body: "Use claude mcp get mso or claude mcp list, then test a read-only MSO operation before granting broader authority.",
        copy: { label: "Verify", value: "claude mcp get mso" },
      },
    ];
  }

  if (client === "cursor") {
    return [
      {
        title: "Add a remote MCP server",
        body: "Open Cursor MCP settings or edit ~/.cursor/mcp.json. This URL form lets Cursor negotiate remote OAuth without embedding credentials.",
        copy: { label: "Cursor mcp.json", value: cursorMcpConfig(endpoints.origin), multiline: true },
      },
      {
        title: "Complete OAuth",
        body: "Let Cursor discover MSO's OAuth metadata and complete the browser authorization flow. MSO also supports Dynamic Client Registration for clients that use it.",
      },
      {
        title: "Verify and refresh tools",
        body: "Confirm MSO is enabled and its tool list is current. Reconnect or refresh the server after the MSO toolset signature changes.",
      },
    ];
  }

  if (client === "gemini") {
    return [
      {
        title: "Add the remote HTTP server",
        body: "Gemini CLI stores MCP servers in settings.json and can add an HTTP endpoint from the command line.",
        copy: { label: "Gemini CLI", value: `gemini mcp add --transport http mso ${endpoints.mcp}` },
      },
      {
        title: "Authorize if prompted",
        body: "Use the client's OAuth flow when it detects MSO's protected-resource metadata. Never hardcode a standing token in a shared project settings file.",
      },
      {
        title: "Verify",
        body: "List MCP servers and make a read-only request first so you can confirm discovery, scope, and tool availability before using mutations.",
        copy: { label: "Verify", value: "gemini mcp list" },
      },
    ];
  }

  if (client === "vscode") {
    return [
      {
        title: "Add an HTTP server",
        body: "Run MCP: Add Server from the Command Palette, choose HTTP, or add this to your user/workspace mcp.json. VS Code tries Streamable HTTP first.",
        copy: { label: "VS Code mcp.json", value: vscodeMcpConfig(endpoints.origin), multiline: true },
      },
      {
        title: "Trust and authenticate",
        body: "Review the MCP trust prompt. VS Code can perform OAuth/Dynamic Client Registration when the remote server advertises it, so no secret belongs in this config.",
      },
      {
        title: "Reset cached tools after updates",
        body: "If MSO's toolset signature changes, run MCP: Reset Cached Tools or restart the server before assuming a newly added tool is unavailable.",
      },
    ];
  }

  return [
    {
      title: "Add a remote Streamable HTTP server",
      body: "In any MCP client that supports Streamable HTTP, add this remote endpoint. Cloud clients need a reachable HTTPS origin or a supported private tunnel.",
      copy: { label: "MCP Server URL", value: endpoints.mcp },
    },
    {
      title: "Use OAuth discovery",
      body: "Prefer protected-resource + authorization-server discovery and PKCE. MSO also exposes Dynamic Client Registration for clients that still use it.",
    },
    {
      title: "Authorize the minimum scope",
      body: "Complete the MSO consent flow and start with read. Raise to write or exec only when the client genuinely needs that authority.",
    },
  ];
}
