import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { snapshotAgentMemory } from "./memory-store";

import type {
  AgentSession, AgentSessionEvent, AgentSessionResumePacket, AgentSessionSource, AgentSessionSummary,
} from "./session-types";
export type { AgentSession, AgentSessionEvent, AgentSessionResumePacket, AgentSessionSource, AgentSessionSummary } from "./session-types";

const ROOT = path.resolve(process.env.OS_AGENT_SESSIONS_DIR || path.join(os.homedir(), ".mso", "agent-sessions"));
const LOCK_TARGET = path.join(ROOT, ".sessions");
const SESSION_ID = /^\d{8}_\d{6}_[a-f0-9]{8}$/;
const MAX_SESSION_BYTES = 512 * 1024;
const MAX_EVENTS = 200;
const MAX_HISTORY = 48;
const MAX_LIST = 200;

function principalHash(principal: string): string {
  if (!principal || principal.length > 512) throw new Error("invalid agent session principal");
  return createHash("sha256").update(principal).digest("hex");
}

function fileFor(id: string): string {
  if (!SESSION_ID.test(id)) throw new Error("invalid agent session id");
  const candidate = path.resolve(ROOT, `${id}.json`);
  const relative = path.relative(ROOT, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("invalid agent session id");
  return candidate;
}

function sessionId(now = new Date()): string {
  const iso = now.toISOString();
  const date = iso.slice(0, 10).replaceAll("-", "");
  const time = iso.slice(11, 19).replaceAll(":", "");
  return `${date}_${time}_${randomBytes(4).toString("hex")}`;
}

function safeTitle(value: string | undefined): string {
  const text = String(value ?? "MSO Agent session").replace(/[\r\n\t]+/g, " ").trim();
  return (text || "MSO Agent session").slice(0, 120);
}

function safeDetail(value: string | undefined): string | undefined {
  const text = String(value ?? "").replace(/[\r\n\t]+/g, " ").trim();
  return text ? text.slice(0, 500) : undefined;
}

function normalizeRecord(raw: AgentSession): AgentSession {
  return {
    ...raw,
    title: safeTitle(raw.title),
    history: Array.isArray(raw.history) ? raw.history.slice(-MAX_HISTORY) : [],
    events: Array.isArray(raw.events) ? raw.events.slice(-MAX_EVENTS) : [],
  };
}

async function readFile(id: string): Promise<AgentSession | null> {
  const file = fileFor(id);
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("agent session must be a regular file");
    if (stat.size <= 0 || stat.size > MAX_SESSION_BYTES) throw new Error("agent session has an invalid size");
    if ((stat.mode & 0o077) !== 0) throw new Error("agent session permissions are too broad; expected 0600");
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("agent session is not owned by the MSO user");
    const raw = JSON.parse(await handle.readFile("utf8")) as AgentSession;
    if (!raw || raw.id !== id || !raw.principalHash || !raw.source) throw new Error("agent session has an invalid shape");
    return normalizeRecord(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function writeFile(record: AgentSession): Promise<void> {
  await fs.mkdir(ROOT, { recursive: true, mode: 0o700 });
  await fs.chmod(ROOT, 0o700).catch(() => undefined);
  const file = fileFor(record.id);
  const normalized = normalizeRecord(record);
  const body = JSON.stringify(normalized, null, 2);
  if (Buffer.byteLength(body, "utf8") > MAX_SESSION_BYTES) throw new Error("agent session exceeds 512 KiB");
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, body, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await fs.chmod(tmp, 0o600);
  await fs.rename(tmp, file);
  await fs.chmod(file, 0o600);
}

function summary(record: AgentSession): AgentSessionSummary {
  return {
    id: record.id,
    source: record.source,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.resumedFrom ? { resumedFrom: record.resumedFrom } : {}),
    eventCount: record.events.length,
    historyTurns: record.history.length,
  };
}

async function requireOwned(principal: string, id: string): Promise<AgentSession> {
  const record = await readFile(id);
  if (!record || record.principalHash !== principalHash(principal)) throw new Error("agent session not found for this client");
  return record;
}

export async function createAgentSession(
  principal: string,
  source: AgentSessionSource,
  options: { title?: string; resumedFrom?: string } = {},
): Promise<AgentSession> {
  const id = sessionId();
  const now = new Date().toISOString();
  const memorySnapshot = await snapshotAgentMemory(principal);
  const record: AgentSession = {
    id,
    principalHash: principalHash(principal),
    source,
    title: safeTitle(options.title),
    createdAt: now,
    updatedAt: now,
    ...(options.resumedFrom ? { resumedFrom: options.resumedFrom } : {}),
    memorySnapshot,
    history: [],
    events: [{ at: now, kind: "created", detail: options.resumedFrom ? `resumed from ${options.resumedFrom}` : undefined }],
  };
  await withSecurityStoreLock(LOCK_TARGET, async () => writeFile(record));
  return record;
}

export async function getAgentSession(principal: string, id: string): Promise<AgentSession | null> {
  const record = await readFile(id);
  if (!record || record.principalHash !== principalHash(principal)) return null;
  return record;
}

export async function listAgentSessions(principal: string, limit = 30): Promise<AgentSessionSummary[]> {
  const wanted = Math.max(1, Math.min(MAX_LIST, Math.trunc(limit) || 30));
  let names: string[];
  try { names = await fs.readdir(ROOT); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const owner = principalHash(principal);
  const out: AgentSessionSummary[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -5);
    if (!SESSION_ID.test(id)) continue;
    try {
      const record = await readFile(id);
      if (record?.principalHash === owner) out.push(summary(record));
    } catch {
      // A corrupt/unowned row must never make another session visible or take the list endpoint down.
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, wanted);
}

export async function updateAgentSessionHistory(
  principal: string,
  id: string,
  history: unknown[],
  title?: string,
): Promise<AgentSession> {
  return withSecurityStoreLock(LOCK_TARGET, async () => {
    const record = await requireOwned(principal, id);
    record.history = Array.isArray(history) ? history.slice(-MAX_HISTORY) : [];
    if (title) record.title = safeTitle(title);
    record.updatedAt = new Date().toISOString();
    await writeFile(record);
    return record;
  });
}

export async function appendAgentSessionEvent(
  principal: string,
  id: string,
  event: Omit<AgentSessionEvent, "at"> & { at?: string },
): Promise<void> {
  await withSecurityStoreLock(LOCK_TARGET, async () => {
    const record = await requireOwned(principal, id);
    const row: AgentSessionEvent = {
      at: event.at ?? new Date().toISOString(),
      kind: event.kind,
      ...(event.tool ? { tool: event.tool.slice(0, 120) } : {}),
      ...(event.state ? { state: event.state.slice(0, 40) } : {}),
      ...(event.workflowId ? { workflowId: event.workflowId.slice(0, 80) } : {}),
      ...(safeDetail(event.detail) ? { detail: safeDetail(event.detail) } : {}),
    };
    record.events = [...record.events, row].slice(-MAX_EVENTS);
    record.updatedAt = row.at;
    await writeFile(record);
  });
}

export async function resumeAgentSession(
  principal: string,
  targetId: string,
  currentId?: string,
): Promise<AgentSessionResumePacket> {
  const target = await requireOwned(principal, targetId);
  if (currentId && currentId !== targetId) {
    await withSecurityStoreLock(LOCK_TARGET, async () => {
      const current = await requireOwned(principal, currentId);
      current.resumedFrom = targetId;
      current.memorySnapshot = target.memorySnapshot;
      const now = new Date().toISOString();
      const resumedEvent: AgentSessionEvent = { at: now, kind: "resumed", detail: `resumed ${targetId}` };
      current.events = [...current.events, resumedEvent].slice(-MAX_EVENTS);
      current.updatedAt = now;
      await writeFile(current);
    });
  }
  return { session: summary(target), memorySnapshot: target.memorySnapshot, recentEvents: target.events.slice(-40) };
}

export function agentSessionSummary(record: AgentSession): AgentSessionSummary {
  return summary(record);
}
