import { expandOwnerStorePath } from "@/lib/owner-store-path.js";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { constants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { McpStore } from "./store-types";

const STORE_PATH = expandOwnerStorePath(process.env.OS_MCP_STORE ?? path.join(os.homedir(), ".mso", "mcp.json"));
const MAX_CLIENTS = 64;
const MAX_STORE_BYTES = 4 * 1024 * 1024;
const empty = (): McpStore => ({ clients: {}, codes: {}, tokens: {}, refreshTokens: {}, spentRefreshTokens: {} });

export async function readMcpStore(): Promise<McpStore> {
  let raw: string;
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(STORE_PATH, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_STORE_BYTES) throw new Error("MCP credential store size limit reached");
    const bytes = Buffer.alloc(before.size + 1);
    let used = 0;
    while (used < bytes.length) {
      const { bytesRead } = await handle.read(bytes, used, bytes.length - used, used);
      if (!bytesRead) break;
      used += bytesRead;
    }
    const after = await handle.stat();
    if (used !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error("MCP credential store changed while reading");
    raw = bytes.subarray(0, used).toString("utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty();
    throw error;
  } finally { await handle?.close(); }
  const parsed = JSON.parse(raw) as Partial<McpStore>;
  return {
    clients: parsed.clients ?? {},
    codes: parsed.codes ?? {},
    tokens: parsed.tokens ?? {},
    refreshTokens: parsed.refreshTokens ?? {},
    spentRefreshTokens: parsed.spentRefreshTokens ?? {},
  };
}

async function writeMcpStore(store: McpStore): Promise<void> {
  sweepMcpStore(store);
  const limits = { clients: MAX_CLIENTS, codes: 256, tokens: 2048, refreshTokens: 256, spentRefreshTokens: 4096 };
  for (const [key, limit] of Object.entries(limits)) if (Object.keys(store[key as keyof McpStore]).length > limit) throw new Error("MCP credential store capacity reached");
  for (const clientId of new Set(Object.values(store.tokens).map((token) => token.clientId))) {
    if (Object.values(store.tokens).filter((token) => token.clientId === clientId).length > 256 || Object.values(store.refreshTokens).filter((token) => token.clientId === clientId).length > 16) throw new Error("MCP client credential capacity reached");
  }
  const serialized = JSON.stringify(store, null, 2);
  if (Buffer.byteLength(serialized) > MAX_STORE_BYTES) throw new Error("MCP credential store size limit reached");
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true, mode: 0o700 });
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, serialized, { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, STORE_PATH);
}

let mutationChain: Promise<unknown> = Promise.resolve();

export function mutateMcpStore<T>(fn: () => Promise<T>): Promise<T> {
  const locked = () => withSecurityStoreLock(STORE_PATH, fn);
  const run = mutationChain.then(locked, locked);
  mutationChain = run.then(() => undefined, () => undefined);
  return run;
}

export function sweepMcpStore(store: McpStore): McpStore {
  const now = Date.now();
  for (const [key, value] of Object.entries(store.codes)) {
    if (value.expiresAt < now) delete store.codes[key];
  }
  for (const [key, value] of Object.entries(store.tokens)) {
    if (value.expiresAt > 0 && value.expiresAt < now) delete store.tokens[key];
  }
  const revoked = Object.entries(store.tokens).filter(([, token]) => token.revokedAt).sort((a, b) => (b[1].revokedAt ?? 0) - (a[1].revokedAt ?? 0));
  for (const [key] of revoked.slice(256)) delete store.tokens[key];
  for (const [key, value] of Object.entries(store.refreshTokens)) {
    if (value.expiresAt < now || value.revokedAt) delete store.refreshTokens[key];
  }
  for (const [key, value] of Object.entries(store.spentRefreshTokens)) {
    if (value.expiresAt < now) delete store.spentRefreshTokens[key];
  }
  // Recent replay detection is retained; older hashes still cannot mint tokens.
  const families = new Map<string, string[]>();
  for (const [key, token] of Object.entries(store.spentRefreshTokens)) {
    const keys = families.get(token.grantId) ?? []; keys.push(key); families.set(token.grantId, keys);
    if (keys.length > 256) delete store.spentRefreshTokens[keys.shift()!];
  }
  return store;
}

function referencedClientIds(store: McpStore): Set<string> {
  const now = Date.now();
  return new Set([
    ...Object.values(store.codes).filter((row) => row.expiresAt >= now).map((row) => row.clientId),
    ...Object.values(store.tokens).filter((row) => !row.revokedAt && (row.expiresAt === 0 || row.expiresAt >= now)).map((row) => row.clientId),
    ...Object.values(store.refreshTokens).filter((row) => !row.revokedAt && (row.expiresAt === 0 || row.expiresAt >= now)).map((row) => row.clientId),
  ].filter(Boolean));
}

export function pruneUnreferencedClients(store: McpStore): void {
  const ids = Object.keys(store.clients);
  if (ids.length < MAX_CLIENTS) return;
  const referenced = referencedClientIds(store);
  const removable = ids
    .filter((id) => !referenced.has(id))
    .sort((a, b) => store.clients[a].createdAt - store.clients[b].createdAt);
  const removeCount = Math.min(removable.length, ids.length - MAX_CLIENTS + 1);
  for (const id of removable.slice(0, removeCount)) delete store.clients[id];
}

export async function commitMcpStore(store: McpStore): Promise<void> {
  await writeMcpStore(store);
}
