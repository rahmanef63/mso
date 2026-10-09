import path from "node:path";
import { constants, promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolveReadable, safeWritePath } from "./paths";
import { sha256Text } from "./hash";
import { descriptorPath, pinDirectory, readBoundedBytes } from "./fs-descriptors";
import { readProjectMcpServers, publicProjectMcpServers } from "./project-mcp-config";
import { normalizeMcpEndpoint } from "@/lib/infra/mcp-policy";
import { BUILT_IN_PLUGINS } from "@/lib/plugins/manifest";
import type { ProjectPluginId } from "@/lib/contracts/project-mcp";
import { directConnectionValues } from "@/lib/infra/connection-service";
import { withSecurityStoreLock } from "@/lib/security-store-lock";

const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
// Only this dedicated manager accesses the fixed credential-bearing manifest basename.
async function manifestText(file: string): Promise<string | null> {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
  if (!handle) return null;
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > 64 * 1024) throw new Error("unsafe or oversized project MCP manifest");
    const raw = (await readBoundedBytes(handle, 64 * 1024)).toString("utf8");
    const after = await handle.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error("MCP manifest changed while reading");
    return raw;
  } finally { await handle.close(); }
}
async function manifest(projectPath: string) {
  const file = path.join(projectPath, ".mcp.json");
  const stat = await fs.lstat(file).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return null; throw e; });
  if (!stat) return { file, data: { mcpServers: {} } as Record<string, unknown>, revision: "new" };
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("unsafe project MCP manifest");
  const held = await pinDirectory(await resolveReadable(projectPath), false);
  let raw: string | null;
  try { raw = await manifestText(`/proc/self/fd/${held.handle.fd}/.mcp.json`); await descriptorPath(held.handle, false); }
  finally { await held.handle.close(); }
  if (raw === null) throw new Error("MCP manifest disappeared; inspect before editing");
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw new Error("invalid MCP manifest JSON"); }
  if (!object(data)) throw new Error("invalid MCP manifest");
  if (data.mcpServers !== undefined && data.servers !== undefined) throw new Error("ambiguous MCP manifest; keep one servers key");
  if (!object(data.mcpServers ?? data.servers ?? {})) throw new Error("invalid MCP servers");
  return { file, data, revision: sha256Text(raw) };
}
export async function inspectProjectMcp(projectPath: string) {
  const stored = await manifest(projectPath);
  return { revision: stored.revision, servers: publicProjectMcpServers(await readProjectMcpServers(projectPath)) };
}
export async function manageProjectMcp(projectPath: string, input: { action: "upsert" | "delete"; server: string; revision: string; plugin?: ProjectPluginId; url?: string; user?: string; connection?: string }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(input.server) || ["__proto__", "constructor", "prototype"].includes(input.server)) throw new Error("invalid MCP server alias");
  return withSecurityStoreLock(path.join(projectPath, ".mcp.json"), async () => {
    const stored = await manifest(projectPath);
    if (stored.revision !== input.revision) throw new Error("MCP revision changed; inspect before editing");
    const key = Object.hasOwn(stored.data, "servers") ? "servers" : "mcpServers";
    const servers = { ...((stored.data[key] ?? {}) as Record<string, unknown>) };
    if (input.action === "delete") delete servers[input.server];
    else {
      if (input.plugin) {
        if (input.url) throw new Error("project plugins resolve their endpoint from the reviewed catalog");
        if (input.plugin === "si-coder") {
          if (input.user || input.connection) throw new Error("managed SC has no copied account configuration");
          servers[input.server] = { plugin: "si-coder", credentialAuthority: "mso" };
        } else if (input.plugin === "batonly") {
          if (![input.user, input.connection].every(value => typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value))) throw new Error("Batonly installation requires exact user and connection");
          const descriptor = BUILT_IN_PLUGINS.find(plugin => plugin.id === "batonly")?.mcp?.find(row => row.transport === "https");
          if (!descriptor || descriptor.transport !== "https") throw new Error("Batonly plugin endpoint is unavailable");
          const integration = { user: input.user!, connection: input.connection! };
          const values = await directConnectionValues("mcp", integration);
          if (!values.endpoint || normalizeMcpEndpoint(values.endpoint) !== normalizeMcpEndpoint(descriptor.endpoint)) throw new Error("Batonly MCP connection must target the reviewed Batonly endpoint");
          servers[input.server] = { plugin: "batonly", credentialAuthority: "mso", integration };
        } else throw new Error("unsupported project plugin");
      } else {
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
    }
    if (Object.keys(servers).length > 16) throw new Error("project MCP limit is 16 servers");
    const content = JSON.stringify({ ...stored.data, [key]: servers }, null, 2) + "\n";
    if (Buffer.byteLength(content) > 64 * 1024) throw new Error("MCP manifest exceeds 64 KiB");
    const held = await pinDirectory(await safeWritePath(projectPath, true), true);
    const destination = `/proc/self/fd/${held.handle.fd}/.mcp.json`, temporary = `${destination}.${randomUUID()}.tmp`;
    let handle;
    try {
      await descriptorPath(held.handle, false);
      const current = await manifestText(destination);
      if ((current === null ? "new" : sha256Text(current)) !== stored.revision) throw new Error("MCP revision changed; inspect before editing");
      handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      await handle.writeFile(content, "utf8"); await handle.close(); handle = undefined;
      await descriptorPath(held.handle, true);
      await fs.rename(temporary, destination);
    } finally { await handle?.close(); await fs.unlink(temporary).catch(() => undefined); await held.handle.close(); }
    const result = { sha256: sha256Text(content) };
    return { action: input.action, server: input.server, revision: result.sha256, next: input.action === "delete"
      ? "Removed only from the selected project; other projects and Integrations credentials are unchanged."
      : "Installed only in the selected project; use project_mcp_tools for discovery evidence." };
  });
}
