import { readProjectMcpServers, type ProjectMcpServer } from "./project-mcp-config";
import { withProjectMcpServer } from "./project-mcp-transport";
import { allTools, listMcpToolPage, type ProjectMcpTool } from "./project-mcp-catalog";
export { withProjectMcpServer } from "./project-mcp-transport";
export type { ProjectMcpTool } from "./project-mcp-catalog";
const MAX_TOOL_ARGS_BYTES = 128 * 1024;
async function selectedServer(projectPath: string, name: string): Promise<ProjectMcpServer> {
  const servers = await readProjectMcpServers(projectPath); const server = servers.find((row) => row.name === name);
  if (!server) throw new Error(`unknown project MCP server "${name}"`); return server;
}
export async function listProjectMcpTools(projectPath: string, serverName: string): Promise<ProjectMcpTool[]> {
  return listMcpServerTools(await selectedServer(projectPath, serverName));
}
export async function callProjectMcpTool(projectPath: string, serverName: string, toolName: string, args: unknown): Promise<unknown> {
  return callMcpServerTool(await selectedServer(projectPath, serverName), toolName, args);
}
export async function listMcpServerTools(server: ProjectMcpServer): Promise<ProjectMcpTool[]> {
  return withProjectMcpServer(server, allTools);
}
export async function callMcpServerTool(server: ProjectMcpServer, toolName: string, args: unknown): Promise<unknown> {
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(toolName)) throw new Error("invalid project MCP tool name");
  if (args != null && (typeof args !== "object" || Array.isArray(args))) throw new Error("MCP tool arguments must be an object");
  const payload = JSON.stringify(args ?? {});
  if (Buffer.byteLength(payload) > MAX_TOOL_ARGS_BYTES) throw new Error("MCP tool arguments exceed 128 KiB");
  return withProjectMcpServer(server, async (rpc) => (await rpc("tools/call", { name: toolName, arguments: args ?? {} })).result);
}

export async function listProjectMcpToolPage(projectPath: string, serverName: string, options: { cursor?: string; limit?: number; refresh?: boolean } = {}) {
 return listMcpToolPage(await selectedServer(projectPath, serverName), options);
}
