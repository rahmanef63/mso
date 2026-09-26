import { resolveMcpInstallTarget } from "@/lib/host/mcp-install-target";
import { callManagedScProvider } from "./managed-sc-call";
import { projectMcpResult, projectMcpStructuredProjection } from "@/lib/host/project-mcp-result";
import { callProjectMcpTool, listProjectMcpToolPage, publicProjectMcpServers, readProjectMcpServers } from "@/lib/host/projects-api";
import { type McpTool, S, str, mcpDirect } from "./tool-kit";
import { requireWorkflowProjectTarget } from "./workflow-workspace-guard";

export const PROJECT_MCP_TOOLS: McpTool[] = [
  {
    name: "project_mcp_tools",
    result: { maxTextBytes: 64 * 1024, overflowHint: "Use limit=1 for a narrower descriptor page; preserve the exact nextCursor." },
    title: "List Project MCP Tools",
    description: "Discover tools from one MCP server declared by an explicitly selected project's .mcp.json. Server aliases and tool schemas are returned on demand; config, env, headers, and credentials are never returned and project tools never join MSO's global catalog.",
    chatgptDescription: "Discover live tools of an installed MCP. project=@host selects this VPS; other values select an exact project. Find aliases with project_mcp_manage inspect. Follow nextCursor; refresh bypasses descriptor cache.",
    scope: "exec",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: false },
    actionContract: { phase: "discover", target: "project-mcp", sourceOfTruth: "provider", discover: ["project_capabilities"], validators: ["project-selection", "private-connection"], confirmation: "none", concurrency: "provider", presentation: "structured" },
    audit: { action: "exec.run" as const, targetArg: "server" },
    limit: { key: "projects.mcp.read", max: 30, windowMs: 60_000 },
    inputSchema: S({
      project: { type: "string", description: "Exact project id/path/name from projects_list, or @host for host-installed MCPs." },
      server: { type: "string", description: "MCP server alias returned by project_capabilities." },
      cursor: { type: "string", maxLength: 8192, description: "Exact nextCursor from the previous page." },
      limit: { type: "integer", minimum: 1, maximum: 100 }, refresh: { type: "boolean", description: "Bypass the 30-second HTTP descriptor cache." },
    }, ["project", "server"]),
    run: async (a) => {
      const project = await resolveMcpInstallTarget(str(a, "project"));
      const servers = publicProjectMcpServers(await readProjectMcpServers(project.path));
      const selected = servers.find((server) => server.name === str(a, "server")); if (!selected) throw new Error("project MCP server not found");
      return { project: { id: project.id, name: project.name }, server: selected, ...await listProjectMcpToolPage(project.path, selected.name, { cursor: typeof a.cursor === "string" ? a.cursor : undefined, limit: Number(a.limit) || 50, refresh: a.refresh === true }) };
    },
  },
  {
    name: "project_mcp_call",
    title: "Call Project MCP Tool",
    description: "Call one exact tool on one MCP server declared by a validated project's .mcp.json. The project MCP configuration stays server-side; MSO launches/calls it with credential-scrubbed process environment or a guarded remote transport and returns only the MCP tool result.",
    chatgptDescription: "Call one discovered tool through MSO to an installed external MCP. Use project=@host for this VPS or an exact project. Config, credentials, and authorization stay server-side; inspect and discover first.",
    scope: "exec",
    outputSchema: { type: "object", properties: { result: { type: "object" } }, required: ["result"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: false },
    actionContract: { phase: "execute", target: "project-mcp", sourceOfTruth: "provider", discover: ["project_capabilities", "project_mcp_tools"], validators: ["dynamic-input-schema", "project-scope", "private-connection"], confirmation: "contextual", concurrency: "provider", presentation: "tool-owned" },
    limit: { key: "projects.mcp.call", max: 30, windowMs: 60_000 },
    audit: { action: "exec.run" as const, targetArg: "server" },
    result: { maxTextBytes: 64 * 1024, overflowHint: "Project MCP result was compacted; request a narrower project tool call." },
    inputSchema: S({
      project: { type: "string", description: "Exact project id/path/name from projects_list, or @host for host-installed MCPs." },
      server: { type: "string", description: "Project MCP server alias from project_capabilities." },
      tool: { type: "string", description: "Exact tool name from project_mcp_tools." },
      arguments: { type: "object", description: "Arguments matching that dynamic tool's input schema.", additionalProperties: true },
    }, ["project", "server", "tool"]),
    run: async (a, context) => {
      const project = await resolveMcpInstallTarget(str(a, "project"));
      if (project.installationScope === "project") await requireWorkflowProjectTarget(context, project.path);
      const managed = await callManagedScProvider(project.path, str(a, "server"), str(a, "tool"), a.arguments ?? {});
      const out = projectMcpResult(managed.handled ? managed.result : await callProjectMcpTool(project.path, str(a, "server"), str(a, "tool"), a.arguments ?? {}));
      return mcpDirect(out.content, out.isError, { result: { project: project.id, server: str(a, "server"), tool: str(a, "tool"), output: projectMcpStructuredProjection(out) } }, out.meta);
    },
  },
];
