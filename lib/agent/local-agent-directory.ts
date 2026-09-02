import path from "node:path";
import { listAgentSessions } from "./session-store";
import { listLocalAgentPresence, localAgentStatus } from "./local-agent-presence";
import { localAgentSubscriberCount } from "./local-agent-events";
import type { AgentSessionSummary } from "./session-types";
import type { LocalAgentPresenceRecord, LocalAgentTarget } from "./local-agent-types";

function normalizeRef(value: string): string {
  const clean = String(value || "").trim();
  return clean.startsWith("[") && clean.endsWith("]") ? clean.slice(1, -1).trim() : clean;
}

function cleanDisplayName(value: string): string {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function buildRows(
  sessions: AgentSessionSummary[],
  presence: LocalAgentPresenceRecord[],
  now: number,
): LocalAgentTarget[] {
  const byId = new Map(sessions.map((row) => [row.id, row]));
  return presence.flatMap((entry) => {
    const session = byId.get(entry.sessionId);
    if (!session) return [];
    const name = cleanDisplayName(session.name).toLocaleLowerCase();
    if (!name) return [];
    const consumerCount = localAgentSubscriberCount(session.id);
    return [{
      id: session.id,
      name,
      alias: entry.alias,
      label: `[${name}]`,
      source: session.source,
      title: session.title,
      titleSource: session.titleSource,
      status: localAgentStatus(entry, now),
      consumerConnected: consumerCount > 0,
      consumerCount,
      ...(session.cwd ? { cwd: session.cwd } : {}),
      lastSeenAt: entry.lastSeenAt,
    }];
  });
}

export async function listLocalAgents(
  principal: string,
  options: { currentSessionId?: string; includeOffline?: boolean; now?: number } = {},
): Promise<LocalAgentTarget[]> {
  const now = options.now ?? Date.now();
  const [sessions, presence] = await Promise.all([
    listAgentSessions(principal, 500),
    listLocalAgentPresence(principal),
  ]);
  return buildRows(sessions, presence, now)
    .filter((row) => options.includeOffline || !["offline", "ended"].includes(row.status))
    .filter((row) => !options.currentSessionId || row.id !== options.currentSessionId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function matches(row: LocalAgentTarget, ref: string): boolean {
  const wanted = normalizeRef(ref).toLocaleLowerCase();
  const label = normalizeRef(row.label).toLocaleLowerCase();
  const title = row.titleSource === "manual" ? cleanDisplayName(row.title).toLocaleLowerCase() : "";
  const cwd = row.cwd ? path.resolve(row.cwd).toLocaleLowerCase() : "";
  const base = row.cwd ? path.basename(row.cwd).toLocaleLowerCase() : "";
  return [row.id.toLocaleLowerCase(), row.name.toLocaleLowerCase(), row.alias.toLocaleLowerCase(), label, title, cwd, base].includes(wanted);
}

export async function resolveLocalAgent(
  principal: string,
  ref: string,
  currentSessionId?: string,
): Promise<LocalAgentTarget> {
  const wanted = normalizeRef(ref);
  if (!wanted) throw new Error("local agent target is required");
  const rows = await listLocalAgents(principal, { includeOffline: true });
  const matched = rows.filter((row) => matches(row, wanted));
  if (!matched.length) throw new Error("local agent target not found");
  const active = matched.filter((row) => !["offline", "ended"].includes(row.status));
  if (active.length > 1 || (!active.length && matched.length > 1)) {
    const choices = (active.length ? active : matched).map((row) => row.alias).join(" or ");
    throw new Error(`local agent target is ambiguous; use ${choices}`);
  }
  const target = active[0] || matched[0];
  if (target.id === currentSessionId) throw new Error("cannot send a local agent message to the same session");
  return target;
}
