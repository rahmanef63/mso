// Stable facade: discovery and execution live in separate modules so read-scope
// manifest parsing cannot accidentally grow process-launch concerns.
export { projectCapabilities } from "./project-function-manifest";
export type { ProjectCapabilities, PublicProjectFunction } from "./project-function-manifest";
export { runProjectFunction } from "./project-function-runner";

export { readProjectMcpServers, publicProjectMcpServers } from "./project-mcp-config";
export type { PublicProjectMcpServer } from "./project-mcp-config";
export { listProjectMcpTools, callProjectMcpTool } from "./project-mcp-client";
