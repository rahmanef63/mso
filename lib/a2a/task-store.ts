import { expandOwnerStorePath } from "@/lib/owner-store-path.js";
import { randomUUID } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import type { Scope } from "@/lib/capabilities/scope";
import { isA2ATaskActive } from "./task-active";
import type { A2AMessage, A2ATaskRecord, A2ATaskState } from "./task-types";

type Store = { version: 1; tasks: A2ATaskRecord[] };
const MAX_STORE_BYTES = 4 * 1024 * 1024;
const MAX_TASKS = 200;
export const A2A_TASK_STORE_PATH =
  expandOwnerStorePath(process.env.OS_A2A_TASK_STORE ??
  path.join(os.homedir(), ".mso", "private", "a2a-tasks.json"));

async function readUnlocked(): Promise<Store> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(
      A2A_TASK_STORE_PATH,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_STORE_BYTES)
      throw new Error("A2A task store has an invalid file shape");
    if ((stat.mode & 0o077) !== 0)
      throw new Error(
        "A2A task store permissions are too broad; expected 0600",
      );
    if (typeof process.getuid === "function" && stat.uid !== process.getuid())
      throw new Error("A2A task store is not owned by the MSO user");
    const data = JSON.parse(await handle.readFile("utf8")) as Store;
    if (data?.version !== 1 || !Array.isArray(data.tasks))
      throw new Error("A2A task store has an invalid schema");
    return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { version: 1, tasks: [] };
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function writeUnlocked(store: Store): Promise<void> {
  store.tasks = store.tasks
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .slice(-MAX_TASKS);
  const body = JSON.stringify(store, null, 2);
  if (Buffer.byteLength(body, "utf8") > MAX_STORE_BYTES)
    throw new Error("A2A task store exceeds 4 MiB");
  const dir = path.dirname(A2A_TASK_STORE_PATH);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700).catch(() => undefined);
  const tmp = `${A2A_TASK_STORE_PATH}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, body, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await fs.chmod(tmp, 0o600);
  await fs.rename(tmp, A2A_TASK_STORE_PATH);
  await fs.chmod(A2A_TASK_STORE_PATH, 0o600);
}

export function taskPublicView(task: A2ATaskRecord, historyLength = 10) {
  const history = task.history.slice(
    -Math.max(0, Math.min(100, Math.trunc(historyLength))),
  );
  return {
    id: task.id,
    contextId: task.contextId,
    status: task.status,
    artifacts: task.artifacts,
    ...(history.length ? { history } : {}),
    metadata: { "mso.scope": task.scope },
  };
}

export async function createA2ATask(
  principal: string,
  scope: Scope,
  input: A2AMessage,
  targetSessionId?: string,
): Promise<A2ATaskRecord> {
  const now = new Date().toISOString();
  return withSecurityStoreLock(A2A_TASK_STORE_PATH, async () => {
    const store = await readUnlocked();
    const requestedId = input.taskId?.trim();
    if (requestedId) {
      const existing = store.tasks.find(
        (row) => row.id === requestedId && row.principal === principal,
      );
      if (!existing) throw new Error("A2A task not found");
      if (
        [
          "TASK_STATE_COMPLETED",
          "TASK_STATE_FAILED",
          "TASK_STATE_CANCELED",
          "TASK_STATE_REJECTED",
        ].includes(existing.status.state)
      )
        throw new Error(
          "A2A task is terminal and cannot accept another message",
        );
      if (isA2ATaskActive(existing.id))
        throw new Error("A2A task is already working");
      const contextId = input.contextId?.trim() || existing.contextId;
      if (contextId !== existing.contextId)
        throw new Error("A2A contextId does not match the existing task");
      existing.scope = scope;
      if (targetSessionId) existing.targetSessionId = targetSessionId;
      existing.history.push({
        ...input,
        taskId: existing.id,
        contextId: existing.contextId,
      });
      existing.status = { state: "TASK_STATE_SUBMITTED", timestamp: now };
      existing.updatedAt = now;
      delete existing.error;
      await writeUnlocked(store);
      return existing;
    }
    const id = `task_${randomUUID()}`;
    const contextId = input.contextId?.trim() || `ctx_${randomUUID()}`;
    const message = { ...input, taskId: id, contextId };
    const record: A2ATaskRecord = {
      id,
      contextId,
      principal,
      scope,
      ...(targetSessionId ? { targetSessionId } : {}),
      status: { state: "TASK_STATE_SUBMITTED", timestamp: now },
      history: [message],
      artifacts: [],
      createdAt: now,
      updatedAt: now,
    };
    store.tasks.push(record);
    await writeUnlocked(store);
    return record;
  });
}

export async function updateA2ATask(
  id: string,
  principal: string,
  patch: { state?: A2ATaskState; output?: string; error?: string },
): Promise<A2ATaskRecord> {
  return withSecurityStoreLock(A2A_TASK_STORE_PATH, async () => {
    const store = await readUnlocked();
    const task = store.tasks.find(
      (row) => row.id === id && row.principal === principal,
    );
    if (!task) throw new Error("A2A task not found");
    const now = new Date().toISOString();
    if (patch.output !== undefined) {
      const text = patch.output.slice(0, 64 * 1024);
      const message: A2AMessage = {
        messageId: `msg_${randomUUID()}`,
        role: "ROLE_AGENT",
        parts: [{ text, mediaType: "text/plain" }],
        contextId: task.contextId,
        taskId: task.id,
      };
      task.history.push(message);
      task.artifacts = [
        {
          artifactId: `artifact_${task.id}`,
          name: "result",
          parts: [{ text, mediaType: "text/plain" }],
        },
      ];
      task.status.message = message;
    }
    if (patch.state) task.status.state = patch.state;
    task.status.timestamp = now;
    task.updatedAt = now;
    if (patch.error) task.error = patch.error.slice(0, 500);
    else if (patch.state === "TASK_STATE_COMPLETED") delete task.error;
    await writeUnlocked(store);
    return task;
  });
}

export async function listA2ATaskRecordsForPrincipal(
  principal: string,
): Promise<A2ATaskRecord[]> {
  return (await readUnlocked()).tasks
    .filter((row) => row.principal === principal)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getA2ATaskForPrincipal(
  id: string,
  principal: string,
  historyLength = 10,
): Promise<ReturnType<typeof taskPublicView> | null> {
  const task = (await readUnlocked()).tasks.find(
    (row) => row.id === id && row.principal === principal,
  );
  return task ? taskPublicView(task, historyLength) : null;
}

export async function listA2ATasksForPrincipal(principal: string, limit = 50) {
  return (await listA2ATaskRecordsForPrincipal(principal))
    .slice(0, Math.max(1, Math.min(100, Math.trunc(limit) || 50)))
    .map((row) => taskPublicView(row));
}

export async function listA2ATasksOwner(limit = 50) {
  return (await readUnlocked()).tasks
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, Math.max(1, Math.min(100, Math.trunc(limit) || 50)))
    .map((row) => ({ ...row, active: isA2ATaskActive(row.id) }));
}
