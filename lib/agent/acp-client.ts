import { spawn, type ChildProcess } from "node:child_process";

// ACP v1 transport, client side: newline-delimited JSON-RPC over stdio. MSO is the
// CLIENT — the agent CLI owns the model subscription, tools and approvals; this file
// only speaks the wire protocol and never assumes an optional method exists
// (capabilities are negotiated in `initialize`).
//
// Line cap: ACP is one JSON object per line and the biggest real message is a tool
// result or file body (MSO's own agent result budget is 64 KiB), so 1 MiB is generous
// headroom. The cap exists so a runaway agent writing an endless line fails loudly and
// kills the child instead of growing MSO's heap.
export const ACP_MAX_LINE_BYTES = 1_048_576, ACP_CONTROL_TIMEOUT_MS = 20_000;
// A prompt turn is the agent's whole model + tool loop and legitimately runs for
// minutes; this is ACP's OWN bound. `mso-readonly` keeps its separate 60s bound and
// neither bound is derived from the other.
export const ACP_PROMPT_TIMEOUT_MS = 15 * 60_000;
const STDERR_RING_BYTES = 16 * 1024, KILL_GRACE_MS = 500;

export class AcpError extends Error {
  constructor(message: string, public readonly status = 502) { super(message); this.name = "AcpError"; }
}
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
export interface AcpPermissionOption { optionId: string; kind: string; name: string }
export interface AcpPermissionRequest { sessionId: string; toolCall: Record<string, unknown>; options: AcpPermissionOption[] }
/** Returns true only for a NARROW allow. An absent policy means DENY. */
export type AcpPermissionPolicy = (request: AcpPermissionRequest) => boolean | Promise<boolean>;
export interface AcpClientOptions {
  command: string; args?: readonly string[]; cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal;
  permissionPolicy?: AcpPermissionPolicy; onUpdate?: (update: AcpSessionUpdate) => void;
  onDiagnostic?: (text: string) => void; controlTimeoutMs?: number; promptTimeoutMs?: number; maxLineBytes?: number;
}
/**
 * The decision for one `session/request_permission`, or null when no offered option
 * can express it — the caller must treat null as a cancelled turn, never as consent.
 * `allow_always` is deliberately unselectable: t3code's lesson is that an "always"
 * grant is project-wide, so MSO answers `once` only and a prompt-injected agent cannot
 * widen a supervised session.
 */
export function permissionOutcome(options: readonly AcpPermissionOption[], allow: boolean) {
  const wanted = allow ? ["allow_once"] : ["reject_once", "reject_always"];
  const chosen = options.find(option => wanted.includes(option.kind))
    ?? (allow ? undefined : options.find(option => option.kind.startsWith("reject")));
  return chosen ? { outcome: "selected" as const, optionId: chosen.optionId } : null;
}
type Pending = { resolve: (value: unknown) => void; reject: (error: unknown) => void; timer: NodeJS.Timeout };
type Json = Record<string, unknown>;
export class AcpClient {
  private readonly child: ChildProcess; private readonly pending = new Map<number, Pending>();
  private readonly stderrRing: string[] = [];
  private readonly controlMs: number; private readonly promptMs: number; private readonly maxLine: number;
  private buffer = ""; private nextId = 1; private stderrBytes = 0;
  private stopped: AcpError | null = null; private capabilities: AcpAgentCapabilities = {};
  /** `session/update` sink. A caller may swap it per turn; it is never shared. */
  onUpdate: (update: AcpSessionUpdate) => void;
  /** Current permission gate. Null or absent means DENY every request. */
  permissionPolicy: AcpPermissionPolicy | null;

