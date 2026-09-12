import path from "node:path";
import { promises as fs } from "node:fs";
import { readBoundedRegularFile } from "./bounded-read";
import { resolveReadable } from "./paths";
import { writeFileGuarded, sha256Text } from "./fs-api";
import { readProjectMcpServers, publicProjectMcpServers } from "./project-mcp-config";
import { normalizeMcpEndpoint } from "@/lib/infra/mcp-policy";
import { directConnectionValues } from "@/lib/infra/connection-service";
import { withSecurityStoreLock } from "@/lib/security-store-lock";

const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
async function manifest(projectPath: string) {
  const file = path.join(projectPath, ".mcp.json");
  const stat = await fs.lstat(file).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return null; throw e; });
  if (!stat) return { file, data: { mcpServers: {} } as Record<string, unknown>, revision: "new" };
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("unsafe project MCP manifest");
  await resolveReadable(file);
  const raw = await readBoundedRegularFile(file, 64 * 1024);
  if (raw === null) throw new Error("MCP manifest exceeds 64 KiB");
  const data: unknown = JSON.parse(raw);
  if (!object(data)) throw new Error("invalid MCP manifest");
  if (data.mcpServers !== undefined && data.servers !== undefined) throw new Error("ambiguous MCP manifest; keep one servers key");
  if (!object(data.mcpServers ?? data.servers ?? {})) throw new Error("invalid MCP servers");
  return { file, data, revision: sha256Text(raw) };
}
export async function inspectProjectMcp(projectPath: string) {
  const stored = await manifest(projectPath);
  return { revision: stored.revision, servers: publicProjectMcpServers(await readProjectMcpServers(projectPath)) };
}
export async function manageProjectMcp(projectPath: string, input: { action: "upsert" | "delete"; server: string; revision: string; url?: string; user?: string; connection?: string }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(input.server) || ["__proto__", "constructor", "prototype"].includes(input.server)) throw new Error("invalid MCP server alias");
  return withSecurityStoreLock(path.join(projectPath, ".mcp.json"), async () => {
    const stored = await manifest(projectPath);
    if (stored.revision !== input.revision) throw new Error("MCP revision changed; inspect before editing");
    const key = Object.hasOwn(stored.data, "servers") ? "servers" : "mcpServers";
    const servers = { ...((stored.data[key] ?? {}) as Record<string, unknown>) };
    if (input.action === "delete") delete servers[input.server];
    else {
      const url = normalizeMcpEndpoint(input.url ?? "");
      let integration: { user: string; connection: string } | undefined;
      if (input.user || input.connection) {
        if (![input.user, input.connection].every(v => typeof v === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(v))) throw new Error("exact user and connection required");
        integration = { user: input.user!, connection: input.connection! };
        const values = await directConnectionValues("mcp", integration);
        if (values.endpoint && normalizeMcpEndpoint(values.endpoint) !== url) throw new Error("MCP endpoint does not match the private connection");
      }
      servers[input.server] = { url, ...(integration ? { integration } : {}) };
    }
    if (Object.keys(servers).length > 16) throw new Error("project MCP limit is 16 servers");
    const content = JSON.stringify({ ...stored.data, [key]: servers }, null, 2) + "\n";
    if (Buffer.byteLength(content) > 64 * 1024) throw new Error("MCP manifest exceeds 64 KiB");
    const result = await writeFileGuarded({ path: stored.file, content, ...(stored.revision === "new" ? {} : { expectedSha256: stored.revision }) });
    return { action: input.action, server: input.server, revision: result.sha256, next: "project_mcp_tools discovers the server; credentials use integration_setup_open." };
  });
}
