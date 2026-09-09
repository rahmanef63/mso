import { artifactLocation } from "./artifact-paths";
import { archiveAgentSession, pruneAgentSessionArchives } from "./session-archive";
import { principalHash, readSessionFile } from "./session-files";
import { compactSessionContext, MAX_EVENTS, sessionContextTokens } from "./session-policy";
import type { AgentSession, AgentSessionEvent, AgentSessionSummary } from "./session-types";

export function summary(record: AgentSession): AgentSessionSummary {
  return {
    id: record.id,
    source: record.source,
    name: record.name,
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
    artifacts: artifactLocation(record),
  };
}

export async function compactIfNeeded(
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

export async function requireOwned(
  principal: string,
  id: string,
): Promise<AgentSession> {
  const record = await readSessionFile(id);
  if (!record || record.principalHash !== principalHash(principal))
    throw new Error("agent session not found for this client");
  return record;
}

