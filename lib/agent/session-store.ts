import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { withUniqueSessionName, type CreateOptions } from "./session-create";
import { conversationIndexReady, conversationLockTarget, listSessionRecords, principalHash, readConversationSession, readSessionFile, sessionLockTarget, writeConversationRef, writeSessionFile } from "./session-files";
import { normalizeAgentSessionCwd } from "./session-location";
import { appendAgentSessionEvent } from "./session-mutations";
import { requireOwned, summary } from "./session-record";
import type { AgentSession, AgentSessionResumePacket, AgentSessionSource, AgentSessionSummary } from "./session-types";
export { appendAgentSessionEvent, maybeAutoTitleAgentSession, renameAgentSession, renameAgentSessionName, updateAgentSessionHistory } from "./session-mutations";
export type { AgentSession,AgentSessionEvent,AgentSessionResumePacket,AgentSessionSource,AgentSessionSummary } from "./session-types";

export async function createAgentSession(
  principal: string,
  source: AgentSessionSource,
  options: CreateOptions = {},
): Promise<AgentSession> {
  return withUniqueSessionName(principal, source, options, async (record) =>
    withSecurityStoreLock(sessionLockTarget(record.id), async () => {
      if (await readSessionFile(record.id))
        throw new Error("agent session id already exists");
      await writeSessionFile(record);
      return record;
    }),
  );
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
      return withUniqueSessionName(principal, "mcp", {
        title,
        titleSource: "default",
        conversationHash: hash,
      }, async (record) => {
        await writeSessionFile(record);
        await writeConversationRef(owner, hash, record.id);
        return record;
      });
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
