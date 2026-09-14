import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { inspectScInstallation } from "./sc-installation.mjs";
import type { ProjectMcpServer } from "./project-mcp-config";

/** Only a reviewed, installed package can become this managed local plugin. */
export async function resolveManagedSc(server: Extract<ProjectMcpServer, { transport: "plugin" }>): Promise<Extract<ProjectMcpServer, { transport: "stdio" }>> {
  const installation = await inspectScInstallation(process.env.MSO_SC_BIN || path.join(os.homedir(), ".local", "bin", "sc"));
  const entrypoint = await fs.realpath(installation.mcpEntrypoint);
  const stat = await fs.stat(entrypoint);
  if (!entrypoint.startsWith(installation.root + path.sep) || !stat.isFile() || (stat.mode & 0o022)) throw new Error("unsafe_sc_mcp_entrypoint");
  return { name: server.name, transport: "stdio", command: process.execPath, args: [entrypoint], cwd: server.cwd,
    env: {}, headers: {}, oauthConfigured: false, consumer: "mso" };
}
