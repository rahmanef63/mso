import { projectMcpAuthorization } from "./project-mcp-auth";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { childEnv } from "./child-env";
import { safeProviderFetch } from "./ssrf";
import { readProjectMcpServers, type ProjectMcpServer } from "./project-mcp-config";

const PROTOCOL = "2025-11-25";
const TIMEOUT_MS = 15_000;
const MAX_WIRE_BYTES = 2 * 1024 * 1024;
const MAX_TOOL_ARGS_BYTES = 128 * 1024;

type Rpc = { jsonrpc?: string; id?: string | number | null; result?: unknown; error?: { code?: number; message?: string } };
export type ProjectMcpTool = { name: string; title?: string; description?: string; inputSchema: Record<string, unknown>; annotations?: Record<string, unknown> };

function resolveConfigEnv(server: Extract<ProjectMcpServer, { transport: "stdio" }>): Record<string, string> {
  const base = childEnv();
  const env = { ...base };
  for (const [key, value] of Object.entries(server.env)) {
    const match = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value);
    env[key] = match ? (base[match[1]] ?? "") : value;
  }
  return env;
}

function rpcError(message: Rpc): Error | null {
  return message.error ? new Error(`project MCP error ${message.error.code ?? ""}: ${message.error.message ?? "unknown error"}`.trim()) : null;
}

async function withStdio<T>(server: Extract<ProjectMcpServer, { transport: "stdio" }>, work: (rpc: (method: string, params?: unknown) => Promise<Rpc>, notify: (method: string, params?: unknown) => void) => Promise<T>): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const child = spawn(server.command, server.args, { cwd: server.cwd, env: resolveConfigEnv(server) as unknown as NodeJS.ProcessEnv, shell: false, stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessWithoutNullStreams;
    let nextId = 1, buffer = "", bytes = 0, stderr = "", done = false;
    const pending = new Map<number, { resolve: (v: Rpc) => void; reject: (e: Error) => void }>();
    const finish = (error?: Error, value?: T) => {
      if (done) return; done = true; clearTimeout(timer);
      child.stdin.end();
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        const force = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }, 1000);
        force.unref();
      }
      for (const p of pending.values()) p.reject(error ?? new Error("project MCP session closed")); pending.clear();
      error ? reject(error) : resolve(value as T);
    };
    const parseLine = (line: string) => {
      if (!line.trim()) return;
      let message: Rpc;
      try { message = JSON.parse(line); } catch { finish(new Error("project MCP wrote non-JSON data to stdout")); return; }
      if (typeof message.id !== "number") return;
      const p = pending.get(message.id); if (!p) return; pending.delete(message.id); p.resolve(message);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.byteLength; if (bytes > MAX_WIRE_BYTES) return finish(new Error("project MCP stdout exceeded limit"));
      buffer += chunk.toString("utf8");
      while (true) { const i = buffer.indexOf("\n"); if (i < 0) break; const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); parseLine(line); }
    });
    child.stderr.on("data", (chunk: Buffer) => { if (stderr.length < 8192) stderr += chunk.toString("utf8").slice(0, 8192 - stderr.length); });
    child.on("error", (e) => finish(new Error(`project MCP failed to start: ${e.message}`)));
    child.on("close", (code) => { if (!done) finish(new Error(`project MCP exited ${code ?? 1}${stderr ? `: ${stderr.trim().slice(0, 500)}` : ""}`)); });
    const timer = setTimeout(() => finish(new Error(`project MCP timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS);
    const rpc = (method: string, params?: unknown) => new Promise<Rpc>((res, rej) => {
      const id = nextId++; pending.set(id, { resolve: res, reject: rej }); child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })}\n`);
    });
    const notify = (method: string, params?: unknown) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) })}\n`);
    (async () => {
      try {
        const init = await rpc("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "mso-project-mcp", version: "1" } });
        const initError = rpcError(init); if (initError) throw initError; notify("notifications/initialized");
        const value = await work(rpc, notify); finish(undefined, value);
      } catch (e) { finish(e instanceof Error ? e : new Error(String(e))); }
    })();
  });
}

async function boundedText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader(), decoder = new TextDecoder(); let bytes = 0, text = "";
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > MAX_WIRE_BYTES) { await reader.cancel(); throw new Error("project MCP HTTP response exceeded limit"); } text += decoder.decode(value, { stream: true }); }
    text += decoder.decode(); return text;
  } finally { reader.releaseLock(); }
}
function parseHttpRpc(text: string, contentType: string): Rpc {
  if (!text.trim()) return {};
  if (!contentType.includes("text/event-stream")) return JSON.parse(text) as Rpc;
  for (const block of text.split(/\n\n+/)) {
    const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (!data) continue;
    const parsed = JSON.parse(data) as Rpc; if (parsed.id != null || parsed.error || parsed.result) return parsed;
  }
  throw new Error("project MCP SSE response contained no JSON-RPC result");
}
function remoteHeaders(server: Extract<ProjectMcpServer, { transport: "http" }>, sessionId?: string, protocol = PROTOCOL): Headers {
  const headers = new Headers({ "content-type": "application/json", accept: "application/json, text/event-stream", "MCP-Protocol-Version": protocol });
  for (const [name, value] of Object.entries(server.headers)) {
    const lower = name.toLowerCase(); if (["host", "content-length", "connection", "mcp-session-id"].includes(lower)) continue; headers.set(name, value);
  }
  if (sessionId) headers.set("Mcp-Session-Id", sessionId);
  return headers;
}
async function remotePost(server: Extract<ProjectMcpServer, { transport: "http" }>, payload: unknown, sessionId?: string, protocol = PROTOCOL, deadline = Date.now() + TIMEOUT_MS) {
  if (Date.now() >= deadline) throw new Error("project MCP session timed out");
  const response = await safeProviderFetch(server.url, { method: "POST", headers: remoteHeaders(server, sessionId, protocol), body: JSON.stringify(payload), signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
  const text = await boundedText(response);
  if (!response.ok && response.status !== 202) throw new Error(`project MCP HTTP ${response.status}; check endpoint, connection and token scope`);
  return { message: text ? parseHttpRpc(text, response.headers.get("content-type") ?? "") : ({} as Rpc), sessionId: response.headers.get("mcp-session-id") ?? sessionId };
}
async function withHttp<T>(server: Extract<ProjectMcpServer, { transport: "http" }>, work: (rpc: (method: string, params?: unknown) => Promise<Rpc>) => Promise<T>): Promise<T> {
  if (server.oauthConfigured && !Object.keys(server.headers).some((name) => name.toLowerCase() === "authorization")) {
    throw new Error(`project MCP "${server.name}" declares OAuth but no server-side authorization is configured; MSO will not copy or mint another project's OAuth credential implicitly`);
  }
  const deadline = Date.now() + TIMEOUT_MS;
  const init = await remotePost(server, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "mso-project-mcp", version: "1" } } });
  const err = rpcError(init.message); if (err) throw err;
  const protocol = (init.message.result as { protocolVersion?: string } | undefined)?.protocolVersion ?? PROTOCOL;
  await remotePost(server, { jsonrpc: "2.0", method: "notifications/initialized" }, init.sessionId, protocol, deadline);
  let id = 2;
  return work(async (method, params) => {
    const row = await remotePost(server, { jsonrpc: "2.0", id: id++, method, ...(params === undefined ? {} : { params }) }, init.sessionId, protocol, deadline);
    const error = rpcError(row.message); if (error) throw error; return row.message;
  });
}

