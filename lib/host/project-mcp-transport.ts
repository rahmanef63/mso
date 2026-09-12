import { StringDecoder } from "node:string_decoder";
import type { Rpc } from "./project-mcp-wire";
import { withHttp } from "./project-mcp-http";
import { projectMcpAuthorization } from "./project-mcp-auth";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { childEnv } from "./child-env";
import type { ProjectMcpServer } from "./project-mcp-config";

const PROTOCOL = "2025-11-25";
const TIMEOUT_MS = 15_000;
const MAX_WIRE_BYTES = 2 * 1024 * 1024;

import type { ProjectMcpTool } from "@/lib/contracts/project-mcp";

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
    const decoder = new StringDecoder("utf8");
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
      buffer += decoder.write(chunk);
      while (true) { const i = buffer.indexOf("\n"); if (i < 0) break; const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); parseLine(line); }
    });
    child.stderr.on("data", (chunk: Buffer) => { if (stderr.length < 8192) stderr += chunk.toString("utf8").slice(0, 8192 - stderr.length); });
    child.on("error", (e) => finish(new Error(`project MCP failed to start: ${e.message}`)));
    child.on("close", (code) => { if (!done) finish(new Error(`project MCP exited ${code ?? 1}${stderr ? `: ${stderr.trim().slice(0, 500)}` : ""}`)); });
    const timer = setTimeout(() => finish(new Error(`project MCP timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS);
    const rpc = (method: string, params?: unknown) => new Promise<Rpc>((res, rej) => {
      const id = nextId++;
      if (server.protocolVersion) params = { ...((params ?? {}) as object), _meta: { "io.modelcontextprotocol/protocolVersion": server.protocolVersion, "io.modelcontextprotocol/clientCapabilities": {} } };
      pending.set(id, { resolve: res, reject: rej }); child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })}\n`);
    });
    const notify = (method: string, params?: unknown) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) })}\n`);
    (async () => {
      try {
        if (server.protocolVersion) {
          const discovery = await rpc("server/discover", {});
          const err = rpcError(discovery); if (err) throw err;
          if ((discovery.result as { resultType?: string })?.resultType !== "complete") throw new Error("modern MCP discovery requires complete resultType");
        } else {
        const init = await rpc("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "mso-project-mcp", version: "1" } });
        const initError = rpcError(init); if (initError) throw initError; notify("notifications/initialized");
                }
        const value = await work(async (method, params) => {
          const row = await rpc(method, params), error = rpcError(row); if (error) throw error;
          if (server.protocolVersion && (row.result as { resultType?: string })?.resultType !== "complete") throw new Error("modern MCP requires complete resultType; input_required is unsupported");
          return row;
        }, notify); finish(undefined, value);
      } catch (e) { finish(e instanceof Error ? e : new Error(String(e))); }
    })();
  });
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
