import { constants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pinSecurityStorePath } from "@/lib/security-store-path";

export type CapabilityActivityState = "started" | "completed" | "failed" | "denied" | "rate_limited" | "invalid_args";
export interface CapabilityActivityEntry {
  id: string; ts: string; actor?: string | null; tool: string;
  state: CapabilityActivityState; scope?: string; workflowId?: string;
  workflowIntent?: string; workflowProject?: string; target?: string;
  durationMs?: number; detail?: string;
}
const STATES = new Set(["started", "completed", "failed", "denied", "rate_limited", "invalid_args"]);
const TAIL_BYTES = 4 * 1024 * 1024;
function activityPath(): string {
  const env = process.env.OS_MCP_ACTIVITY_LOG;
  return env?.trim() ? env.replace(/^~(?=$|\/)/, os.homedir()) : path.join(os.homedir(), ".mso", "mcp-activity.log");
}
function safeActivityText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/([?&](?:token|key|secret|password|code)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\b(password|token|secret|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\b(?:bearer\s+)?(?:sk|pk|ghp|mso_mcp)_[a-z0-9_-]{8,}\b/gi, "[redacted]")
    .replace(/\b[a-f0-9]{48,}\b/gi, "[opaque-id]");
}
function text(value: unknown, limit = 180): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") throw new Error("Activity metadata must be text");
  const safe = safeActivityText(value);
  return safe.length > limit ? safe.slice(0, limit) + "…" : safe;
}
function normalized(entry: Omit<CapabilityActivityEntry, "ts"> & { ts?: string }): CapabilityActivityEntry {
  if (typeof entry.id !== "string" || !/^[A-Za-z0-9_.:-]{1,180}$/.test(entry.id)
    || typeof entry.tool !== "string" || !/^[A-Za-z][A-Za-z0-9_.:-]{0,119}$/.test(entry.tool)
    || !STATES.has(entry.state)) throw new Error("Invalid activity identity or state");
  if (entry.scope != null && !["read", "write", "exec"].includes(entry.scope)) throw new Error("Invalid activity scope");
  if (entry.durationMs != null && (!Number.isFinite(entry.durationMs) || entry.durationMs < 0)) throw new Error("Invalid activity duration");
  if (entry.ts != null && (!Number.isFinite(Date.parse(entry.ts)) || entry.ts.length > 40)) throw new Error("Invalid activity timestamp");
  // Never spread a caller's object: request bodies/unknown keys must not reach disk.
  return {
    id: entry.id, tool: entry.tool, state: entry.state, ts: entry.ts ?? new Date().toISOString(),
    actor: text(entry.actor), scope: entry.scope, workflowId: text(entry.workflowId),
    workflowIntent: text(entry.workflowIntent, 500), workflowProject: text(entry.workflowProject, 240),
    target: text(entry.target), detail: text(entry.detail, 220), durationMs: entry.durationMs,
  };
}
let chain: Promise<void> = Promise.resolve();
export function newActivityId(): string { return randomUUID(); }
export function activityTarget(args: Record<string, unknown>): string | undefined {
  for (const key of ["path", "id", "target", "query", "intent", "project", "from", "command", "on", "workflow_id"] as const) {
    const value = args[key];
    if (typeof value === "string" && value) return text(value);
    if (typeof value === "boolean") return String(value);
  }
  return undefined;
}
export function recordCapabilityActivity(entry: Omit<CapabilityActivityEntry, "ts"> & { ts?: string }): Promise<void> {
  if (process.env.VITEST && !process.env.OS_MCP_ACTIVITY_LOG) return Promise.resolve();
  const line = JSON.stringify(normalized(entry)) + "\n";
  if (Buffer.byteLength(line) > 8192) return Promise.reject(new Error("Activity record exceeds limit"));
  chain = chain.catch(() => undefined).then(async () => {
    const pinned = await pinSecurityStorePath(activityPath());
    let handle;
    try {
      handle = await fs.open(pinned.file, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.uid !== process.getuid?.() || stat.nlink !== 1 || (stat.mode & 0o077)) throw new Error("Unsafe activity log");
      await handle.writeFile(line, "utf8");
    } finally { await handle?.close(); await pinned.directory.close(); }
  });
  // Activity is diagnostic metadata, not the mandatory security audit trail.
  // Record failures without crashing an otherwise authorized tool call.
  return chain.catch(() => { console.error("[capability-activity] bounded private log write failed"); });
}
export async function readCapabilityActivity(limit = 80): Promise<CapabilityActivityEntry[]> {
  const pinned = await pinSecurityStorePath(activityPath());
  let handle;
  try {
    handle = await fs.open(pinned.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.uid !== process.getuid?.() || stat.nlink !== 1 || (stat.mode & 0o077)) throw new Error("Unsafe activity log");
    const start = Math.max(0, Number(stat.size) - TAIL_BYTES), buffer = Buffer.alloc(Math.min(Number(stat.size), TAIL_BYTES));
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, start + offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const lines = buffer.subarray(0, offset).toString("utf8").split("\n");
    if (start) lines.shift(); // the first tail fragment may start inside a JSON string
    return lines.filter(Boolean).slice(-800).map((line) => {
      try { return normalized(JSON.parse(line)); } catch { return null; }
    }).filter((value): value is CapabilityActivityEntry => value !== null)
      .slice(-Math.min(Math.max(Math.floor(limit) || 80, 1), 200)).reverse();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  } finally { await handle?.close(); await pinned.directory.close(); }
}
