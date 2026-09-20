import { getAgentSession } from "./session-store";
import { principalHash } from "./session-files";
import {
  clearStandbyExecution,
  mutateLocalAgentStandbyStore,
  readLocalAgentStandbyStore,
  standbyRecordView,
} from "./local-agent-standby-storage";
import type { LocalAgentStandbyRecord } from "./local-agent-types";

const DEFAULT_EXECUTION_LEASE_MS = 15 * 60_000;

export { standbyRecordView } from "./local-agent-standby-storage";

export async function listLocalAgentStandbyRecords(
  principal: string,
): Promise<LocalAgentStandbyRecord[]> {
  const owner = principalHash(principal);
  return (await readLocalAgentStandbyStore()).entries
    .filter((row) => row.principalHash === owner)
    .map((row) => standbyRecordView(row));
}

export async function listAllArmedLocalAgentStandbyRecords(): Promise<LocalAgentStandbyRecord[]> {
  return (await readLocalAgentStandbyStore()).entries
    .filter((row) => row.armed)
    .map((row) => standbyRecordView(row));
}

export async function getLocalAgentStandbyRecord(
  principal: string,
  sessionId: string,
): Promise<LocalAgentStandbyRecord | null> {
  const owner = principalHash(principal);
  const row = (await readLocalAgentStandbyStore()).entries
    .find((entry) => entry.principalHash === owner && entry.sessionId === sessionId);
  return row ? standbyRecordView(row) : null;
}

export async function armLocalAgentStandbyRecord(input: {
  principal: string;
  sessionId: string;
  workflowActor: string;
  workflowId: string;
  now?: number;
}): Promise<LocalAgentStandbyRecord> {
  if (!await getAgentSession(input.principal, input.sessionId))
    throw new Error("local agent session not found for this client");
  const owner = principalHash(input.principal);
  const now = input.now ?? Date.now();
  const at = new Date(now).toISOString();
  return mutateLocalAgentStandbyStore((store) => {
    const current = store.entries
      .find((row) => row.principalHash === owner && row.sessionId === input.sessionId);
    if (current?.armed && current.workflowId !== input.workflowId)
      throw new Error("local agent session is already armed for another workflow");
    const next: LocalAgentStandbyRecord = {
      principalHash: owner,
      principal: input.principal,
      sessionId: input.sessionId,
      workflowActor: input.workflowActor,
      workflowId: input.workflowId,
      armed: true,
      state: "waiting",
      armedAt: current?.armedAt ?? at,
      updatedAt: at,
      ...(current?.lastMessageId ? { lastMessageId: current.lastMessageId } : {}),
      ...(current?.lastRunAt ? { lastRunAt: current.lastRunAt } : {}),
    };
    store.entries = [
      ...store.entries.filter((row) =>
        !(row.principalHash === owner && row.sessionId === input.sessionId)),
      next,
    ];
    return next;
  }, { prune: true, now });
}

export async function disarmLocalAgentStandbyRecord(
  principal: string,
  sessionId: string,
  workflowId?: string,
  reason?: string,
): Promise<LocalAgentStandbyRecord | null> {
  const owner = principalHash(principal);
  return mutateLocalAgentStandbyStore((store) => {
    const row = store.entries
      .find((entry) => entry.principalHash === owner && entry.sessionId === sessionId);
    if (!row || (workflowId && row.workflowId !== workflowId)) return null;
    row.armed = false;
    row.state = "waiting";
    row.updatedAt = new Date().toISOString();
    clearStandbyExecution(row);
    if (reason) row.lastError = reason.slice(0, 500);
    return standbyRecordView(row);
  }, { prune: true });
}

