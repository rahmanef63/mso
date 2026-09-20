import path from "node:path";
import { listAgentSessions } from "./session-store";
import { countLocalAgentExecutableMessages } from "./local-agent-mailbox";
import { listLocalAgentPresence, localAgentStatus } from "./local-agent-presence";
import { localAgentSubscriberCount } from "./local-agent-events";
import { listLocalAgentStandbyRecords } from "./local-agent-standby-store";
import type { AgentSessionSummary } from "./session-types";
import type { LocalAgentPresenceRecord, LocalAgentStandbyRecord, LocalAgentTarget } from "./local-agent-types";

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

async function buildRows(
  principal: string,
  sessions: AgentSessionSummary[],
  presence: LocalAgentPresenceRecord[],
  standby: LocalAgentStandbyRecord[],
  now: number,
): Promise<LocalAgentTarget[]> {
  const presenceById = new Map(presence.map((row) => [row.sessionId, row]));
  const standbyById = new Map(standby.map((row) => [row.sessionId, row]));
  const relevant = sessions.filter((session) => presenceById.has(session.id) || standbyById.has(session.id));
  return Promise.all(relevant.flatMap((session) => {
    const entry = presenceById.get(session.id);
    const armed = standbyById.get(session.id);
    const name = cleanDisplayName(session.name).toLocaleLowerCase();
    if (!name) return [];
    return [Promise.resolve(countLocalAgentExecutableMessages(principal, session.id)).catch(() => 0).then((queuedCount) => {
      const consumerCount = localAgentSubscriberCount(session.id);
      const status = entry ? localAgentStatus(entry, now) : "offline";
      const standbyArmed = armed?.armed === true;
      const actionable = consumerCount > 0 || standbyArmed;
      return {
        id: session.id,
        name,
        alias: entry?.alias ?? session.id,
        label: `[${name}]`,
        source: session.source,
        title: session.title,
        titleSource: session.titleSource,
        status,
        consumerConnected: consumerCount > 0,
        consumerCount,
        standbyArmed,
        ...(armed ? { standbyState: armed.state, standbyWorkflowId: armed.workflowId, standbySince: armed.armedAt } : {}),
        actionable,
        queuedCount,
        ...(armed?.currentMessageId ? { currentCommand: armed.currentMessageId } : {}),
        ...(session.cwd ? { cwd: session.cwd } : {}),
        lastSeenAt: entry?.lastSeenAt ?? armed?.updatedAt ?? session.updatedAt,
      } satisfies LocalAgentTarget;
    })];
  }));
}

export async function listLocalAgents(
  principal: string,
  options: { currentSessionId?: string; includeOffline?: boolean; now?: number } = {},
): Promise<LocalAgentTarget[]> {
  const now = options.now ?? Date.now();
  const [sessions, presence, standby] = await Promise.all([
    listAgentSessions(principal, 500),
    listLocalAgentPresence(principal),
    listLocalAgentStandbyRecords(principal),
  ]);
  return (await buildRows(principal, sessions, presence, standby, now))
    .filter((row) => options.includeOffline || row.actionable || !["offline", "ended"].includes(row.status))
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
  const active = matched.filter((row) => row.actionable || !["offline", "ended"].includes(row.status));
  if (active.length > 1 || (!active.length && matched.length > 1)) {
    const choices = (active.length ? active : matched).map((row) => row.alias).join(" or ");
    throw new Error(`local agent target is ambiguous; use ${choices}`);
  }
  const target = active[0] || matched[0];
  if (target.id === currentSessionId) throw new Error("cannot send a local agent message to the same session");
  return target;
}
