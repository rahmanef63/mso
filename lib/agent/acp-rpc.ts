// JSON-RPC id correlation: the id counter, the pending map, response dispatch and the
// unknown-id rule. No transport, no child process, no method knowledge.
import { AcpError } from "./acp-errors";

export type AcpJson = Record<string, unknown>;
type Pending = { resolve: (value: unknown) => void; reject: (error: unknown) => void; timer: NodeJS.Timeout };

export class AcpRpc {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(
    private readonly send: (message: unknown) => void,
    private readonly fail: (error: AcpError) => void,
    private readonly onDiagnostic: (text: string) => void,
  ) {}

  request<T = unknown>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new AcpError(`acp_request_timeout:${method}`, 504)), timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      try { this.send({ jsonrpc: "2.0", id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  /** A response for an unknown id is stale or duplicate, not a protocol violation. */
  handleResponse(id: number, message: AcpJson): void {
    const entry = this.pending.get(id);
    if (!entry) { this.onDiagnostic(`acp: ignoring response for unknown id ${id}\n`); return; }
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

  /** Rejects every pending request once; the stop path calls this.
   *  Idempotent: a second call finds an empty map. */
  rejectAll(error: AcpError): void {
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear();
  }
}
