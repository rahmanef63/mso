import { SESSION_EVENT_PAGE_SIZE, SESSION_PAGE_SIZE } from "@/lib/contracts/session-monitor";
import type { SessionCard, SessionDetail, SessionPage } from "@/lib/contracts/session-monitor";
import { redactText } from "@/lib/security/redact-text";
import { listSessionRecords, readSessionFile, SESSION_ID } from "./session-files";
import { listLocalAgentPresenceOwner, localAgentStatus } from "./local-agent-presence";
import { localAgentConsumerConnected } from "./local-agent-events";
import type { AgentSession } from "./session-types";
import type { LocalAgentPresenceRecord } from "./local-agent-types";

function text(value: string | undefined, max = 500): string | undefined {
  return value ? redactText(value, max).replace(/[\u0000-\u001f\u007f]/g, " ") : undefined;
}
function card(row: AgentSession, presence: LocalAgentPresenceRecord | undefined, now: number): SessionCard {
  // Never join a presence record from a different authenticated principal.
  const entry = presence?.principalHash === row.principalHash ? presence : undefined;
  return {
    id: row.id, name: text(row.name, 24) || row.id, title: text(row.title, 160) || "Untitled session",
    source: row.source, status: entry ? localAgentStatus(entry, now) : "offline",
    receiverConnected: localAgentConsumerConnected(row.id),
    lastSeenAt: entry?.lastSeenAt || row.updatedAt, createdAt: row.createdAt,
    cwd: text(row.cwd), eventCount: row.events.length, archiveCount: row.archiveCount,
    resumedFrom: row.resumedFrom, parentSessionId: row.parentSessionId,
  };
}
function pagination(total: number, requested: number, pageSize: number) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pages, Math.max(1, Number.isFinite(requested) ? Math.trunc(requested) : 1));
  return { total, page, pages, pageSize };
}
/** Owner dashboard only. Model-facing directory remains strictly principal-scoped. */
export async function ownerSessionPage(requested = 1, includeOffline = false): Promise<SessionPage> {
  const [records, presence] = await Promise.all([listSessionRecords(), listLocalAgentPresenceOwner()]);
  const now = Date.now(), byId = new Map(presence.map(row => [row.sessionId, row]));
  const all = records.map(row => card(row, byId.get(row.id), now));
  const active = all.filter(row => row.status !== "offline" && row.status !== "ended");
  const rows = (includeOffline ? all : active).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt) || a.id.localeCompare(b.id));
  const paging = pagination(rows.length, requested, SESSION_PAGE_SIZE);
  return { ...paging, sessions: rows.slice((paging.page - 1) * paging.pageSize, paging.page * paging.pageSize),
    activeCount: active.length, observedAt: new Date(now).toISOString() };
}
export async function ownerSessionDetail(id: string, requested = 1): Promise<SessionDetail | null> {
  if (!SESSION_ID.test(id)) throw new Error("invalid_session_id");
  const [record, presence] = await Promise.all([readSessionFile(id), listLocalAgentPresenceOwner()]);
  if (!record) return null;
  const now = Date.now(), paging = pagination(record.events.length, requested, SESSION_EVENT_PAGE_SIZE);
  const events = record.events.slice().reverse().slice((paging.page - 1) * paging.pageSize, paging.page * paging.pageSize)
    .map(row => ({ at: row.at, kind: text(row.kind, 40) || "note", tool: text(row.tool, 100),
      state: text(row.state, 60), detail: text(row.detail, 1000), workflowId: text(row.workflowId, 100) }));
  return { ...paging, session: card(record, presence.find(row => row.sessionId === id), now),
    events, observedAt: new Date(now).toISOString() };
}
