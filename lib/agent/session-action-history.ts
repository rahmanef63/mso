import { createHash, randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { redactText } from "@/lib/security/redact-text";
import { agentSessionArchiveRoot, archiveRetentionDays } from "./session-archive";
import { resolveSessionFlowAction } from "./session-flow";
import type { AgentSession, AgentSessionEvent } from "./session-types";

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_ACTION_RECORDS = 5000;
const KINDS = new Set(["created", "resumed", "tool", "workflow", "note", "compacted", "archived"]);
const INDEX_FILE = /^(\d{8}_\d{6}_[a-f0-9]{8})__actions\.json$/;

type ArchivedActionRecord = { sequence: number; event: AgentSessionEvent };
type ArchivedActionIndex = {
  schemaVersion: 1;
  sessionId: string;
  principalHash: string;
  cwd?: string;
  updatedAt: string;
  records: ArchivedActionRecord[];
};

function validEvent(value: unknown): value is AgentSessionEvent {
  if (!value || typeof value !== "object") return false;
  const row = value as AgentSessionEvent;
  return typeof row.at === "string" && Number.isFinite(Date.parse(row.at)) && KINDS.has(row.kind) &&
    ["tool", "state", "workflowId", "detail"].every((key) => row[key as keyof AgentSessionEvent] === undefined || (typeof row[key as keyof AgentSessionEvent] === "string" && String(row[key as keyof AgentSessionEvent]).length <= 16000)) &&
    (row.semantic === undefined || (row.semantic.version === 1 && Number.isSafeInteger(row.semantic.step) && row.semantic.step > 0 &&
      Number.isSafeInteger(row.semantic.action) && row.semantic.action > 0 &&
      ["context", "plan", "inspect", "implement", "verify", "integrate", "deploy", "result", "other"].includes(row.semantic.category)));
}
function events(value: unknown): value is AgentSessionEvent[] {
  return Array.isArray(value) && value.length <= 10000 && value.every(validEvent);
}
function safeEvent(event: AgentSessionEvent): AgentSessionEvent {
  return {
    at: new Date(event.at).toISOString(), kind: event.kind,
    ...(event.tool ? { tool: event.tool.slice(0, 120) } : {}),
    ...(event.state ? { state: event.state.slice(0, 40) } : {}),
    ...(event.workflowId ? { workflowId: event.workflowId.slice(0, 80) } : {}),
    ...(event.detail ? { detail: redactText(event.detail, 500) } : {}),
    ...(event.semantic ? { semantic: event.semantic } : {}),
  };
}
function actionIndexPath(sessionId: string): string {
  if (!/^\d{8}_\d{6}_[a-f0-9]{8}$/.test(sessionId)) throw new Error("invalid agent session id");
  return path.join(agentSessionArchiveRoot(), `${sessionId}__actions.json`);
}
async function secureArchiveRoot(): Promise<string> {
  const root = agentSessionArchiveRoot();
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await fs.chmod(root, 0o700).catch(() => undefined);
  const stat = await fs.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) || (typeof process.getuid === "function" && stat.uid !== process.getuid())) throw new Error("unsafe agent session archive root");
  return root;
}
async function readActionIndex(target: string): Promise<ArchivedActionIndex | null> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_BYTES || (stat.mode & 0o077) || (typeof process.getuid === "function" && stat.uid !== process.getuid())) return null;
    const body = await handle.readFile("utf8");
    const parsed = JSON.parse(body) as Partial<ArchivedActionIndex>;
    if (parsed.schemaVersion !== 1 || typeof parsed.sessionId !== "string" || typeof parsed.principalHash !== "string" || !Array.isArray(parsed.records) || parsed.records.length > MAX_ACTION_RECORDS) return null;
    const records = parsed.records.filter((row): row is ArchivedActionRecord => Boolean(row && Number.isSafeInteger(row.sequence) && row.sequence > 0 && validEvent(row.event)));
    return { schemaVersion: 1, sessionId: parsed.sessionId, principalHash: parsed.principalHash, ...(typeof parsed.cwd === "string" ? { cwd: parsed.cwd.slice(0, 4096) } : {}), updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(), records };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  } finally { await handle?.close().catch(() => undefined); }
}