async function selectedServer(projectPath: string, name: string): Promise<ProjectMcpServer> {
  const servers = await readProjectMcpServers(projectPath); const server = servers.find((row) => row.name === name);
  if (!server) throw new Error(`unknown project MCP server "${name}"`); return server;
}
export async function withProjectMcpServer<T>(server: ProjectMcpServer, work: (rpc: (method: string, params?: unknown) => Promise<Rpc>) => Promise<T>): Promise<T> {
  const auth = await projectMcpAuthorization(server);
  const guarded = async (rpc: (method: string, params?: unknown) => Promise<Rpc>) => work(async (method, params) => {
    if (method === "tools/call" && auth.allowed && !auth.allowed.includes(String((params as { name?: string })?.name))) throw new Error("project MCP tool is not allowed by this connection");
    // Re-resolve at each RPC: removing or changing the named connection takes effect now.
    const current = await projectMcpAuthorization(server);
    if (JSON.stringify(current.server.headers) !== JSON.stringify(auth.server.headers) || JSON.stringify(current.allowed) !== JSON.stringify(auth.allowed)) throw new Error("project MCP connection changed; rediscover before continuing");
    const row = auth.redact(await rpc(method, params)) as Rpc;
    if (method === "tools/list" && auth.allowed && row.result && typeof row.result === "object") {
      const result = row.result as { tools?: ProjectMcpTool[] };
      if (Array.isArray(result.tools)) result.tools = result.tools.filter((tool) => auth.allowed!.includes(tool.name));
    }
    return row;
  });
  try { return await (auth.server.transport === "stdio" ? withStdio(auth.server, (rpc) => guarded(rpc)) : withHttp(auth.server, guarded)); }
  catch (error) { throw new Error(String(auth.redact(error instanceof Error ? error.message : "project MCP request failed"))); }
}
function publicTools(result: unknown): ProjectMcpTool[] {
  const tools = (result as { tools?: unknown } | undefined)?.tools;
  if (!Array.isArray(tools)) throw new Error("project MCP tools/list returned no tools array");
  if (tools.length > 128) throw new Error("project MCP tool page exceeds 128 tools");
  return tools.flatMap((raw): ProjectMcpTool[] => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>, name = typeof row.name === "string" ? row.name : "";
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(name)) return [];
    const inputSchema = row.inputSchema && typeof row.inputSchema === "object" && !Array.isArray(row.inputSchema) ? row.inputSchema as Record<string, unknown> : { type: "object", properties: {} };
    return [{ name, ...(typeof row.title === "string" ? { title: row.title.slice(0, 160) } : {}), ...(typeof row.description === "string" ? { description: row.description.replace(/\s+/g, " ").slice(0, 800) } : {}), inputSchema, ...(row.annotations && typeof row.annotations === "object" ? { annotations: row.annotations as Record<string, unknown> } : {}) }];
  });
}

async function allTools(rpc: (method: string, params?: unknown) => Promise<Rpc>): Promise<ProjectMcpTool[]> {
  const tools: ProjectMcpTool[] = [], seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 8; page++) {
    const result = (await rpc("tools/list", cursor ? { cursor } : {})).result as { nextCursor?: unknown };
    tools.push(...publicTools(result));
    if (tools.length > 128) throw new Error("project MCP catalog exceeds 128 tools; narrow the connection allowlist");
    if (result.nextCursor === undefined) return tools;
    if (typeof result.nextCursor !== "string" || !result.nextCursor || result.nextCursor.length > 4096 || seen.has(result.nextCursor)) throw new Error("project MCP returned an invalid continuation cursor");
    cursor = result.nextCursor; seen.add(cursor);
  }
  throw new Error("project MCP catalog exceeds 8 pages; discovery is incomplete");
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