export async function disarmLocalAgentStandbyForWorkflow(
  workflowActor: string,
  workflowId: string,
  reason?: string,
): Promise<LocalAgentStandbyRecord[]> {
  return mutateLocalAgentStandbyStore((store) => {
    const changed: LocalAgentStandbyRecord[] = [];
    const at = new Date().toISOString();
    for (const row of store.entries) {
      if (!row.armed ||
        row.workflowActor !== workflowActor ||
        row.workflowId !== workflowId) continue;
      row.armed = false;
      row.state = "waiting";
      row.updatedAt = at;
      clearStandbyExecution(row);
      if (reason) row.lastError = reason.slice(0, 500);
      changed.push(standbyRecordView(row));
    }
    return changed;
  }, { prune: true });
}

export async function acquireLocalAgentStandbyExecution(input: {
  principal: string;
  sessionId: string;
  messageId: string;
  claimedBy: string;
  taskId?: string;
  now?: number;
}): Promise<LocalAgentStandbyRecord | null> {
  const owner = principalHash(input.principal);
  const now = input.now ?? Date.now();
  return mutateLocalAgentStandbyStore((store) => {
    const row = store.entries
      .find((entry) => entry.principalHash === owner && entry.sessionId === input.sessionId);
    if (!row?.armed || row.state === "blocked") return null;
    const activeLease = row.state === "working" &&
      row.executionLeaseUntil &&
      Date.parse(row.executionLeaseUntil) > now;
    if (activeLease) return null;
    row.state = "working";
    row.currentMessageId = input.messageId;
    row.claimedBy = input.claimedBy.slice(0, 160);
    row.executionLeaseUntil = new Date(now + DEFAULT_EXECUTION_LEASE_MS).toISOString();
    row.updatedAt = new Date(now).toISOString();
    if (input.taskId) row.currentTaskId = input.taskId;
    return standbyRecordView(row, now);
  });
}

export async function updateLocalAgentStandbyTask(
  principal: string,
  sessionId: string,
  messageId: string,
  claimedBy: string,
  taskId: string,
): Promise<void> {
  const owner = principalHash(principal);
  await mutateLocalAgentStandbyStore((store) => {
    const row = store.entries
      .find((entry) => entry.principalHash === owner && entry.sessionId === sessionId);
    if (!row || row.currentMessageId !== messageId || row.claimedBy !== claimedBy) return;
    row.currentTaskId = taskId;
    row.updatedAt = new Date().toISOString();
  });
}

export async function releaseLocalAgentStandbyExecution(input: {
  principal: string;
  sessionId: string;
  messageId: string;
  claimedBy: string;
  error?: string;
  fatal?: boolean;
  completed?: boolean;
}): Promise<LocalAgentStandbyRecord | null> {
  const owner = principalHash(input.principal);
  return mutateLocalAgentStandbyStore((store) => {
    const row = store.entries
      .find((entry) => entry.principalHash === owner && entry.sessionId === input.sessionId);
    if (!row ||
      row.currentMessageId !== input.messageId ||
      row.claimedBy !== input.claimedBy) return null;
    const now = new Date().toISOString();
    if (input.completed !== false) {
      row.lastMessageId = input.messageId;
      row.lastRunAt = now;
    }
    row.updatedAt = now;
    row.state = input.fatal ? "blocked" : "waiting";
    if (input.fatal) row.armed = false;
    if (input.error) row.lastError = input.error.slice(0, 500);
    else delete row.lastError;
    clearStandbyExecution(row);
    return standbyRecordView(row);
  });
}

export async function blockLocalAgentStandby(
  principal: string,
  sessionId: string,
  reason: string,
): Promise<LocalAgentStandbyRecord | null> {
  const owner = principalHash(principal);
  return mutateLocalAgentStandbyStore((store) => {
    const row = store.entries
      .find((entry) => entry.principalHash === owner && entry.sessionId === sessionId);
    if (!row) return null;
    row.armed = false;
    row.state = "blocked";
    row.lastError = reason.slice(0, 500);
    row.updatedAt = new Date().toISOString();
    clearStandbyExecution(row);
    return standbyRecordView(row);
  });
}
