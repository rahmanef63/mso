import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { compactThresholdTokens, inferredTitleSource, MAX_EVENTS, MAX_HISTORY, safeTitle, sessionContextTokens } from "./session-policy";
import type { AgentSession } from "./session-types";
import { legacyAgentSessionName, normalizeAgentSessionName } from "./session-name";

const ROOT = path.resolve((process.env.OS_AGENT_SESSIONS_DIR || path.join(os.homedir(), ".mso", "agent-sessions")).replace(/^~(?=$|\/)/, os.homedir()));
const LOCK_ROOT = path.join(ROOT, ".locks");
const CONVERSATION_ROOT = path.join(ROOT, ".conversation-index");
const CONVERSATION_READY = path.join(CONVERSATION_ROOT, ".ready-v1");
export const SESSION_ID = /^\d{8}_\d{6}_[a-f0-9]{8}$/;
const HASH64 = /^[a-f0-9]{64}$/;
const MAX_SESSION_BYTES = 16 * 1024 * 1024;

export function principalHash(principal: string): string {
  if (!principal || principal.length > 512) throw new Error("invalid agent session principal");
  return createHash("sha256").update(principal).digest("hex");
}

export function newAgentSessionId(now = new Date()): string {
  const iso = now.toISOString();
  return `${iso.slice(0, 10).replaceAll("-", "")}_${iso.slice(11, 19).replaceAll(":", "")}_${randomBytes(4).toString("hex")}`;
}

export function sessionLockTarget(id: string): string {
  if (!SESSION_ID.test(id)) throw new Error("invalid agent session id");
  return path.join(LOCK_ROOT, "sessions", id);
}

export function sessionNameLockTarget(ownerHash: string, name: string): string {
  if (!HASH64.test(ownerHash)) throw new Error("invalid agent session owner hash");
  if (!/^[a-z][a-z0-9-]{1,23}$/.test(name)) throw new Error("invalid agent session name lock");
  return path.join(LOCK_ROOT, "names", ownerHash, name);
}

function conversationRefFile(ownerHash: string, conversationHash: string): string {
  if (!HASH64.test(ownerHash) || !HASH64.test(conversationHash)) throw new Error("invalid agent conversation index key");
  return path.join(CONVERSATION_ROOT, ownerHash.slice(0, 2), ownerHash, `${conversationHash}.ref`);
}

export function conversationLockTarget(ownerHash: string, conversationHash: string): string {
  return conversationRefFile(ownerHash, conversationHash);
}

export async function readConversationSession(ownerHash: string, conversationHash: string): Promise<AgentSession | null> {
  const file = conversationRefFile(ownerHash, conversationHash);
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > 128) throw new Error("agent conversation index has an invalid shape");
    if ((stat.mode & 0o077) !== 0) throw new Error("agent conversation index permissions are too broad; expected 0600");
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("agent conversation index is not owned by the MSO user");
    const id = (await handle.readFile("utf8")).trim();
    if (!SESSION_ID.test(id)) throw new Error("agent conversation index contains an invalid session id");
    const session = await readSessionFile(id);
    if (!session || session.principalHash !== ownerHash || session.source !== "mcp" || session.conversationHash !== conversationHash) return null;
    return session;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  } finally { await handle?.close().catch(() => undefined); }
}

