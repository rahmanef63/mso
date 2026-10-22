import { AcpError } from "./acp-errors";
import { ACP_MAX_LINE_BYTES, AcpLineReader } from "./acp-framing";
import type { AcpPermissionPolicy } from "./acp-permission";
import { parsePermissionRequest, permissionOutcome } from "./acp-permission";
import { AcpProcess } from "./acp-process";
import { AcpRpc, type AcpJson } from "./acp-rpc";

// ACP v1 transport, client side: newline-delimited JSON-RPC over stdio. MSO is the
// CLIENT — the agent CLI owns the model subscription, tools and approvals; this file
// only speaks the wire protocol and never assumes an optional method exists
// (capabilities are negotiated in `initialize`).
//
// The four concerns live beside this file and are composed here:
//   acp-framing.ts    lines in, one JSON line out, 1 MiB cap
//   acp-rpc.ts        id counter, pending map, response dispatch
//   acp-permission.ts pure allow/deny decision for request_permission
//   acp-process.ts    spawn/group-kill/stderr ring/dispose
export { AcpError } from "./acp-errors";
export { ACP_MAX_LINE_BYTES } from "./acp-framing";
export { permissionOutcome } from "./acp-permission";
export type { AcpPermissionOption, AcpPermissionPolicy, AcpPermissionRequest } from "./acp-permission";

export const ACP_CONTROL_TIMEOUT_MS = 20_000;
// A prompt turn is the agent's whole model + tool loop and legitimately runs for
// minutes; this is ACP's OWN bound. `mso-readonly` keeps its separate 60s bound and
// neither bound is derived from the other.
export const ACP_PROMPT_TIMEOUT_MS = 15 * 60_000;

export interface AcpAgentCapabilities { loadSession?: boolean }
export interface AcpInitializeResult {
  protocolVersion: number; agentCapabilities?: AcpAgentCapabilities; agentInfo?: { name?: string; version?: string };
  authMethods?: Array<{ id: string; name?: string; type?: string }>;
}
/** One parsed `session/update`. Unknown kinds stay labelled; nothing throws. */
export type AcpSessionUpdate =
  | { kind: "agent_message" | "agent_thought" | "user_message"; text: string }
  | { kind: "tool_call"; toolCallId: string; name: string; status: string }
  | { kind: "tool_call_update"; toolCallId: string; name?: string; status?: string }
  | { kind: "plan" } | { kind: "other"; sessionUpdate: string };
export interface AcpClientOptions {
  command: string; args?: readonly string[]; cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal;
  permissionPolicy?: AcpPermissionPolicy; onUpdate?: (update: AcpSessionUpdate) => void;
  onDiagnostic?: (text: string) => void; controlTimeoutMs?: number; promptTimeoutMs?: number; maxLineBytes?: number;
}
export class AcpClient {
  private readonly process: AcpProcess; private readonly rpc: AcpRpc;
  private readonly reader: AcpLineReader;
  private readonly controlMs: number; private readonly promptMs: number;
  private stopped: AcpError | null = null; private capabilities: AcpAgentCapabilities = {};
  /** `session/update` sink. A caller may swap it per turn; it is never shared. */
  onUpdate: (update: AcpSessionUpdate) => void;
  /** Current permission gate. Null or absent means DENY every request. */
  permissionPolicy: AcpPermissionPolicy | null;

  constructor(private readonly options: AcpClientOptions) {
    this.controlMs = options.controlTimeoutMs ?? ACP_CONTROL_TIMEOUT_MS;
    this.promptMs = options.promptTimeoutMs ?? ACP_PROMPT_TIMEOUT_MS;
    this.reader = new AcpLineReader(options.maxLineBytes ?? ACP_MAX_LINE_BYTES);
    this.onUpdate = options.onUpdate ?? (() => undefined);
    this.permissionPolicy = options.permissionPolicy ?? null;
    this.rpc = new AcpRpc(message => this.write(message), error => this.stop(error),
      text => this.options.onDiagnostic?.(text));
    this.process = new AcpProcess({ command: options.command, args: options.args ?? [], cwd: options.cwd,
      env: options.env, onStdout: chunk => this.onChunk(chunk), onFailure: error => this.stop(error),
      onDiagnostic: options.onDiagnostic });
    options.signal?.addEventListener("abort", () => this.abort(options.signal?.reason), { once: true });
    if (options.signal?.aborted) this.abort(options.signal.reason);
  }

