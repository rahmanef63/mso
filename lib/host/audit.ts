// SERVER-ONLY. Append-only audit trail for privileged actions (shell exec, file
// mutations, cleanup runs, auth events). Single-owner tool that can run shell
// commands MUST keep a tamper-evident record — if something goes wrong, this is
// the only forensic trail. JSONL, one event per line, flushed best-effort.
//
// Location: $OS_AUDIT_LOG, else ~/.mso/audit.log. Reads are NOT audited
// (bounded + high-volume); only state-changing actions are.
import { promises as fs } from "fs";
import os from "os";
import path from "path";

export type AuditAction =
  | "exec.run"
  | "exec.blocked"
  | "exec.job.start"
  | "exec.job.cancel"
  | "term.open"
  | "term.close"
  | "fs.write"
  | "fs.delete"
  | "fs.move"
  | "fs.copy"
  | "fs.mkdir"
  | "fs.upload"
  | "fs.zip"
  | "sys.cleanup"
  | "sys.service"
  /** The cockpit replacing its own code (Settings → About, or `mso update run`). */
  | "sys.update"
  | "managed-app.action"
  | "infra.write"
  | "camoufox.power"
  | "workflow.start"
  | "workflow.cancel"
  | "workflow.finish"
  | "agent.session"
  | "agent.memory"
  | "tool.forge.propose"
  | "tool.forge.evaluate"
  | "tool.forge.promote"
  | "a2a.registry"
  | "a2a.credential"
  | "a2a.inbound"
  | "a2a.task"
  | "a2a.send"
  | "a2a.cancel"
  /** An MCP token asked for a tool above its scope. Not an error — it is the
   *  signal that matters: a `read` connector repeatedly reaching for `exec_run`
   *  is what a prompt-injected model looks like from the outside. */
  | "mcp.denied"
  | "auth.login"
  | "auth.pending"
  | "auth.denied"
  | "auth.ratelimited"
  | "auth.logout"
  | "auth.device"
  | "framework.error";

export interface AuditEntry {
  action: AuditAction;
  /** Approved device id from the session (the actor), when known. */
  actor?: string | null;
  /** Request origin IP, when available (auth events). */
  ip?: string | null;
  /** Primary target — a path, URL, or command (truncated). */
  target?: string;
  /** Outcome flag; false = failed/blocked/denied. */
  ok?: boolean;
  /** Optional extra context (exit code, reason). */
  detail?: string;
  /** Structured side-channel for shape data that does not fit `target` cleanly
   *  (route kind, http status, byte counts, …). Scalar values only so the
   *  JSONL line stays one shallow object — keeps `jq` + grep workflows sane. */
  meta?: Record<string, string | number | boolean>;
}

function auditPath(): string {
  const env = process.env.OS_AUDIT_LOG;
  if (env && env.trim()) return env.replace(/^~(?=$|\/)/, os.homedir());
  return path.join(os.homedir(), ".mso", "audit.log");
}

function trunc(s: string | undefined, max = 512): string | undefined {
  if (s == null) return undefined;
  return s.length > max ? s.slice(0, max) + "…" : s;
}

// Clamp meta values defensively: a caller could pass an unbounded string (a
// user-supplied URL, a stack-trace fragment), and one bloated meta would
// torpedo the whole forensic line. Scalars pass through; strings cap at 256;
// anything else is dropped (the type already forbids it, but defense in depth).
function clampMeta(
  meta: Record<string, string | number | boolean> | undefined,
): Record<string, string | number | boolean> | undefined {
  if (!meta) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (typeof v === "string")
      out[k] = v.length > 256 ? v.slice(0, 256) + "…" : v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    // any other type: silently drop
  }
  return out;
}

export interface AuditRecord {
  ts?: string;
  action: string;
  actor?: string | null;
  ip?: string | null;
  target?: string;
  ok?: boolean;
  detail?: string;
  meta?: Record<string, string | number | boolean>;
}

// Read the tail of the audit log, newest-first, optionally filtered to actions
// with a given prefix (e.g. "browser."). Returns [] if the log doesn't exist.
// The single reader of the trail — routes must not re-derive the log path.
export async function readAuditTail(opts?: {
  prefix?: string;
  limit?: number;
}): Promise<AuditRecord[]> {
  const { prefix, limit = 100 } = opts ?? {};
  const raw = await fs.readFile(auditPath(), "utf8").catch(() => "");
  return raw
    .split("\n")
    .filter(Boolean)
    .slice(-500)
    .map((l) => {
      try {
        return JSON.parse(l) as AuditRecord;
      } catch {
        return null;
      }
    })
    .filter((e): e is AuditRecord =>
      Boolean(
        e &&
        typeof e.action === "string" &&
        (!prefix || e.action.startsWith(prefix)),
      ),
    )
    .slice(-limit)
    .reverse();
}

// Internal: serialize writes onto a single chained promise so bursty parallel
// callers land in submission order. The chain NEVER rejects (each link
// swallows + logs its own failure), otherwise one bad write would poison every
// subsequent audit call for the lifetime of the process.
let _writeChain: Promise<void> = Promise.resolve();

async function writeLine(line: string): Promise<void> {
  // A test run must never append to the OWNER's forensic trail. This is not
  // hypothetical: on 2026-08-10 two `mcp.denied` lines from lib/mcp/dispatch.test.ts
  // landed in a real ~/.mso/audit.log, because that suite exercises the dispatcher
  // and the dispatcher audits. audit.test.ts always stubs OS_AUDIT_LOG at a temp
  // path, so this only silences the callers that forgot to.
  if (process.env.VITEST && !process.env.OS_AUDIT_LOG) return;
  const file = auditPath();
  try {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await fs.appendFile(file, line, { mode: 0o600 });
  } catch (e) {
    console.error("[audit] write failed:", e instanceof Error ? e.message : e);
  }
}

// Append an audit entry. Returns a promise that resolves AFTER this entry's
// write completes (or fails — failures are swallowed; the trail is best-effort
// and must never break the caller). Callers may fire-and-forget the returned
// promise; ordering across concurrent callers is preserved via _writeChain.
export function audit(entry: AuditEntry): Promise<void> {
  // Drop `meta` from the serialized line when it's empty so existing greps that
  // assume a fixed-shape record don't suddenly see `"meta":{}` everywhere.
  const clamped = clampMeta(entry.meta);
  const hasMeta = clamped && Object.keys(clamped).length > 0;
  const line =
    JSON.stringify({
      ts: new Date().toISOString(),
      action: entry.action,
      actor: entry.actor ?? null,
      ip: entry.ip ?? null,
      target: trunc(entry.target),
      ok: entry.ok ?? true,
      detail: trunc(entry.detail, 256),
      ...(hasMeta ? { meta: clamped } : {}),
    }) + "\n";
  _writeChain = _writeChain.then(() => writeLine(line));
  return _writeChain;
}
