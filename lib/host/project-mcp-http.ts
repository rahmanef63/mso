import { createHash, randomUUID } from "node:crypto";
import { safeProviderFetch } from "./ssrf";
import { readMcpResponse, type Rpc } from "./project-mcp-wire";
import { mcpArgumentHeaders, mcpHeaderBindings, mcpHeaderValue } from "./project-mcp-headers";
import type { ProjectMcpServer } from "./project-mcp-config";
const MODERN = "2026-07-28", LEGACY = "2025-11-25";
type Server = Extract<ProjectMcpServer, { transport: "http" }>;
type Connection = { protocol: string; sessionId?: string; until: number; tools: Map<string, ReturnType<typeof mcpHeaderBindings>> };
const connections = new Map<string, Connection>();
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const meta = { "io.modelcontextprotocol/protocolVersion": MODERN, "io.modelcontextprotocol/clientCapabilities": {}, "io.modelcontextprotocol/clientInfo": { name: "mso-project-mcp", version: "2" } };
function failure(message: Rpc) { if (message.error) throw new Error("project MCP error " + message.error.code + ": " + (message.error.message ?? "request failed")); }
async function post(server: Server, method: string, params: unknown, connection: Connection, deadline: number, bindings?: ReturnType<typeof mcpHeaderBindings>, notification = false) {
  if (Date.now() >= deadline) throw new Error("project MCP session timed out");
  const modern = connection.protocol === MODERN, id = notification ? undefined : randomUUID();
  const input = object(params) ? params : {}, body = { jsonrpc: "2.0", ...(id ? { id } : {}), method, params: modern ? { ...input, _meta: { ...(object(input._meta) ? input._meta : {}), ...meta } } : input };
  const headers = new Headers();
  for (const [name, value] of Object.entries(server.headers)) {
    if (["host", "content-length", "connection", "mcp-session-id", "mcp-protocol-version", "mcp-method", "mcp-name"].includes(name.toLowerCase()) || name.toLowerCase().startsWith("mcp-param-")) continue;
    headers.set(name, value);
  }
  headers.set("Content-Type", "application/json"); headers.set("Accept", "application/json, text/event-stream"); headers.set("MCP-Protocol-Version", connection.protocol);
  if (modern) {
    headers.set("Mcp-Method", method);
    const name = method === "resources/read" ? input.uri : input.name;
    if (["tools/call", "resources/read", "prompts/get"].includes(method) && typeof name === "string") headers.set("Mcp-Name", mcpHeaderValue(name));
    for (const [key, value] of Object.entries(mcpArgumentHeaders(bindings ?? [], input.arguments))) headers.set(key, value);
  } else if (connection.sessionId) headers.set("Mcp-Session-Id", connection.sessionId);
  const response = await safeProviderFetch(server.url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
  const sessionId = response.headers.get("mcp-session-id") ?? undefined;
  if (notification && response.ok) { await response.body?.cancel(); return { message: {} as Rpc, status: response.status, sessionId }; }
  if (!response.ok && ![400, 404, 405].includes(response.status)) { await response.body?.cancel(); throw new Error("project MCP HTTP " + response.status + "; check endpoint, connection and token scope"); }
  let message: Rpc;
  try { message = await readMcpResponse(response, id); } catch (e) { if (response.ok) throw e; message = {}; }
  return { message, status: response.status, sessionId };
}
function rememberTools(message: Rpc, connection: Connection) {
  if (!object(message.result) || !Array.isArray(message.result.tools)) return;
  message.result.tools = message.result.tools.filter(tool => {
    if (!object(tool) || typeof tool.name !== "string") return false;
    try { connection.tools.set(tool.name, mcpHeaderBindings(tool.inputSchema)); return true; }
    catch { connection.tools.delete(tool.name); return false; }
  });
}
function complete(message: Rpc) {
  failure(message);
  if (!object(message.result) || message.result.resultType !== "complete") throw new Error("modern MCP result must be complete; input_required is unsupported by this connection");
}
export async function withHttp<T>(server: Server, work: (rpc: (method: string, params?: unknown) => Promise<Rpc>) => Promise<T>): Promise<T> {
  if (server.oauthConfigured && !Object.keys(server.headers).some(name => name.toLowerCase() === "authorization")) throw new Error("project MCP OAuth requires a private server-side authorization connection");
  const deadline = Date.now() + 15_000, key = createHash("sha256").update(JSON.stringify(server)).digest("hex");
  for (const [k,c] of connections) if (c.until < Date.now()) connections.delete(k);
  let connection = connections.get(key);
  if (!connection) {
    connection = { protocol: MODERN, until: Date.now() + 30_000, tools: new Map() };
    const probe = await post(server, "server/discover", {}, connection, deadline);
    if (probe.status >= 400 || probe.message.error && ![-32022, -32020, -32602].includes(probe.message.error.code ?? 0)) {
      if (probe.message.error?.code === -32022) throw new Error("downstream MCP requires an unsupported modern protocol version");
      if (![400, 404, 405].includes(probe.status) || probe.message.error && [-32020, -32602].includes(probe.message.error.code ?? 0)) failure(probe.message);
      connection.protocol = LEGACY;
      const init = await post(server, "initialize", { protocolVersion: LEGACY, capabilities: {}, clientInfo: { name: "mso-project-mcp", version: "2" } }, connection, deadline);
      failure(init.message);
      if (init.status !== 200 || !object(init.message.result) || typeof init.message.result.protocolVersion !== "string" || !["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"].includes(init.message.result.protocolVersion)) throw new Error("invalid legacy MCP initialization");
      connection.protocol = init.message.result.protocolVersion; connection.sessionId = init.sessionId;
      await post(server, "notifications/initialized", {}, connection, deadline, undefined, true);
    } else complete(probe.message);
    if (connections.size >= 16) connections.delete(connections.keys().next().value!);
    connections.set(key, connection);
  }
  const active = connection;
  async function rpc(method: string, params?: unknown): Promise<Rpc> {
    const input = object(params) ? params : {}, modern = active.protocol === MODERN;
    if (modern && method === "tools/call" && typeof input.name === "string" && !active.tools.has(input.name)) {
      const seen = new Set<string>(); let cursor: string | undefined;
      do {
        const page = await rpc("tools/list", cursor ? { cursor } : {});
        cursor = object(page.result) && typeof page.result.nextCursor === "string" ? page.result.nextCursor : undefined;
        if (active.tools.has(input.name)) break;
        if (cursor && seen.has(cursor)) throw new Error("repeated MCP catalog cursor");
        if (cursor) seen.add(cursor);
      } while (cursor);
      if (!active.tools.has(input.name)) throw new Error("tool is absent or has invalid x-mcp-header annotations; rediscover the server");
    }
    const row = await post(server, method, params, active, deadline, active.tools.get(String(input.name)));
    if (row.status >= 400) { connections.delete(key); failure(row.message); throw new Error("project MCP HTTP " + row.status); }
    if (modern) complete(row.message); else failure(row.message);
    if (modern && method === "tools/list") rememberTools(row.message, active);
    return row.message;
  }
  return work(rpc);
}
