import path from "node:path";
import { listAgentSessions } from "./session-store";
import { listLocalAgentPresence, localAgentStatus } from "./local-agent-presence";
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

function manualName(session: AgentSessionSummary): string | null {
  const name = session.titleSource === "manual" ? cleanDisplayName(session.title) : "";
  return name || null;
}

function buildRows(
  sessions: AgentSessionSummary[],
  presence: LocalAgentPresenceRecord[],
  now: number,
): LocalAgentTarget[] {
  const byId = new Map(sessions.map((row) => [row.id, row]));
  const raw = presence.flatMap((entry) => {
    const session = byId.get(entry.sessionId);
    if (!session) return [];
    return [{ session, entry, status: localAgentStatus(entry, now), manual: manualName(session) }];
  });
  const duplicateNames = new Map<string, number>();
  for (const row of raw) {
    if (!row.manual || row.status === "offline" || row.status === "ended") continue;
    const key = row.manual.toLocaleLowerCase();
    duplicateNames.set(key, (duplicateNames.get(key) || 0) + 1);
  }
  return raw.map(({ session, entry, status, manual }) => {
    const duplicate = manual && (duplicateNames.get(manual.toLocaleLowerCase()) || 0) > 1;
    const suffix = entry.alias.replace(/^agent-/, "");
    const label = manual ? `[${manual}${duplicate ? ` · ${suffix}` : ""}]` : `[${entry.alias}]`;
    return {
      id: session.id,
      alias: entry.alias,
      label,
      source: session.source,
      title: session.title,
      titleSource: session.titleSource,
      status,
      ...(session.cwd ? { cwd: session.cwd } : {}),
      lastSeenAt: entry.lastSeenAt,
    };
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
    .sort((a, b) => a.alias.localeCompare(b.alias, undefined, { numeric: true }));
}

function matches(row: LocalAgentTarget, ref: string): boolean {
  const wanted = normalizeRef(ref).toLocaleLowerCase();
  const label = normalizeRef(row.label).toLocaleLowerCase();
  const title = row.titleSource === "manual" ? cleanDisplayName(row.title).toLocaleLowerCase() : "";
  const cwd = row.cwd ? path.resolve(row.cwd).toLocaleLowerCase() : "";
  const base = row.cwd ? path.basename(row.cwd).toLocaleLowerCase() : "";
  return [row.id.toLocaleLowerCase(), row.alias.toLocaleLowerCase(), label, title, cwd, base].includes(wanted);
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