  /** Direct child pid; diagnostics and group-kill proof only. */
  get pid(): number | undefined { return this.process.pid; }
  async initialize(clientInfo = { name: "mso", version: "1" }): Promise<AcpInitializeResult> {
    const result = await this.request<AcpInitializeResult>("initialize", { protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false, auth: { terminal: false } }, clientInfo });
    if (result?.protocolVersion !== 1) throw this.stop(new AcpError("acp_protocol_version_unsupported"));
    this.capabilities = result.agentCapabilities ?? {};
    return result;
  }
  async authenticate(methodId: string): Promise<void> { await this.request("authenticate", { methodId }); }
  async newSession(input: { cwd: string; mcpServers?: unknown[]; additionalDirectories?: string[] }): Promise<string> {
    const result = await this.request<{ sessionId?: unknown }>("session/new", { cwd: input.cwd,
      mcpServers: input.mcpServers ?? [], ...(input.additionalDirectories?.length ? { additionalDirectories: input.additionalDirectories } : {}) });
    if (typeof result?.sessionId !== "string" || !result.sessionId) throw new AcpError("acp_session_id_missing");
    return result.sessionId;
  }
  /** Only legal when the agent advertised `loadSession` in `initialize`. */
  async loadSession(input: { sessionId: string; cwd: string; mcpServers?: unknown[] }): Promise<void> {
    if (this.capabilities.loadSession !== true) throw new AcpError("acp_session_load_unsupported", 409);
    await this.request("session/load", { sessionId: input.sessionId, cwd: input.cwd, mcpServers: input.mcpServers ?? [] });
  }
  async prompt(sessionId: string, text: string): Promise<string> {
    const result = await this.request<{ stopReason?: unknown }>("session/prompt", { sessionId, prompt: [{ type: "text", text }] }, this.promptMs);
    return typeof result?.stopReason === "string" ? result.stopReason : "unknown";
  }
  /** Fire-and-forget client notification (`session/cancel`). Best effort. */
  notify(method: string, params: unknown): void {
    try { this.write({ jsonrpc: "2.0", method, params }); } catch { /* child already gone */ }
  }
  request<T = unknown>(method: string, params: unknown, timeoutMs = this.controlMs): Promise<T> {
    if (this.stopped) return Promise.reject(this.stopped);
    return this.rpc.request<T>(method, params, timeoutMs);
  }
  /** Idempotent: kills the whole group and rejects every pending request. */
  abort(reason?: unknown): void {
    const detail = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "aborted";
    this.stop(reason instanceof AcpError ? reason : new AcpError(`acp_aborted:${detail}`, 499));
  }
  dispose(): void { this.stop(new AcpError("acp_client_disposed", 499)); }
  private write(message: unknown): void {
    if (this.stopped) throw this.stopped;
    this.process.write(message, error => this.stop(new AcpError(
      `acp_stdin_closed:${error instanceof Error ? error.message : "write failed"}`)));
  }
  private stop(error: AcpError): AcpError {
    if (this.stopped) return this.stopped;
    this.stopped = error;
    this.rpc.rejectAll(error);
    this.process.kill();
    this.process.close();
    return error;
  }
  private onChunk(chunk: Buffer): void {
    // A stream listener must never throw; a failure stops the client, which rejects every
    // pending request with that same error. An unterminated or oversized line past the
    // cap kills the child; it is never truncated.
    if (!this.reader.push(chunk, line => { if (!this.stopped) this.onLine(line); })) this.stop(new AcpError("acp_line_too_large"));
  }
  private onLine(line: string): void {
    let message: AcpJson;
    try { message = JSON.parse(line) as AcpJson; }
    catch { this.stop(new AcpError("acp_protocol_invalid_json")); return; }
    // A non-object message is a protocol fault, not something to guess around.
    if (!message || typeof message !== "object" || Array.isArray(message)) return void this.stop(new AcpError("acp_protocol_invalid_message"));
    const id = message.id, method = message.method;
    if (typeof method === "string") {
      if (typeof id === "number") void this.onAgentRequest(id, method, message.params);
      else if (id === undefined) this.onNotification(method, message.params);
      return;
    }
    if (typeof id === "number") this.rpc.handleResponse(id, message);
  }
  private onNotification(method: string, params: unknown): void {
    if (method !== "session/update") return; // `$/` notifications may be ignored
    const update = parseSessionUpdate((params as { update?: unknown } | undefined)?.update);
    if (update) this.onUpdate(update);
  }
  private async onAgentRequest(id: number, method: string, params: unknown): Promise<void> {
    if (method !== "session/request_permission") {
      // Never answer an unknown client method with an implicit success.
      this.write({ jsonrpc: "2.0", id, error: { code: -32601, message: `unsupported client method ${method}` } });
      return;
    }
    const request = parsePermissionRequest(params);
    if (!request) { this.write({ jsonrpc: "2.0", id, error: { code: -32602, message: "invalid permission request" } }); return; }
    let allow = false; // no policy at all means DENY: never an implicit allow
    if (this.permissionPolicy) {
      try { allow = (await this.permissionPolicy(request)) === true; } catch { allow = false; }
    }
    const outcome = permissionOutcome(request.options, allow);
    if (outcome) { this.write({ jsonrpc: "2.0", id, result: { outcome } }); return; }
    // No offered option can express the answer (an allow-only menu, or a widening-only
    // grant). Denial stays explicit — cancel the turn instead of leaving the agent free
    // to proceed, and never answer with an "always" option.
    this.write({ jsonrpc: "2.0", id, result: { outcome: { outcome: "cancelled" } } });
    this.notify("session/cancel", { sessionId: request.sessionId });
  }
}

function textOf(content: unknown): string {
  const block = content as { type?: unknown; text?: unknown } | undefined;
  return block?.type === "text" && typeof block.text === "string" ? block.text : "";
}
/** Unknown `sessionUpdate` kinds are preserved as `other`, never thrown. */
export function parseSessionUpdate(raw: unknown): AcpSessionUpdate | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const update = raw as AcpJson, kind = update.sessionUpdate, toolCallId = update.toolCallId;
  if (kind === "agent_message_chunk") return { kind: "agent_message", text: textOf(update.content) };
  if (kind === "agent_thought_chunk") return { kind: "agent_thought", text: textOf(update.content) };
  if (kind === "user_message_chunk") return { kind: "user_message", text: textOf(update.content) };
  if (kind === "plan") return { kind: "plan" };
  if (kind === "tool_call" || kind === "tool_call_update") {
    if (typeof toolCallId !== "string") return null;
    const name = typeof update.name === "string" ? update.name : typeof update.title === "string" ? update.title : undefined;
    const status = typeof update.status === "string" ? update.status : kind === "tool_call" ? "pending" : undefined;
    return kind === "tool_call"
      ? { kind, toolCallId, name: name ?? toolCallId, status: status ?? "pending" }
      : { kind, toolCallId, ...(name ? { name } : {}), ...(status ? { status } : {}) };
  }
  return { kind: "other", sessionUpdate: typeof kind === "string" ? kind : "unknown" };
}
