import path from "node:path";
import { agentSessionsDir } from "@/lib/agent/session-paths";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import type { WorkflowGraphRun } from "@/lib/contracts/workflow-graph";

import { listWorkflowFiles, readWorkflowJson, removeWorkflowFile, workflowFileMtime, writeWorkflowFile } from "./private-file";

const MAX_RUN_BYTES = 1024 * 1024;
const MAX_RECEIPTS = 1000;

function root(): string { return path.join(agentSessionsDir(), ".workflow-graph-runs"); }
function file(owner: string, id: string): string {
  if (!/^[a-f0-9]{64}$/.test(owner) || !/^[a-f0-9]{32}$/.test(id)) throw new Error("invalid workflow graph run identity");
  return path.join(root(), owner, `${id}.json`);
}

export async function readWorkflowGraphRun(owner: string, id: string): Promise<WorkflowGraphRun | null> {
  try {
    const parsed = await readWorkflowJson(file(owner, id), MAX_RUN_BYTES, "workflow graph run") as WorkflowGraphRun;
    if (parsed.version !== 1 || parsed.owner !== owner || parsed.id !== id || !Array.isArray(parsed.nodes)) throw new Error("invalid workflow graph run");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeWorkflowGraphRun(run: WorkflowGraphRun): Promise<void> {
  const body = JSON.stringify(run);
  if (Buffer.byteLength(body) > MAX_RUN_BYTES) throw new Error("workflow graph run receipt exceeds 1 MiB");
  await writeWorkflowFile(file(run.owner, run.id), body);
}

export function lockWorkflowGraphRun<T>(owner: string, id: string, fn: () => Promise<T>): Promise<T> {
  return withSecurityStoreLock(file(owner, id), fn);
}

export async function pruneWorkflowGraphRuns(owner: string): Promise<void> {
  const dir = path.dirname(file(owner, "0".repeat(32))), entries = await listWorkflowFiles(dir);
  const receipts: Array<{ id: string; mtime: number }> = [];
  for (const name of entries) {
    if (!/^[a-f0-9]{32}\.json$/.test(name)) continue;
    const id = name.slice(0, 32), mtime = await workflowFileMtime(file(owner, id));
    receipts.push({ id, mtime });
  }
  receipts.sort((a, b) => b.mtime - a.mtime);
  for (const old of receipts.slice(MAX_RECEIPTS - 1)) await removeWorkflowFile(file(owner, old.id)).catch(() => undefined);
}

export function publicWorkflowGraphRun(run: WorkflowGraphRun) {
  const { owner: _owner, pid: _pid, instance: _instance, sessionId: _sessionId, fingerprint: _fingerprint, ancestry: _ancestry, runtimeInput: _runtimeInput, ...safe } = run;
  return { ...safe, pollAfterMs: run.state === "running" ? 1500 : 0 };
}

export async function deleteWorkflowGraphRun(owner: string, id: string) {
  const existing = await readWorkflowGraphRun(owner, id);
  if (!existing) return { id, deleted: false as const };
  if (existing.state === "running") throw new Error("running workflow execution must be stopped before deletion");
  await removeWorkflowFile(file(owner, id));
  return { id, deleted: true as const };
}

export type WorkflowGraphRunFilter = { graphId?: string; state?: WorkflowGraphRun["state"]; limit?: number; offset?: number };
export async function listWorkflowGraphRuns(owner: string, filter: WorkflowGraphRunFilter = {}) {
  const dir = path.dirname(file(owner, "0".repeat(32))), names = (await listWorkflowFiles(dir)).filter((name) => /^[a-f0-9]{32}\.json$/.test(name));
  const rows: WorkflowGraphRun[] = [];
  for (const name of names.slice(0, MAX_RECEIPTS)) {
    const row = await readWorkflowGraphRun(owner, name.slice(0, 32)).catch(() => null); if (!row) continue;
    if (filter.graphId && row.graphId !== filter.graphId) continue;
    if (filter.state && row.state !== filter.state) continue;
    rows.push(row);
  }
  rows.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const offset = Math.max(0, Math.trunc(filter.offset ?? 0)), limit = Math.max(1, Math.min(100, Math.trunc(filter.limit ?? 30)));
  return { total: rows.length, runs: rows.slice(offset, offset + limit).map((run) => {
    const safe = publicWorkflowGraphRun(run);
    return { id: safe.id, graphId: safe.graphId, graphRevision: safe.graphRevision, graphName: safe.graphName, state: safe.state, startedAt: safe.startedAt, updatedAt: safe.updatedAt, finishedAt: safe.finishedAt, failedNodeId: safe.failedNodeId, failedNodeName: safe.failedNodeName, trigger: safe.trigger };
  }), nextOffset: offset + limit < rows.length ? offset + limit : undefined };
}