export async function writeConversationRef(ownerHash: string, conversationHash: string, id: string): Promise<void> {
  if (!SESSION_ID.test(id)) throw new Error("invalid agent session id");
  const file = conversationRefFile(ownerHash, conversationHash);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.chmod(CONVERSATION_ROOT, 0o700).catch(() => undefined);
  await fs.chmod(path.dirname(file), 0o700).catch(() => undefined);
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, `${id}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await fs.chmod(tmp, 0o600);
  await fs.rename(tmp, file);
  await fs.chmod(file, 0o600);
}


export async function conversationIndexReady(): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(CONVERSATION_READY, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    return stat.isFile() && (stat.mode & 0o077) === 0 &&
      (typeof process.getuid !== "function" || stat.uid === process.getuid());
  } catch {
    return false;
  } finally { await handle?.close().catch(() => undefined); }
}

async function markConversationIndexReady(): Promise<void> {
  await fs.mkdir(CONVERSATION_ROOT, { recursive: true, mode: 0o700 });
  await fs.chmod(CONVERSATION_ROOT, 0o700).catch(() => undefined);
  const tmp = `${CONVERSATION_READY}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, `${new Date().toISOString()}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await fs.chmod(tmp, 0o600);
  await fs.rename(tmp, CONVERSATION_READY);
  await fs.chmod(CONVERSATION_READY, 0o600);
}

function fileFor(id: string): string {
  if (!SESSION_ID.test(id)) throw new Error("invalid agent session id");
  const candidate = path.resolve(ROOT, `${id}.json`);
  const relative = path.relative(ROOT, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("invalid agent session id");
  return candidate;
}

export function normalizeSession(raw: AgentSession): AgentSession {
  const title = safeTitle(raw.title);
  const threshold = Number(raw.compactThresholdTokens) || compactThresholdTokens();
  const base = {
    ...raw,
    name: normalizeAgentSessionName((raw as AgentSession & { name?: string }).name) || legacyAgentSessionName(raw.id),
    title,
    titleSource: inferredTitleSource(title, raw.titleSource),
    history: Array.isArray(raw.history) ? raw.history.slice(-MAX_HISTORY) : [],
    events: Array.isArray(raw.events) ? raw.events.slice(-MAX_EVENTS) : [],
    compactThresholdTokens: threshold,
    compactionCount: Math.max(0, Number(raw.compactionCount) || 0),
    archiveCount: Math.max(0, Number(raw.archiveCount) || 0),
    lifetimeEstimatedTokens: Math.max(0, Number(raw.lifetimeEstimatedTokens) || 0),
  } as AgentSession;
  const estimatedTokens = sessionContextTokens(base);
  return { ...base, estimatedTokens, lifetimeEstimatedTokens: Math.max(base.lifetimeEstimatedTokens, estimatedTokens) };
}

export async function readSessionFile(id: string): Promise<AgentSession | null> {
  const file = fileFor(id);
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_SESSION_BYTES) throw new Error("agent session has an invalid file shape");
    if ((stat.mode & 0o077) !== 0) throw new Error("agent session permissions are too broad; expected 0600");
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("agent session is not owned by the MSO user");
    const raw = JSON.parse(await handle.readFile("utf8")) as AgentSession;
    if (!raw || raw.id !== id || !raw.principalHash || !raw.source) throw new Error("agent session has an invalid shape");
    return normalizeSession(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  } finally { await handle?.close().catch(() => undefined); }
}

export async function writeSessionFile(record: AgentSession): Promise<void> {
  await fs.mkdir(ROOT, { recursive: true, mode: 0o700 });
  await fs.chmod(ROOT, 0o700).catch(() => undefined);
  const normalized = normalizeSession(record);
  const body = JSON.stringify(normalized, null, 2);
  if (Buffer.byteLength(body, "utf8") > MAX_SESSION_BYTES) throw new Error("agent session exceeds 16 MiB before compaction");
  const file = fileFor(record.id), tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, body, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await fs.chmod(tmp, 0o600); await fs.rename(tmp, file); await fs.chmod(file, 0o600);
}

export async function listSessionRecords(): Promise<AgentSession[]> {
  let names: string[];
  try { names = await fs.readdir(ROOT); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const out: AgentSession[] = [];
  for (const name of names.slice(0, 5000)) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -5);
    if (!SESSION_ID.test(id)) continue;
    try { const row = await readSessionFile(id); if (row) out.push(row); } catch { /* isolate corrupt rows */ }
  }
  return out;
}


export async function backfillConversationIndex(): Promise<{ indexed: number; conversations: number }> {
  const rows = (await listSessionRecords())
    .filter((row) => row.source === "mcp" && HASH64.test(row.conversationHash ?? ""))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const latest = new Map<string, AgentSession>();
  for (const row of rows) {
    const key = `${row.principalHash}:${row.conversationHash}`;
    if (!latest.has(key)) latest.set(key, row);
  }
  let indexed = 0;
  for (const row of latest.values()) {
    const hash = row.conversationHash!;
    const current = await readConversationSession(row.principalHash, hash).catch(() => null);
    if (current?.id === row.id) continue;
    await writeConversationRef(row.principalHash, hash, row.id);
    indexed += 1;
  }
  await markConversationIndexReady();
  return { indexed, conversations: latest.size };
}
