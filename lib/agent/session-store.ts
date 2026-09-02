import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { redactText } from "@/lib/security/redact-text";
import { normalizeAgentSessionCwd } from "./session-location";
import { snapshotAgentMemory, type AgentMemorySnapshot } from "./memory-store";
import {
  archiveAgentSession,
  pruneAgentSessionArchives,
} from "./session-archive";
import {
  conversationIndexReady,
  conversationLockTarget,
  listSessionRecords,
  newAgentSessionId,
  principalHash,
  readConversationSession,
  readSessionFile,
  sessionLockTarget,
  writeConversationRef,
  writeSessionFile,
} from "./session-files";
import {
  autoSessionTitle,
  compactSessionContext,
  compactThresholdTokens,
  estimateTokens,
  MAX_EVENTS,
  MAX_HISTORY,
  safeTitle,
  sessionContextTokens,
} from "./session-policy";
import type {
  AgentSession,
  AgentSessionEvent,
  AgentSessionResumePacket,
  AgentSessionSource,
  AgentSessionSummary,
  AgentSessionTitleSource,
} from "./session-types";
export type {
  AgentSession,
  AgentSessionEvent,
  AgentSessionResumePacket,
  AgentSessionSource,
  AgentSessionSummary,
} from "./session-types";

interface CreateOptions {
  id?: string;
  title?: string;
  titleSource?: AgentSessionTitleSource;
  resumedFrom?: string;
  conversationHash?: string;
  memorySnapshot?: AgentMemorySnapshot;
  contextSummary?: string;
  history?: unknown[];
  cwd?: string;
  parentSessionId?: string;
}

function summary(record: AgentSession): AgentSessionSummary {
  return {
    id: record.id,
    source: record.source,
    title: record.title,
    titleSource: record.titleSource,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.resumedFrom ? { resumedFrom: record.resumedFrom } : {}),
    ...(record.cwd ? { cwd: record.cwd } : {}),
    ...(record.parentSessionId
      ? { parentSessionId: record.parentSessionId }
      : {}),
    estimatedTokens: record.estimatedTokens,
    lifetimeEstimatedTokens: record.lifetimeEstimatedTokens,
    compactThresholdTokens: record.compactThresholdTokens,
    compactionCount: record.compactionCount,
    archiveCount: record.archiveCount,
    ...(record.lastCompactedAt
      ? { lastCompactedAt: record.lastCompactedAt }
      : {}),
    ...(record.lastArchivedAt ? { lastArchivedAt: record.lastArchivedAt } : {}),
    eventCount: record.events.length,
    historyTurns: record.history.length,
  };
}

async function buildRecord(
  principal: string,
  source: AgentSessionSource,
  options: CreateOptions,
): Promise<AgentSession> {
  const now = new Date().toISOString();
  const memorySnapshot =
    options.memorySnapshot ?? (await snapshotAgentMemory(principal));
  const created: AgentSessionEvent = {
    at: now,
    kind: "created",
    ...(options.resumedFrom
      ? { detail: `resumed from ${options.resumedFrom}` }
      : {}),
  };
  const record: AgentSession = {
    id: options.id ?? newAgentSessionId(),
    principalHash: principalHash(principal),
    source,
    title: safeTitle(options.title),
    titleSource: options.titleSource ?? "default",
    ...(options.conversationHash
      ? { conversationHash: options.conversationHash }
      : {}),
    createdAt: now,
    updatedAt: now,
    ...(options.resumedFrom ? { resumedFrom: options.resumedFrom } : {}),
    ...(normalizeAgentSessionCwd(options.cwd)
      ? { cwd: normalizeAgentSessionCwd(options.cwd) }
      : {}),
    ...(options.parentSessionId
      ? { parentSessionId: options.parentSessionId }
      : {}),
    memorySnapshot,
    ...(options.contextSummary
      ? { contextSummary: options.contextSummary }
      : {}),
    history: (options.history ?? []).slice(-MAX_HISTORY),
    events: [created],
    estimatedTokens: 0,
    lifetimeEstimatedTokens: 0,
    compactThresholdTokens: compactThresholdTokens(),
    compactionCount: 0,
    archiveCount: 0,
  };
  const estimatedTokens = sessionContextTokens(record);
  return {
    ...record,
    estimatedTokens,
    lifetimeEstimatedTokens: estimatedTokens,
  };
}

