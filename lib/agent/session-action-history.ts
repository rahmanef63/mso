import { createHash } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { agentSessionArchiveRoot, archiveRetentionDays } from "./session-archive";
import { sessionPreservation } from "./session-preservation";
import { resolveSessionFlowAction } from "./session-flow";
import type { AgentSession, AgentSessionEvent } from "./session-types";
import { MAX_BYTES, INDEX_FILE, validActionEvents, actionIndexPath, secureArchiveRoot, readActionIndex, readActionSegments } from "./session-action-index";
export { archiveDroppedSessionEvents } from "./session-action-index";

export type HistoricalSessionActionRecord = {
  resolution: NonNullable<ReturnType<typeof resolveSessionFlowAction>>;
  event: AgentSessionEvent;
  sequence: number;
};

function resolveEventRecord(events: AgentSessionEvent[], actionRef: string, cwd: string | undefined, rawBase: number): HistoricalSessionActionRecord | null {
  const resolution = resolveSessionFlowAction(events, actionRef, cwd, rawBase);
  if (!resolution) return null;
  const sequence = Number(resolution.action.eventRef.slice(1));
  if (!Number.isSafeInteger(sequence) || sequence <= rawBase) return null;
  const event = events[sequence - rawBase - 1];
  return event ? { resolution, event, sequence } : null;
}

async function resolveActionIndex(session: AgentSession, actionRef: string): Promise<HistoricalSessionActionRecord | null> {
  const targets = [actionIndexPath(session.id), ...await readActionSegments(session.id)];
  const cutoff = (await sessionPreservation(session.id)).protected ? -Infinity : Date.now() - archiveRetentionDays() * 86_400_000;
  for (const target of targets) {
    const index = await readActionIndex(target).catch(() => null);
    if (!index || index.sessionId !== session.id || index.principalHash !== session.principalHash) continue;
    for (const row of index.records) {
      if (Date.parse(row.event.at) < cutoff) continue;
      const resolution = resolveSessionFlowAction([row.event], actionRef, session.cwd ?? index.cwd, row.sequence - 1);
      if (resolution) return { resolution, event: row.event, sequence: row.sequence };
    }
  }
  return null;
}

async function resolveHistoricalSessionActionRecordOwned(session: AgentSession, actionRef: string, owner: string): Promise<HistoricalSessionActionRecord | null> {
  if (session.principalHash !== owner) throw new Error("session not found");
  if (!/^(?:S\d+\.A\d+|E\d+|action_[a-f0-9]{20})$/i.test(actionRef.trim())) return null;
  const current = resolveEventRecord(session.events, actionRef, session.cwd, session.eventSeqBase ?? 0);
  if (current) return current;
  const indexed = await resolveActionIndex(session, actionRef);
  if (indexed) return indexed;
  if (!/^\d{8}_\d{6}_[a-f0-9]{8}$/.test(session.id)) return null;
  const root = agentSessionArchiveRoot();
  const owned = (stat: import("node:fs").Stats) => !(stat.mode & 0o077) && (typeof process.getuid !== "function" || stat.uid === process.getuid());
  try {
    const stat = await fs.lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !owned(stat)) return null;
  } catch { return null; }
  const seen = new Set<string>(), cutoff = (await sessionPreservation(session.id)).protected ? -Infinity : Date.now() - archiveRetentionDays() * 86400000;
  const directory = await fs.opendir(root), names: string[] = [];
  let scanned = 0;
  for await (const entry of directory) {
    if (++scanned > 10000) break;
    if (entry.isFile() && entry.name.startsWith(`${session.id}__`) && /^\d{8}_\d{6}_[a-f0-9]{8}__\d{8}T\d{6}Z__[a-z0-9-]+\.json\.gz$/.test(entry.name)) names.push(entry.name);
  }
  for (const name of names.sort().reverse().slice(0, 64)) {
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(path.join(root, name), constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || !owned(stat) || stat.size > MAX_BYTES || stat.mtimeMs < cutoff) continue;
      const buffer = Buffer.alloc(MAX_BYTES + 1), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_BYTES) continue;
      const compressed = buffer.subarray(0, bytesRead), digest = createHash("sha256").update(compressed).digest("hex");
      if (seen.has(digest)) continue; seen.add(digest);
      const payload = JSON.parse(gunzipSync(compressed, { maxOutputLength: MAX_BYTES }).toString("utf8"));
      const archived = payload?.session;
      if (payload?.schemaVersion !== 1 || typeof payload.archivedAt !== "string" || !Number.isFinite(Date.parse(payload.archivedAt)) || Date.parse(payload.archivedAt) < cutoff || archived?.id !== session.id || archived?.principalHash !== owner || !validActionEvents(archived.events)) continue;
      const base = archived.eventSeqBase ?? 0;
      if (!Number.isSafeInteger(base) || base < 0) continue;
      const record = resolveEventRecord(archived.events, actionRef, session.cwd, base);
      if (record) return record;
    } catch { /* malformed/expired/unsafe archives do not block other matches */ }
    finally { await handle?.close().catch(() => undefined); }
  }
  return null;
}

/** MCP/client path: caller supplies an authenticated principal and its exact loaded session. */
export async function resolveHistoricalSessionActionRecord(principal: string, session: AgentSession, actionRef: string): Promise<HistoricalSessionActionRecord | null> {
  const owner = createHash("sha256").update(principal).digest("hex");
  return resolveHistoricalSessionActionRecordOwned(session, actionRef, owner);
}

/** Web owner-console path. Caller MUST already enforce the application owner role. */
export async function resolveHistoricalSessionActionRecordForOwner(session: AgentSession, actionRef: string): Promise<HistoricalSessionActionRecord | null> {
  return resolveHistoricalSessionActionRecordOwned(session, actionRef, session.principalHash);
}

export async function resolveHistoricalSessionAction(principal: string, session: AgentSession, actionRef: string) {
  return (await resolveHistoricalSessionActionRecord(principal, session, actionRef))?.resolution ?? null;
}

export async function pruneSessionActionIndexes(now = Date.now()): Promise<number> {
  const root = await secureArchiveRoot(), cutoff = now - archiveRetentionDays() * 86_400_000;
  const names = await fs.readdir(root).catch(() => [] as string[]); let removed = 0;
  for (const name of names) {
    if (!INDEX_FILE.test(name)) continue;
    if ((await sessionPreservation(name.split("__")[0])).protected) continue;
    const file = path.join(root, name);
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      if (stat.mtimeMs < cutoff) { await fs.unlink(file); removed += 1; }
    } catch { /* ignore raced or malformed entries */ }
  }
  return removed;
}
