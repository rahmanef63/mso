import { inspectProjectMcp, manageProjectMcp } from "@/lib/host/project-mcp-manage";
import { resolveProjectHint } from "@/lib/host/projects-api";
import { type McpTool, S, str } from "./tool-kit";
export const PROJECT_MCP_MANAGE_TOOLS: McpTool[] = [{
  name: "project_mcp_manage", title: "Add or Manage Project MCP", scope: "write",
  description: "Inspect/add/update/remove one HTTP MCP binding in an exact project's .mcp.json. Inspect first for revision; pass it for upsert/delete. Other servers are preserved. Optional exact user/connection references private MCP credentials; never put credentials in url or arguments. Discover with project_mcp_tools after setup.",
  chatgptDescription: "Add or manage a project's HTTP MCP. Inspect for revision, then upsert/delete. Credentials stay in a private connection.",
  meta: { ui: { visibility: ["model", "app"] }, "openai/widgetAccessible": true },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  limit: { key: "project.mcp.manage", max: 20, windowMs: 60_000 },
  audit: { action: "fs.write", targetArg: "project" },
  inputSchema: S({
    project: { type: "string", description: "Exact project id/path/name." },
    action: { type: "string", enum: ["inspect", "upsert", "delete"] },
    server: { type: "string", maxLength: 64, description: "Project-local server alias. Required for mutations." },
    revision: { type: "string", description: "Revision from inspect. Required for mutations." },
    url: { type: "string", maxLength: 4096, description: "HTTPS endpoint without credentials/query/fragment. Required for upsert." },
    user: { type: "string", description: "Exact credential owner; use together with connection." },
    connection: { type: "string", description: "Exact private MCP connection; omit both for public MCP." },
  }, ["project", "action"]),
  run: async a => {
    const project = await resolveProjectHint(str(a, "project"));
    if (!project || project.matchedBy === "fuzzy") throw new Error("exact project required");
    if (a.action === "inspect") return { project: project.id, ...await inspectProjectMcp(project.path) };
    if (a.action !== "upsert" && a.action !== "delete") throw new Error("invalid MCP action");
    return { project: project.id, ...await manageProjectMcp(project.path, { action: a.action, server: str(a, "server"), revision: str(a, "revision"),
      url: typeof a.url === "string" ? a.url : undefined, user: typeof a.user === "string" ? a.user : undefined, connection: typeof a.connection === "string" ? a.connection : undefined }) };
  },
}];
