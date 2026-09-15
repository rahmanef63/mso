import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { agentSessionsDir } from "@/lib/agent/session-paths";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import type { WorkflowGraphRun } from "@/lib/contracts/workflow-graph";

const MAX_RUN_BYTES = 1024 * 1024;
const MAX_RECEIPTS = 1000;

function root(): string { return path.join(agentSessionsDir(), ".workflow-graph-runs"); }
function file(owner: string, id: string): string {
  if (!/^[a-f0-9]{64}$/.test(owner) || !/^[a-f0-9]{32}$/.test(id)) throw new Error("invalid workflow graph run identity");
  return path.join(root(), owner, `${id}.json`);
}
async function ensureOwnerDir(owner: string): Promise<void> {
  const dir = path.dirname(file(owner, "0".repeat(32)));
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("unsafe workflow graph run directory");
  await fs.chmod(dir, 0o700).catch(() => undefined);
}

export async function readWorkflowGraphRun(owner: string, id: string): Promise<WorkflowGraphRun | null> {
  try {
    const target = file(owner, id), stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_RUN_BYTES || (stat.mode & 0o077)) throw new Error("unsafe workflow graph run");
    const parsed = JSON.parse(await fs.readFile(target, "utf8")) as WorkflowGraphRun;
    if (parsed.version !== 1 || parsed.owner !== owner || parsed.id !== id || !Array.isArray(parsed.nodes)) throw new Error("invalid workflow graph run");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeWorkflowGraphRun(run: WorkflowGraphRun): Promise<void> {
  await ensureOwnerDir(run.owner);
  const target = file(run.owner, run.id), temp = `${target}.${randomUUID()}.tmp`, body = JSON.stringify(run);
  if (Buffer.byteLength(body) > MAX_RUN_BYTES) throw new Error("workflow graph run receipt exceeds 1 MiB");
  try {
    await fs.writeFile(temp, body, { flag: "wx", mode: 0o600 });
    await fs.rename(temp, target);
  } finally { await fs.unlink(temp).catch(() => undefined); }
}

export function lockWorkflowGraphRun<T>(owner: string, id: string, fn: () => Promise<T>): Promise<T> {
  return withSecurityStoreLock(file(owner, id), fn);
}

export async function pruneWorkflowGraphRuns(owner: string): Promise<void> {
  await ensureOwnerDir(owner);
  const dir = path.dirname(file(owner, "0".repeat(32))), entries = await fs.readdir(dir);
  const receipts: Array<{ name: string; mtime: number }> = [];
  for (const name of entries) {
    if (!/^[a-f0-9]{32}\.json$/.test(name)) continue;
    const stat = await fs.stat(path.join(dir, name)); receipts.push({ name, mtime: stat.mtimeMs });
  }
  receipts.sort((a, b) => b.mtime - a.mtime);
  for (const old of receipts.slice(MAX_RECEIPTS - 1)) await fs.unlink(path.join(dir, old.name)).catch(() => undefined);
}

export function publicWorkflowGraphRun(run: WorkflowGraphRun) {
  const { owner: _owner, pid: _pid, instance: _instance, sessionId: _sessionId, fingerprint: _fingerprint, ...safe } = run;
  return { ...safe, pollAfterMs: run.state === "running" ? 1500 : 0 };
}
