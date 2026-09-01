import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { compactThresholdTokens, inferredTitleSource, MAX_EVENTS, MAX_HISTORY, safeTitle, sessionContextTokens } from "./session-policy";
import type { AgentSession } from "./session-types";

const ROOT = path.resolve((process.env.OS_AGENT_SESSIONS_DIR || path.join(os.homedir(), ".mso", "agent-sessions")).replace(/^~(?=$|\/)/, os.homedir()));
export const SESSION_LOCK_TARGET = path.join(ROOT, ".sessions");
export const SESSION_ID = /^\d{8}_\d{6}_[a-f0-9]{8}$/;
const MAX_SESSION_BYTES = 16 * 1024 * 1024;

export function principalHash(principal: string): string {
  if (!principal || principal.length > 512) throw new Error("invalid agent session principal");
  return createHash("sha256").update(principal).digest("hex");
}

export function newAgentSessionId(now = new Date()): string {
  const iso = now.toISOString();
  return `${iso.slice(0, 10).replaceAll("-", "")}_${iso.slice(11, 19).replaceAll(":", "")}_${randomBytes(4).toString("hex")}`;
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