async function compactIfNeeded(
  record: AgentSession,
  reason: string,
): Promise<AgentSession> {
  record.estimatedTokens = sessionContextTokens(record);
  if (record.estimatedTokens < record.compactThresholdTokens) return record;
  const now = new Date();
  await archiveAgentSession(record, reason, now);
  let next = compactSessionContext(record, now.toISOString());
  const archived: AgentSessionEvent = {
    at: now.toISOString(),
    kind: "archived",
    detail: `${reason}; 30-day retention`,
  };
  next = {
    ...next,
    events: [...next.events.slice(-(MAX_EVENTS - 1)), archived],
    archiveCount: record.archiveCount + 1,
    lastArchivedAt: now.toISOString(),
  };
  next.estimatedTokens = sessionContextTokens(next);
  void pruneAgentSessionArchives().catch(() => undefined);
  return next;
}

async function requireOwned(
  principal: string,
  id: string,
): Promise<AgentSession> {
  const record = await readSessionFile(id);
  if (!record || record.principalHash !== principalHash(principal))
    throw new Error("agent session not found for this client");
  return record;
}

export async function createAgentSession(
  principal: string,
  source: AgentSessionSource,
  options: CreateOptions = {},
): Promise<AgentSession> {
  const record = await buildRecord(principal, source, options);
  return withSecurityStoreLock(sessionLockTarget(record.id), async () => {
    if (await readSessionFile(record.id))
      throw new Error("agent session id already exists");
    await writeSessionFile(record);
    return record;
  });
}

export async function findOrCreateAgentSessionForConversation(
  principal: string,
  hash: string,
  title = "ChatGPT session",
): Promise<AgentSession> {
  if (!/^[a-f0-9]{64}$/.test(hash))
    throw new Error("invalid conversation hash");
  const owner = principalHash(principal);
  const indexed = await readConversationSession(owner, hash);
  if (indexed) return indexed;
  return withSecurityStoreLock(
    conversationLockTarget(owner, hash),
    async () => {
      const current = await readConversationSession(owner, hash);
      if (current) return current;
      // Normal Next startup backfills the durable index before accepting requests,
      // keeping later conversation lookups O(1). The scan is only a compatibility
      // fallback for direct library use that bypassed instrumentation startup.
      if (!(await conversationIndexReady())) {
        const legacy = (await listSessionRecords()).find(
          (row) =>
            row.principalHash === owner &&
            row.source === "mcp" &&
            row.conversationHash === hash,
        );
        if (legacy) {
          await writeConversationRef(owner, hash, legacy.id);
          return legacy;
        }
      }
      const record = await buildRecord(principal, "mcp", {
        title,
        titleSource: "default",
        conversationHash: hash,
      });
      await writeSessionFile(record);
      await writeConversationRef(owner, hash, record.id);
      return record;
    },
  );
}

export async function getAgentSession(
  principal: string,
  id: string,
): Promise<AgentSession | null> {
  const record = await readSessionFile(id);
  return record?.principalHash === principalHash(principal) ? record : null;
}

export async function listAgentSessions(
  principal: string,
  limit = 30,
): Promise<AgentSessionSummary[]> {
  const owner = principalHash(principal),
    wanted = Math.max(1, Math.min(500, Math.trunc(limit) || 30));
  return (await listSessionRecords())
    .filter((row) => row.principalHash === owner)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, wanted)
    .map(summary);
}

export async function listAgentSessionsOwner(
  limit = 100,
): Promise<AgentSessionSummary[]> {
  const wanted = Math.max(1, Math.min(500, Math.trunc(limit) || 100));
  return (await listSessionRecords())
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, wanted)
    .map(summary);
}

