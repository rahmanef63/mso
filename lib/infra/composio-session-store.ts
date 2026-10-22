import { constants, promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pinSecurityStorePath } from "@/lib/security-store-path";
import { normalizeMcpEndpoint } from "./mcp-policy";
import { obj } from "./http";
import { INFRA_STORE_PATH } from "./connection-storage";
import { IntegrationError } from "./identity";
import { COMPOSIO_MCP_HOSTS, headerMap, type ComposioSession } from "./composio-session-contract";

const MAX_STORE_BYTES = 256 * 1024;
const KEY_PART = /^[A-Za-z0-9:_.-]{1,200}$/;

export type StoredSession = ComposioSession & { instanceId: string; userUid: string; createdAt: number };
export type Store = { version: 1; sessions: Record<string, StoredSession> };

/** Owner-only, beside `infra-providers.json`: 0700 parent, 0600 file, O_NOFOLLOW, uid-checked. */
export const composioSessionStorePath = () => path.join(path.dirname(INFRA_STORE_PATH), "composio-sessions.json");

function parseStore(value: unknown): Store {
  const raw = obj(value);
  const bad = (): never => { throw new IntegrationError("invalid_composio_session_store"); };
  if (raw.version !== 1 || !raw.sessions || typeof raw.sessions !== "object" || Array.isArray(raw.sessions)) bad();
  const sessions: Record<string, StoredSession> = {};
  for (const [key, entry] of Object.entries(raw.sessions as Record<string, unknown>)) {
    const row = obj(entry);
    const keyParts = key.split(":");
    if (keyParts.length !== 2 || keyParts.some((part) => !KEY_PART.test(part))) bad();
    const { sessionId, instanceId, userUid, createdAt, expiresAt, mcpUrl: rawUrl } = row;
    const id = typeof sessionId === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(sessionId) ? sessionId : bad();
    const instance = typeof instanceId === "string" ? instanceId : bad();
    const uid = typeof userUid === "string" ? userUid : bad();
    const created = Number.isSafeInteger(createdAt) ? createdAt as number : bad();
    let mcpUrl: string;
    try {
      mcpUrl = normalizeMcpEndpoint(String(rawUrl ?? ""));
      if (!COMPOSIO_MCP_HOSTS.includes(new URL(mcpUrl).hostname)) return bad();
    } catch { return bad(); }
    sessions[key] = {
      sessionId: id, mcpUrl, mcpHeaders: headerMap(row.mcpHeaders),
      instanceId: instance, userUid: uid, createdAt: created,
      ...(Number.isFinite(expiresAt) ? { expiresAt: Number(expiresAt) } : {}),
    };
  }
  return { version: 1, sessions };
}

export async function readComposioSessions(): Promise<Store> {
  const pinned = await pinSecurityStorePath(composioSessionStorePath());
  let handle;
  try {
    handle = await fs.open(pinned.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_STORE_BYTES || (stat.mode & 0o077) || stat.uid !== process.getuid?.()) throw new IntegrationError("unsafe_composio_session_store");
    return parseStore(JSON.parse(await handle.readFile("utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, sessions: {} };
    if (error instanceof IntegrationError) throw error;
    throw new IntegrationError("invalid_composio_session_store");
  } finally { await handle?.close(); await pinned.directory.close(); }
}

export async function writeComposioSessions(store: Store): Promise<void> {
  const pinned = await pinSecurityStorePath(composioSessionStorePath());
  const text = JSON.stringify(parseStore(store), null, 2) + "\n";
  try {
    if (Buffer.byteLength(text) > MAX_STORE_BYTES) throw new IntegrationError("composio_session_store_capacity", 409);
    const temporary = `${pinned.file}.${randomUUID()}.tmp`;
    try {
      const handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temporary, pinned.file);
    } finally { await fs.unlink(temporary).catch(() => undefined); }
    await pinned.directory.sync();
  } finally { await pinned.directory.close(); }
}

export const storeKey = (instanceId: string, userUid: string) => {
  if (!KEY_PART.test(instanceId) || !KEY_PART.test(userUid) || instanceId.includes(":") || userUid.includes(":")) throw new IntegrationError("invalid_composio_session_key");
  return `${instanceId}:${userUid}`;
};

/** Never returns another MSO user's session: the key is (instance, credential-owner uid). */
export async function readComposioSession(instanceId: string, userUid: string): Promise<StoredSession | null> {
  const key = storeKey(instanceId, userUid);
  const row = (await readComposioSessions()).sessions[key];
  if (!row || row.instanceId !== instanceId || row.userUid !== userUid) return null;
  if (row.expiresAt !== undefined && row.expiresAt <= Date.now()) return null;
  return row;
}

export function composioRemoteUserId(instanceId: string, userUid: string): string {
  storeKey(instanceId, userUid);
  return `mso:${instanceId}:${userUid}`;
}