  constructor(private readonly options: AcpClientOptions) {
    this.controlMs = options.controlTimeoutMs ?? ACP_CONTROL_TIMEOUT_MS;
    this.promptMs = options.promptTimeoutMs ?? ACP_PROMPT_TIMEOUT_MS;
    this.maxLine = options.maxLineBytes ?? ACP_MAX_LINE_BYTES;
    this.onUpdate = options.onUpdate ?? (() => undefined);
    this.permissionPolicy = options.permissionPolicy ?? null;
    // Explicit argv, no shell string, and a new process GROUP so abort kills what the
    // agent started, not only the direct pid.
    this.child = spawn(options.command, options.args ?? [], { cwd: options.cwd,
      env: options.env, shell: false, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    // EPIPE on a child that already died must reject the request, not crash the process.
    this.child.stdin?.on("error", (error: Error) => this.stop(new AcpError(`acp_stdin_closed:${error.message}`)));
    this.child.stdout?.on("data", (chunk: Buffer) => this.onChunk(chunk));
    this.child.stderr?.on("data", (chunk: Buffer) => this.appendStderr(chunk.toString("utf8")));
    this.child.once("error", (error: Error) => this.stop(new AcpError(`acp_spawn_failed:${error.message}`, 500)));
    this.child.once("exit", (code, signal) => this.stop(new AcpError(`acp_agent_exited:${signal ?? code ?? "unknown"}`)));
    options.signal?.addEventListener("abort", () => this.abort(options.signal?.reason), { once: true });
    if (options.signal?.aborted) this.abort(options.signal.reason);
  }

  /** Direct child pid; diagnostics and group-kill proof only. */
  get pid(): number | undefined { return this.child.pid; }
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
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => this.stop(new AcpError(`acp_request_timeout:${method}`, 504)), timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      try { this.write({ jsonrpc: "2.0", id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  /** Idempotent: kills the whole group and rejects every pending request. */
  abort(reason?: unknown): void {
    const detail = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "aborted";
    this.stop(reason instanceof AcpError ? reason : new AcpError(`acp_aborted:${detail}`, 499));
  }
  dispose(): void { this.stop(new AcpError("acp_client_disposed", 499)); }
  private write(message: unknown): void {
    if (this.stopped) throw this.stopped;
    const stdin = this.child.stdin;
    if (!stdin || stdin.destroyed) throw new AcpError("acp_stdin_closed");
    try { stdin.write(`${JSON.stringify(message)}\n`); } catch (error) {
      this.stop(new AcpError(`acp_stdin_closed:${error instanceof Error ? error.message : "write failed"}`));
    }
  }
  private stop(error: AcpError): AcpError {
    if (this.stopped) return this.stopped;
    this.stopped = error;
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear();
    const pid = this.child.pid;
    if (pid) { // The whole GROUP: an agent CLI forks helpers that would outlive the pid.
      try { process.kill(-pid, "SIGTERM"); } catch { try { this.child.kill("SIGTERM"); } catch { /* already gone */ } }
      setTimeout(() => { try { process.kill(-pid, "SIGKILL"); } catch { /* already gone */ } }, KILL_GRACE_MS).unref?.();
    }
    try { this.child.stdin?.end(); } catch { /* already closed */ }
    this.child.stdout?.destroy(); this.child.stderr?.destroy();
    return error;
  }
  private appendStderr(text: string): void { // bounded ring, never parsed as protocol
    this.stderrRing.push(text); this.stderrBytes += Buffer.byteLength(text);
    while (this.stderrBytes > STDERR_RING_BYTES && this.stderrRing.length > 1) this.stderrBytes -= Buffer.byteLength(this.stderrRing.shift()!);
    this.options.onDiagnostic?.(text);
  }
  private onChunk(chunk: Buffer): void {
    // A stream listener must never throw; a failure stops the client, which rejects every
    // pending request with that same error.
    this.buffer += chunk.toString("utf8");
    for (;;) {
      const index = this.buffer.indexOf("\n");
      // An unterminated line past the cap kills the child; it is never truncated.
      if (index < 0) {
        if (Buffer.byteLength(this.buffer) > this.maxLine) this.stop(new AcpError("acp_line_too_large"));
        return;
      }
      const line = this.buffer.slice(0, index); this.buffer = this.buffer.slice(index + 1);
      if (Buffer.byteLength(line) > this.maxLine) { this.stop(new AcpError("acp_line_too_large")); return; }
      if (line.trim() && !this.stopped) this.onLine(line);
    }
  }
  private onLine(line: string): void {
    let message: Json;
    try { message = JSON.parse(line) as Json; }
    catch { this.stop(new AcpError("acp_protocol_invalid_json")); return; }
    // A non-object message is a protocol fault, not something to guess around.
    if (!message || typeof message !== "object" || Array.isArray(message)) return void this.stop(new AcpError("acp_protocol_invalid_message"));
    const id = message.id, method = message.method;
    if (typeof method === "string") {
      if (typeof id === "number") void this.onAgentRequest(id, method, message.params);
      else if (id === undefined) this.onNotification(method, message.params);
      return;
    }
    if (typeof id === "number") this.onResponse(id, message);
  }
  private onResponse(id: number, message: Json): void {
    // A response for an unknown id is stale or duplicate, not a protocol violation.
    const entry = this.pending.get(id);
    if (!entry) { this.appendStderr(`acp: ignoring response for unknown id ${id}\n`); return; }
    this.pending.delete(id); clearTimeout(entry.timer);
    const error = message.error as { code?: unknown; message?: unknown } | undefined;
    if (error) {
      const code = typeof error.code === "number" ? error.code : "unknown";
      // -32000 is ACP's `auth_required`: a policy refusal, not a transport fault.
      entry.reject(new AcpError(`acp_agent_error:${code}:${String(error.message ?? "")}`, code === -32000 ? 409 : 502));
      return;
    }
    entry.resolve(message.result);
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
  const update = raw as Json, kind = update.sessionUpdate, toolCallId = update.toolCallId;
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
function parsePermissionRequest(raw: unknown): AcpPermissionRequest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const params = raw as Json;
  if (typeof params.sessionId !== "string" || !Array.isArray(params.options)) return null;
  const options: AcpPermissionOption[] = [];
  for (const row of params.options) {
    const option = row as Json | undefined;
    if (!option || typeof option.optionId !== "string" || typeof option.kind !== "string") return null;
    options.push({ optionId: option.optionId, kind: option.kind, name: typeof option.name === "string" ? option.name : option.optionId });
  }
  return { sessionId: params.sessionId, toolCall: (params.toolCall as Record<string, unknown>) ?? {}, options };
}
