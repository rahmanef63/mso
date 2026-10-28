import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { sessionLockTarget, writeSessionFile } from "./session-files";
import { compactSessionContext, estimateTokens, MAX_EVENTS, sessionContextTokens } from "./session-policy";
import { retainSessionEvents } from "./session-sequence";
import { appendSemanticSessionEvent } from "./session-semantic";
import { archiveAgentSession, pruneAgentSessionArchives } from "./session-archive";
import { requireOwned } from "./session-record";
import { artifactLocation } from "./artifact-paths";
import { NextResponse } from "next/server";
import type { AgentSession, AgentSessionEvent } from "./session-types";

export interface CompactAgentSessionReport {
  session: AgentSession;
  archived: boolean;
  archiveReason?: string;
  beforeTokens: number;
  afterTokens: number;
  archiveCount: number;
}

async function forceCompactRecord(
  record: AgentSession,
  reason: string,
): Promise<CompactAgentSessionReport> {
  const beforeTokens = sessionContextTokens(record);
  record.estimatedTokens = beforeTokens;
  const now = new Date();
  const nowIso = now.toISOString();
  const candidate = compactSessionContext(record, nowIso);
  const droppedTurns = record.history.length - candidate.history.length;
  const historyShrunk = estimateTokens(candidate.history) < estimateTokens(record.history);

  if (droppedTurns <= 0 && !historyShrunk) {
    return {
      session: record,
      archived: false,
      archiveReason: "context already minimal",
      beforeTokens,
      afterTokens: beforeTokens,
      archiveCount: record.archiveCount,
    };
  }

  await archiveAgentSession(record, reason, now);
  let next = candidate;
  const archivedEvent: AgentSessionEvent = {
    at: nowIso,
    kind: "archived",
    detail: `${reason}; 30-day retention`,
  };
  const retained = retainSessionEvents(
    appendSemanticSessionEvent(next.events, archivedEvent),
    next.eventSeqBase,
    MAX_EVENTS,
  );
  next = {
    ...next,
    events: retained.events,
    eventSeqBase: retained.eventSeqBase,
    archiveCount: record.archiveCount + 1,
    lastArchivedAt: nowIso,
  };
  next.estimatedTokens = sessionContextTokens(next);
  void pruneAgentSessionArchives().catch(() => undefined);
  return {
    session: next,
    archived: true,
    archiveReason: reason,
    beforeTokens,
    afterTokens: next.estimatedTokens,
    archiveCount: next.archiveCount,
  };
}

export async function compactAgentSessionNow(
  principal: string,
  id: string,
  reason?: string,
): Promise<CompactAgentSessionReport>;
export async function compactAgentSessionNow(
  record: AgentSession,
  reason?: string,
): Promise<CompactAgentSessionReport>;
export async function compactAgentSessionNow(
  principalOrRecord: string | AgentSession,
  idOrReason?: string,
  optionalReason = "manual",
): Promise<CompactAgentSessionReport> {
  if (typeof principalOrRecord === "object") {
    const record = principalOrRecord;
    const reason = idOrReason ?? optionalReason;
    return withSecurityStoreLock(sessionLockTarget(record.id), async () => {
      const result = await forceCompactRecord(record, reason);
      if (result.archived) {
        await writeSessionFile(result.session);
      }
      return result;
    });
  }

  const principal = principalOrRecord;
  const id = idOrReason!;
  const reason = optionalReason;
  return withSecurityStoreLock(sessionLockTarget(id), async () => {
    const record = await requireOwned(principal, id);
    const result = await forceCompactRecord(record, reason);
    if (result.archived) {
      await writeSessionFile(result.session);
    }
    return result;
  });
}

export async function compactAgentSessionRouteHandler(
  principal: string,
  rawId?: string,
): Promise<NextResponse> {
  const id = String(rawId || "").trim();
  if (!id)
    return NextResponse.json(
      { error: "id_required" },
      { status: 400 },
    );
  const result = await compactAgentSessionNow(principal, id, "manual");
  return NextResponse.json({
    session: { ...result.session, artifacts: artifactLocation(result.session) },
    archived: result.archived,
    archiveReason: result.archiveReason,
    beforeTokens: result.beforeTokens,
    afterTokens: result.afterTokens,
    archiveCount: result.archiveCount,
  });
}
