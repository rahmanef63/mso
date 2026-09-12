import { createHash } from "node:crypto";
import { projectMcpAuthorization } from "./project-mcp-auth";
import { withProjectMcpServer } from "./project-mcp-transport";
import type { ProjectMcpServer } from "./project-mcp-config";
import type { Rpc } from "./project-mcp-wire";
import type { ProjectMcpTool } from "@/lib/contracts/project-mcp";
export type { ProjectMcpTool } from "@/lib/contracts/project-mcp";
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
export function publicTools(result: unknown): ProjectMcpTool[] {
  if (!object(result) || !Array.isArray(result.tools)) throw new Error("project MCP tools/list returned no tools array");
  return result.tools.map(raw => {
    if (!object(raw) || typeof raw.name !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(raw.name) || !object(raw.inputSchema)) throw new Error("invalid project MCP tool descriptor");
    const kept = Object.fromEntries(["title", "description", "outputSchema", "annotations", "icons", "execution", "_meta"].filter(k => raw[k] !== undefined).map(k => [k, raw[k]]));
    return { name: raw.name, inputSchema: raw.inputSchema, ...kept };
  });
}
function nextCursor(result: unknown): string | undefined {
  const next = (result as { nextCursor?: unknown })?.nextCursor;
  if (next === undefined) return;
  if (typeof next !== "string" || !next || next.length > 4096) throw new Error("project MCP returned an invalid continuation cursor");
  return next;
}
export async function allTools(rpc: (method: string, params?: unknown) => Promise<Rpc>): Promise<ProjectMcpTool[]> {
  const tools: ProjectMcpTool[] = [], seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 8; page++) {
    const result = (await rpc("tools/list", cursor ? { cursor } : {})).result;
    tools.push(...publicTools(result)); cursor = nextCursor(result);
    if (!cursor) return tools;
    if (seen.has(cursor)) throw new Error("project MCP returned a repeated continuation cursor");
    seen.add(cursor);
  }
  throw new Error("project MCP catalog exceeds 8 pages; use paginated project_mcp_tools");
}
type Page = { tools: ProjectMcpTool[]; next?: string; until: number; hash: string };
const cache = new Map<string, Page>();
export async function listMcpToolPage(server: ProjectMcpServer, options: { cursor?: string; limit?: number; refresh?: boolean } = {}) {
  const auth = await projectMcpAuthorization(server);
  const identity = createHash("sha256").update(JSON.stringify({ server: auth.server, allowed: auth.allowed })).digest("hex");
  let remote: string | undefined, offset = 0, expectedHash: string | undefined;
  if (options.cursor) {
    if (options.cursor.length > 8192) throw new Error("invalid project MCP cursor");
    let c; try { c = JSON.parse(Buffer.from(options.cursor, "base64url").toString()); } catch { throw new Error("invalid project MCP cursor"); }
    if (!object(c) || c.identity !== identity || !Number.isSafeInteger(c.offset) || Number(c.offset) < 0 ||
      (c.remote !== undefined && (typeof c.remote !== "string" || c.remote.length > 4096))) throw new Error("project MCP cursor expired or belongs to another connection");
    remote = c.remote as string | undefined; offset = Number(c.offset); expectedHash = typeof c.hash === "string" ? c.hash : undefined;
  }
  const key = identity + ":" + (remote ?? ""), now = Date.now();
  for (const [k,v] of cache) if (v.until <= now) cache.delete(k);
  let page = !options.refresh && server.transport === "http" ? cache.get(key) : undefined;
  const cached = Boolean(page);
  if (!page) {
    const result = await withProjectMcpServer(server, async rpc => (await rpc("tools/list", remote ? { cursor: remote } : {})).result);
    const tools = publicTools(result);
    page = { tools, next: nextCursor(result), until: now + 30_000, hash: createHash("sha256").update(JSON.stringify(tools)).digest("hex") };
    if (page.next === remote && remote !== undefined) throw new Error("project MCP returned a repeated continuation cursor");
    if (server.transport === "http") {
      if (cache.size >= 16) cache.delete(cache.keys().next().value!);
      cache.set(key, page);
    }
  }
  if (expectedHash && page.hash !== expectedHash) throw new Error("project MCP page changed; restart discovery");
  const limit = Math.max(1, Math.min(100, Math.trunc(options.limit ?? 50)));
  if (offset > page.tools.length) throw new Error("project MCP page changed; restart discovery");
  const tools: ProjectMcpTool[] = []; let bytes = 0;
  for (const tool of page.tools.slice(offset, offset + limit)) {
    const size = Buffer.byteLength(JSON.stringify(tool));
    if (tools.length && bytes + size > 48 * 1024) break;
    tools.push(tool); bytes += size;
  }
  const more = offset + tools.length < page.tools.length;
  const next = more ? { identity, remote, offset: offset + tools.length, hash: page.hash } : page.next ? { identity, remote: page.next, offset: 0 } : undefined;
  return { tools, ...(next ? { nextCursor: Buffer.from(JSON.stringify(next)).toString("base64url") } : {}),
    complete: !next, cached, cacheTtlMs: cached ? Math.max(0, page.until - Date.now()) : server.transport === "http" ? 30_000 : 0 };
}