/** Persist only events that are about to leave the hot 400-event session ledger. */
export async function archiveDroppedSessionEvents(session: Pick<AgentSession, "id" | "principalHash" | "cwd">, dropped: AgentSessionEvent[], eventSeqBase: number): Promise<void> {
  if (!dropped.length) return;
  await secureArchiveRoot();
  const target = actionIndexPath(session.id), cutoff = Date.now() - archiveRetentionDays() * 86_400_000;
  await withSecurityStoreLock(target, async () => {
    const current = await readActionIndex(target);
    if (current && (current.sessionId !== session.id || current.principalHash !== session.principalHash)) throw new Error("session action index owner mismatch");
    const existing = current?.records.filter((row) => Date.parse(row.event.at) >= cutoff) ?? [];
    const bySequence = new Map(existing.map((row) => [row.sequence, row]));
    dropped.forEach((event, index) => bySequence.set(eventSeqBase + index + 1, { sequence: eventSeqBase + index + 1, event: safeEvent(event) }));
    const records = [...bySequence.values()].sort((a, b) => a.sequence - b.sequence).slice(-MAX_ACTION_RECORDS);
    const next: ArchivedActionIndex = { schemaVersion: 1, sessionId: session.id, principalHash: session.principalHash, ...(session.cwd ? { cwd: session.cwd } : {}), updatedAt: new Date().toISOString(), records };
    const body = JSON.stringify(next) + "\n";
    if (Buffer.byteLength(body) > MAX_BYTES) throw new Error("session action index exceeds 4 MiB");
    const tmp = `${target}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, body, { flag: "wx", mode: 0o600 });
      await fs.rename(tmp, target);
      await fs.chmod(target, 0o600).catch(() => undefined);
    } finally { await fs.unlink(tmp).catch(() => undefined); }
  });
}

async function resolveActionIndex(session: AgentSession, actionRef: string) {
  const index = await readActionIndex(actionIndexPath(session.id)).catch(() => null);
  if (!index || index.sessionId !== session.id || index.principalHash !== session.principalHash) return null;
  const cutoff = Date.now() - archiveRetentionDays() * 86_400_000;
  for (const row of index.records) {
    if (Date.parse(row.event.at) < cutoff) continue;
    const resolved = resolveSessionFlowAction([row.event], actionRef, session.cwd ?? index.cwd, row.sequence - 1);
    if (resolved) return resolved;
  }
  return null;
}

/** Caller supplies an authenticated principal and its exact loaded session, never an arbitrary archive path. */
export async function resolveHistoricalSessionAction(principal: string, session: AgentSession, actionRef: string) {
  const owner = createHash("sha256").update(principal).digest("hex");
  if (session.principalHash !== owner) throw new Error("session not found");
  if (!/^(?:S\d+\.A\d+|E\d+|action_[a-f0-9]{20})$/i.test(actionRef.trim())) return null;
  const current = resolveSessionFlowAction(session.events, actionRef, session.cwd, session.eventSeqBase);
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
  const seen = new Set<string>(), cutoff = Date.now() - archiveRetentionDays() * 86400000;
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
      if (payload?.schemaVersion !== 1 || typeof payload.archivedAt !== "string" || !Number.isFinite(Date.parse(payload.archivedAt)) || Date.parse(payload.archivedAt) < cutoff || archived?.id !== session.id || archived?.principalHash !== owner || !events(archived.events)) continue;
      const base = archived.eventSeqBase ?? 0;
      if (!Number.isSafeInteger(base) || base < 0) continue;
      const resolved = resolveSessionFlowAction(archived.events, actionRef, session.cwd, base);
      if (resolved) return resolved;
    } catch { /* malformed/expired/unsafe archives do not block other matches */ }
    finally { await handle?.close().catch(() => undefined); }
  }
  return null;
}

export async function pruneSessionActionIndexes(now = Date.now()): Promise<number> {
  const root = await secureArchiveRoot(), cutoff = now - archiveRetentionDays() * 86_400_000;
  const names = await fs.readdir(root).catch(() => [] as string[]); let removed = 0;
  for (const name of names) {
    if (!INDEX_FILE.test(name)) continue;
    const file = path.join(root, name);
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      if (stat.mtimeMs < cutoff) { await fs.unlink(file); removed += 1; }
    } catch { /* ignore raced or malformed entries */ }
  }
  return removed;
}
