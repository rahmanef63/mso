import type { PublicProjectMcpServer } from "@/lib/contracts/project-mcp";
import { promises as fs } from "node:fs";
import path from "node:path";
import { BOUNDED_READ, readBoundedRegularFile } from "./bounded-read";
import { isUnderRoot } from "./paths";
import { PROJECT_MCP_REL } from "./project-function-manifest";

const MAX_SERVERS = 16;
const MAX_ARGV = 32;
const MAX_VALUE = 4096;

type BaseServer = { protocolVersion?: "2026-07-28"; integration?: { user: string; connection: string }; name: string; headers: Record<string, string>; oauthConfigured: boolean };
export type ProjectMcpServer = BaseServer & (
  | { transport: "stdio"; command: string; args: string[]; cwd: string; env: Record<string, string> }
  | { transport: "http"; url: string }
);
export type { PublicProjectMcpServer } from "@/lib/contracts/project-mcp";

const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const strings = (v: unknown, max: number): string[] => Array.isArray(v) && v.length <= max && v.every((x) => typeof x === "string" && x.length <= MAX_VALUE && !x.includes("\0")) ? v : [];
function stringMap(v: unknown, max = 32): Record<string, string> {
  if (!object(v) || Object.keys(v).length > max) return {};
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(v)) {
    if (!/^[A-Za-z_][A-Za-z0-9_-]{0,127}$/.test(k) || typeof raw !== "string" || raw.length > MAX_VALUE || raw.includes("\0")) continue;
    out[k] = raw;
  }
  return out;
}
function projectCwd(projectPath: string, raw: unknown): string {
  const candidate = typeof raw === "string" && raw.trim() ? (path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(projectPath, raw)) : path.resolve(projectPath);
  if (!isUnderRoot(candidate, projectPath) && candidate !== path.resolve(projectPath)) throw new Error("project MCP cwd must stay inside the project");
  return candidate;
}

export async function readProjectMcpServers(projectPath: string): Promise<ProjectMcpServer[]> {
  const file = path.join(projectPath, PROJECT_MCP_REL);
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat) return [];
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${PROJECT_MCP_REL} must be a regular non-symlink file`);
  const raw = await readBoundedRegularFile(file, BOUNDED_READ.projectMcpConfig);
  if (raw === null) throw new Error(`${PROJECT_MCP_REL} is unreadable or too large`);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error(`${PROJECT_MCP_REL} is not valid JSON`); }
  if (!object(parsed)) throw new Error(`${PROJECT_MCP_REL} must be a JSON object`);
  const servers = object(parsed.mcpServers) ? parsed.mcpServers : object(parsed.servers) ? parsed.servers : {};
  const entries = Object.entries(servers);
  if (entries.length > MAX_SERVERS) throw new Error(`${PROJECT_MCP_REL} exceeds ${MAX_SERVERS} servers`);
  const out: ProjectMcpServer[] = [];
  for (const [name, value] of entries) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(name) || !object(value)) continue;
    if (value.protocolVersion !== undefined && value.protocolVersion !== "2026-07-28") throw new Error("project MCP protocolVersion override must be 2026-07-28");
    const protocolVersion = value.protocolVersion as "2026-07-28" | undefined;
    const headers = stringMap(value.headers);
    const oauthConfigured = object(value.oauth);
    let integration: BaseServer["integration"];
    if (value.integration !== undefined) {
      const ref = value.integration;
      if (!object(ref) || Object.keys(ref).some((key) => !["user", "connection"].includes(key)) ||
        typeof ref.user !== "string" || typeof ref.connection !== "string" ||
        ![ref.user, ref.connection].every((id) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(id))) throw new Error(`${name}: invalid MCP integration reference`);
      if (value.command || oauthConfigured || Object.keys(headers).some((key) => key.toLowerCase() === "authorization")) throw new Error(`${name}: conflicting MCP authentication configuration`);
      integration = { user: ref.user, connection: ref.connection };
    }
    if (typeof value.command === "string" && value.command.trim() && value.command.length <= MAX_VALUE) {
      const args = value.args === undefined ? [] : strings(value.args, MAX_ARGV);
      if (value.args !== undefined && !args.length && Array.isArray(value.args) && value.args.length) throw new Error(`${name}: invalid args`);
      out.push({ name, protocolVersion, transport: "stdio", command: value.command, args, cwd: projectCwd(projectPath, value.cwd), env: stringMap(value.env, 64), headers, oauthConfigured });
      continue;
    }
    if (typeof value.url === "string" && value.url.length <= MAX_VALUE) {
      out.push({ name, protocolVersion, transport: "http", url: value.url, headers, oauthConfigured, ...(integration ? { integration } : {}) });
    }
  }
  return out;
}

export function publicProjectMcpServers(servers: ProjectMcpServer[]): PublicProjectMcpServer[] {
  return servers.map((server) => ({ name: server.name, transport: server.transport, auth: server.integration ? "integration" : server.oauthConfigured ? "oauth" : Object.keys(server.headers).length ? "configured" : "none" }));
}
