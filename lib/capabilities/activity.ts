import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";

export type CapabilityActivityState = "started" | "completed" | "failed" | "denied" | "rate_limited" | "invalid_args";

export interface CapabilityActivityEntry {
  id: string;
  ts: string;
  actor?: string | null;
  tool: string;
  state: CapabilityActivityState;
  scope?: string;
  workflowId?: string;
  workflowIntent?: string;
  workflowProject?: string;
  target?: string;
  durationMs?: number;
  detail?: string;
}

function activityPath(): string {
  const env = process.env.OS_MCP_ACTIVITY_LOG;
  if (env && env.trim()) return env.replace(/^~(?=$|\/)/, os.homedir());
  return path.join(os.homedir(), ".mso", "mcp-activity.log");
}

function trunc(v: string | undefined, max = 180): string | undefined {
  if (!v) return undefined;
  return v.length > max ? v.slice(0, max) + "…" : v;
}

function safeActivityText(value: string): string {
  return value
    .replace(/([?&](?:token|key|secret|password|code)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\b(password|token|secret|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\b(?:bearer\s+)?(?:sk|pk|ghp|mso_mcp)_[a-z0-9_-]{8,}\b/gi, "[redacted]")
    .replace(/\b[a-f0-9]{48,}\b/gi, "[opaque-id]");
}

let chain: Promise<void> = Promise.resolve();

export function newActivityId(): string {
  return randomUUID();
}

export function activityTarget(args: Record<string, unknown>): string | undefined {
  // Never serialize fs_write.content or arbitrary payloads. Prefer the one field
  // that explains what the tool is acting on without leaking the body.
  for (const key of ["path", "id", "target", "query", "intent", "project", "from", "command", "on", "workflow_id"] as const) {
    const v = args[key];
    if (typeof v === "string" && v) return trunc(safeActivityText(v));
    if (typeof v === "boolean") return String(v);
  }
  return undefined;
}

export function recordCapabilityActivity(entry: Omit<CapabilityActivityEntry, "ts"> & { ts?: string }): Promise<void> {
  if (process.env.VITEST && !process.env.OS_MCP_ACTIVITY_LOG) return Promise.resolve();
  const line = JSON.stringify({
    ...entry,
    ts: entry.ts ?? new Date().toISOString(),
    workflowIntent: trunc(entry.workflowIntent ? safeActivityText(entry.workflowIntent) : undefined, 500),
    workflowProject: trunc(entry.workflowProject ? safeActivityText(entry.workflowProject) : undefined, 240),
    target: trunc(entry.target),
    detail: trunc(entry.detail, 220),
  }) + "\n";
  chain = chain.then(async () => {
    const file = activityPath();
    try {
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await fs.appendFile(file, line, { mode: 0o600 });
    } catch (e) {
      console.error("[capability-activity] write failed:", e instanceof Error ? e.message : e);
    }
  });
  return chain;
}

export async function readCapabilityActivity(limit = 80): Promise<CapabilityActivityEntry[]> {
  const raw = await fs.readFile(activityPath(), "utf8").catch(() => "");
  return raw
    .split("\n")
    .filter(Boolean)
    .slice(-800)
    .map((line) => {
      try { return JSON.parse(line) as CapabilityActivityEntry; } catch { return null; }
    })
    .filter((v): v is CapabilityActivityEntry => Boolean(v?.id && v?.tool && v?.state))
    .slice(-Math.min(Math.max(limit, 1), 200))
    .reverse();
}
