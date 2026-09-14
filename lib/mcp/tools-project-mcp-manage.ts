import { inspectProjectMcp, manageProjectMcp } from "@/lib/host/project-mcp-manage";
import { resolveProjectHint } from "@/lib/host/projects-api";
import { type McpTool, S, str } from "./tool-kit";
export const PROJECT_MCP_MANAGE_TOOLS: McpTool[] = [{
  name: "project_mcp_manage", title: "Install or Manage Project MCP", scope: "write",
  description: "Inspect/install/update/uninstall one exact project's MCP binding. Fresh projects have no plugin binding and nothing is inherited from parent projects. For reviewed project plugins set plugin=si-coder or plugin=batonly; Batonly also requires an exact MSO credential user/connection. Arbitrary HTTP MCPs still use url. Inspect first for revision; mutations preserve other servers.",
  chatgptDescription: "Manage MCP installation for one exact project. Plugins are absent by default and never inherited; inspect before installing or uninstalling.",
  meta: { ui: { visibility: ["model", "app"] }, "openai/widgetAccessible": true },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  limit: { key: "project.mcp.manage", max: 20, windowMs: 60_000 },
  audit: { action: "fs.write", targetArg: "project" },
  inputSchema: S({
    project: { type: "string", description: "Exact project id/path/name." },
    action: { type: "string", enum: ["inspect", "upsert", "delete"] },
    server: { type: "string", maxLength: 64, description: "Project-local server alias. Required for mutations." },
    revision: { type: "string", description: "Revision from inspect. Required for mutations." },
    plugin: { type: "string", enum: ["si-coder", "batonly"], description: "Reviewed project plugin identity. Installation is exact-project only; no global/default activation." },
    url: { type: "string", maxLength: 4096, description: "HTTPS endpoint without credentials/query/fragment. Required for HTTP upsert; omit with plugin." },
    user: { type: "string", description: "Exact credential owner; use together with connection." },
    connection: { type: "string", description: "Exact private MCP connection; omit both for public MCP." },
  }, ["project", "action"]),
  run: async a => {
    if (a.plugin !== undefined && !["si-coder", "batonly"].includes(String(a.plugin))) throw new Error("unsupported project plugin");
    const project = await resolveProjectHint(str(a, "project"));
    if (!project || project.matchedBy === "fuzzy") throw new Error("exact project required");
    if (a.action === "inspect") return { project: project.id, ...await inspectProjectMcp(project.path) };
    if (a.action !== "upsert" && a.action !== "delete") throw new Error("invalid MCP action");
    return { project: project.id, ...await manageProjectMcp(project.path, { action: a.action, server: str(a, "server"), revision: str(a, "revision"),
      plugin: a.plugin === "si-coder" || a.plugin === "batonly" ? a.plugin : undefined, url: typeof a.url === "string" ? a.url : undefined, user: typeof a.user === "string" ? a.user : undefined, connection: typeof a.connection === "string" ? a.connection : undefined }) };
  },
}];
