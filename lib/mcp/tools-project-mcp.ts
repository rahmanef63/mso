import { callProjectMcpTool, listProjectMcpTools, publicProjectMcpServers, readProjectMcpServers, resolveProjectHint } from "@/lib/host/projects-api";
import { type McpTool, S, str } from "./tool-kit";

export const PROJECT_MCP_TOOLS: McpTool[] = [
  {
    name: "project_mcp_tools",
    title: "List Project MCP Tools",
    description: "Discover tools from one MCP server declared by an explicitly selected project's .mcp.json. Server aliases and tool schemas are returned on demand; config, env, headers, and credentials are never returned and project tools never join MSO's global catalog.",
    chatgptDescription: "List tools from one MCP server declared by a selected project's .mcp.json. Project tool names stay dynamic and never enter MSO's global catalog.",
    scope: "exec",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: false },
    audit: { action: "exec.run" as const, targetArg: "server" },
    limit: { key: "projects.mcp.read", max: 30, windowMs: 60_000 },
    inputSchema: S({
      project: { type: "string", description: "Exact project id/path/name from projects_list." },
      server: { type: "string", description: "MCP server alias returned by project_capabilities." },
    }, ["project", "server"]),
    run: async (a) => {
      const project = await resolveProjectHint(str(a, "project")); if (!project) throw new Error(`project not found: ${String(a.project)}`);
      const servers = publicProjectMcpServers(await readProjectMcpServers(project.path));
      const selected = servers.find((server) => server.name === str(a, "server")); if (!selected) throw new Error("project MCP server not found");
      return { project: { id: project.id, name: project.name }, server: selected, tools: await listProjectMcpTools(project.path, selected.name) };
    },
  },
  {
    name: "project_mcp_call",
    title: "Call Project MCP Tool",
    description: "Call one exact tool on one MCP server declared by a validated project's .mcp.json. The project MCP configuration stays server-side; MSO launches/calls it with credential-scrubbed process environment or a guarded remote transport and returns only the MCP tool result.",
    chatgptDescription: "Call one exact tool from a selected project's MCP server. The project's MCP config and credentials stay server-side.",
    scope: "exec",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: false },
    limit: { key: "projects.mcp.call", max: 30, windowMs: 60_000 },
    audit: { action: "exec.run" as const, targetArg: "server" },
    result: { maxTextBytes: 64 * 1024, overflowHint: "Project MCP result was compacted; request a narrower project tool call." },
    inputSchema: S({
      project: { type: "string", description: "Exact project id/path/name from projects_list." },
      server: { type: "string", description: "Project MCP server alias from project_capabilities." },
      tool: { type: "string", description: "Exact tool name from project_mcp_tools." },
      arguments: { type: "object", description: "Arguments matching that dynamic tool's input schema.", additionalProperties: true },
    }, ["project", "server", "tool"]),
    run: async (a) => {
      const project = await resolveProjectHint(str(a, "project")); if (!project) throw new Error(`project not found: ${String(a.project)}`);
      return { project: { id: project.id, name: project.name }, server: str(a, "server"), tool: str(a, "tool"), result: await callProjectMcpTool(project.path, str(a, "server"), str(a, "tool"), a.arguments ?? {}) };
    },
  },
];
