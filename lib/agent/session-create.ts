import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { snapshotAgentMemory, type AgentMemorySnapshot } from "./memory-store";
import { listSessionRecords, newAgentSessionId, principalHash, sessionNameLockTarget } from "./session-files";
import { normalizeAgentSessionCwd } from "./session-location";
import { allocateAgentSessionName, requireAgentSessionName } from "./session-name";
import { MAX_HISTORY, compactThresholdTokens, safeTitle, sessionContextTokens } from "./session-policy";
import type { AgentSession, AgentSessionEvent, AgentSessionSource, AgentSessionTitleSource } from "./session-types";

export interface CreateOptions {
  id?: string;
  name?: string;
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

async function buildRecord(
  principal: string,
  source: AgentSessionSource,
  options: CreateOptions,
  usedNames: string[],
): Promise<AgentSession> {
  const now = new Date().toISOString();
  const name = options.name ? requireAgentSessionName(options.name) : allocateAgentSessionName(usedNames);
  if (usedNames.includes(name)) throw new Error(`session name @${name} is already in use`);
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
    name,
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

export async function withUniqueSessionName<T>(
  principal: string,
  source: AgentSessionSource,
  options: CreateOptions,
  commit: (record: AgentSession) => Promise<T>,
): Promise<T> {
  const owner = principalHash(principal);
  // ponytail: one owner lock and scan per creation; index names if this measured scan becomes material.
  return withSecurityStoreLock(sessionNameLockTarget(owner), async () => {
    const used = (await listSessionRecords()).filter(row => row.principalHash === owner).map(row => row.name);
    return commit(await buildRecord(principal, source, options, used));
  });
}