export async function updateAgentSessionHistory(
  principal: string,
  id: string,
  history: unknown[],
  title?: string,
  titleSource: AgentSessionTitleSource = "auto",
): Promise<AgentSession> {
  return withSecurityStoreLock(sessionLockTarget(id), async () => {
    let record = await requireOwned(principal, id);
    const oldTokens = estimateTokens(record.history),
      newHistory = Array.isArray(history) ? history.slice(-MAX_HISTORY) : [];
    record.history = newHistory;
    record.lifetimeEstimatedTokens += Math.max(
      0,
      estimateTokens(newHistory) - oldTokens,
    );
    const legacyCliDefault =
      record.source === "cli" &&
      record.titleSource === "manual" &&
      record.title === "MSO Agent session";
    if (
      title &&
      (titleSource === "manual" ||
        record.titleSource !== "manual" ||
        legacyCliDefault)
    ) {
      record.title = safeTitle(title);
      record.titleSource = titleSource;
    }
    record.updatedAt = new Date().toISOString();
    record = await compactIfNeeded(record, "context-threshold");
    await writeSessionFile(record);
    return record;
  });
}

export async function maybeAutoTitleAgentSession(
  principal: string,
  id: string,
  hint: string,
): Promise<AgentSession | null> {
  return withSecurityStoreLock(sessionLockTarget(id), async () => {
    const record = await requireOwned(principal, id);
    if (record.titleSource === "manual" || record.titleSource === "auto")
      return record;
    record.title = autoSessionTitle(hint);
    record.titleSource = "auto";
    record.updatedAt = new Date().toISOString();
    await writeSessionFile(record);
    return record;
  });
}

export async function renameAgentSession(
  principal: string,
  id: string,
  title: string,
): Promise<AgentSession> {
  return withSecurityStoreLock(sessionLockTarget(id), async () => {
    const record = await requireOwned(principal, id);
    record.title = safeTitle(title);
    record.titleSource = "manual";
    record.updatedAt = new Date().toISOString();
    await writeSessionFile(record);
    return record;
  });
}

export async function appendAgentSessionEvent(
  principal: string,
  id: string,
  event: Omit<AgentSessionEvent, "at"> & { at?: string },
): Promise<void> {
  await withSecurityStoreLock(sessionLockTarget(id), async () => {
    let record = await requireOwned(principal, id);
    const at = event.at ?? new Date().toISOString();
    const row: AgentSessionEvent = {
      at,
      kind: event.kind,
      ...(event.tool ? { tool: event.tool.slice(0, 120) } : {}),
      ...(event.state ? { state: event.state.slice(0, 40) } : {}),
      ...(event.workflowId
        ? { workflowId: event.workflowId.slice(0, 80) }
        : {}),
      ...(event.detail
        ? {
            detail: redactText(
              event.detail.replace(/[\r\n\t]+/g, " ").trim(),
              500,
            ),
          }
        : {}),
    };
    record.events = [...record.events, row].slice(-MAX_EVENTS);
    record.updatedAt = at;
    record.lifetimeEstimatedTokens += estimateTokens(row);
    record = await compactIfNeeded(record, "event-threshold");
    await writeSessionFile(record);
  });
}

export async function resumeAgentSession(
  principal: string,
  targetId: string,
  currentId?: string,
): Promise<AgentSessionResumePacket> {
  const target = await requireOwned(principal, targetId);
  if (currentId && currentId !== targetId)
    await appendAgentSessionEvent(principal, currentId, {
      kind: "resumed",
      detail: `resumed ${targetId}`,
    });
  return {
    session: summary(target),
    memorySnapshot: target.memorySnapshot,
    ...(target.contextSummary ? { contextSummary: target.contextSummary } : {}),
    recentHistory: target.history.slice(-24),
    recentEvents: target.events.slice(-40),
  };
}

export async function updateAgentSessionLocation(
  principal: string,
  id: string,
  cwd?: string,
): Promise<AgentSession> {
  return withSecurityStoreLock(sessionLockTarget(id), async () => {
    const record = await requireOwned(principal, id);
    const normalized = normalizeAgentSessionCwd(cwd);
    if (normalized) record.cwd = normalized;
    else delete record.cwd;
    record.updatedAt = new Date().toISOString();
    await writeSessionFile(record);
    return record;
  });
}

export function agentSessionSummary(record: AgentSession): AgentSessionSummary {
  return summary(record);
}
