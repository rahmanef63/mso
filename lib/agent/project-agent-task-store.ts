import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { principalHash } from "./session-files";
import { readLocalAgentStore, writeLocalAgentStore } from "./local-agent-private-store";

const ROOT = path.resolve((process.env.OS_PROJECT_AGENT_TASKS_DIR || path.join(os.homedir(), ".mso", "project-agent-tasks")).replace(/^~(?=$|\/)/, os.homedir()));
const ID = /^projectmsg_[a-f0-9-]{36}$/;
const MAX_TASK_BYTES = 192 * 1024;
const RESULT_MAX_CHARS = 80_000;

export type ProjectAgentTaskStatus = "in_progress" | "completed" | "partial" | "timeout" | "failed";
export type ProjectAgentTask = {
  id: string;
  ownerHash: string;
  sessionId: string;
  project: { id: string; name: string };
  status: ProjectAgentTaskStatus;
  planMode: boolean;
  maxScope: "read" | "write" | "exec";
  createdAt: string;
  updatedAt: string;
  result?: { text: string; subagentId?: string; rounds?: number; toolCalls?: Array<{ name: string; ok: boolean }> };
  error?: string;
};

function taskFile(ownerHash: string, id: string): string {
  if (!/^[a-f0-9]{64}$/.test(ownerHash) || !ID.test(id)) throw new Error("invalid project agent task key");
  return path.join(ROOT, ownerHash.slice(0, 2), ownerHash, `${id}.json`);
}

function valid(value: unknown): value is ProjectAgentTask {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<ProjectAgentTask>;
  return Boolean(
    typeof row.id === "string" && ID.test(row.id) && typeof row.ownerHash === "string" && /^[a-f0-9]{64}$/.test(row.ownerHash) &&
    typeof row.sessionId === "string" && row.project && typeof row.project.id === "string" && typeof row.project.name === "string" &&
    ["in_progress", "completed", "partial", "timeout", "failed"].includes(String(row.status)) &&
    typeof row.createdAt === "string" && typeof row.updatedAt === "string",
  );
}

export async function createProjectAgentTask(input: {
  principal: string; sessionId: string; project: { id: string; name: string }; planMode: boolean; maxScope: "read" | "write" | "exec";
}): Promise<ProjectAgentTask> {
  const id = `projectmsg_${randomUUID()}`;
  const ownerHash = principalHash(input.principal);
  const now = new Date().toISOString();
  const record: ProjectAgentTask = { id, ownerHash, sessionId: input.sessionId, project: input.project, status: "in_progress", planMode: input.planMode, maxScope: input.maxScope, createdAt: now, updatedAt: now };
  const file = taskFile(ownerHash, id);
  await withSecurityStoreLock(file, () => writeLocalAgentStore(file, record, MAX_TASK_BYTES));
  return record;
}

export async function updateProjectAgentTask(principal: string, id: string, patch: {
  status: ProjectAgentTaskStatus; result?: ProjectAgentTask["result"]; error?: string;
}): Promise<ProjectAgentTask> {
  const ownerHash = principalHash(principal), file = taskFile(ownerHash, id);
  return withSecurityStoreLock(file, async () => {
    const current = await readLocalAgentStore<ProjectAgentTask | null>(file, MAX_TASK_BYTES, null, (value): value is ProjectAgentTask | null => value === null || valid(value));
    if (!current || current.ownerHash !== ownerHash) throw new Error("project agent message not found for this client");
    const result = patch.result ? { ...patch.result, text: String(patch.result.text ?? "").slice(0, RESULT_MAX_CHARS) } : undefined;
    const next: ProjectAgentTask = { ...current, status: patch.status, updatedAt: new Date().toISOString(), ...(result ? { result } : {}), ...(patch.error ? { error: patch.error.slice(0, 1000) } : {}) };
    await writeLocalAgentStore(file, next, MAX_TASK_BYTES);
    return next;
  });
}

export async function getProjectAgentTask(principal: string, id: string): Promise<ProjectAgentTask | null> {
  const ownerHash = principalHash(principal), file = taskFile(ownerHash, id);
  const record = await readLocalAgentStore<ProjectAgentTask | null>(file, MAX_TASK_BYTES, null, (value): value is ProjectAgentTask | null => value === null || valid(value));
  return record?.ownerHash === ownerHash ? record : null;
}
