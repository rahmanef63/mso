import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sha256hex } from "./pkce";
import type { Scope } from "./scope";
import type { McpToolProfile } from "./tool-contract";
import { detectMcpToolProfile } from "./client-profile";
import { withSecurityStoreLock } from "@/lib/security-store-lock";

// OAuth clients, authorization codes and bearer tokens for the MCP server.
// mso has no database, so this is the same shape lib/auth/device-store.ts uses:
// one JSON file under ~/.mso, written atomically (tmp + rename, 0600).
//
// SECRETS ARE NEVER STORED RAW. Codes and tokens live here as sha256 only; the
// raw value is returned to the client exactly once, at mint. A stolen copy of
// this file leaks WHAT was issued, not a usable credential.

export interface McpClient {
  name: string;
  redirectUris: string[];
  profile?: McpToolProfile;
  createdAt: number;
}

export interface McpCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: Scope;
  resource?: string;
  profile?: McpToolProfile;
  offlineAccess?: boolean;
  expiresAt: number;
}

export interface McpToken {
  label: string;
  clientId: string;
  scope: Scope;
  resource?: string;
  profile?: McpToolProfile;
  grantId?: string;
  createdAt: number;
  expiresAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
}

export interface McpRefreshToken {
  grantId: string; clientId: string; scope: Scope; resource: string; profile?: McpToolProfile; offlineAccess?: boolean; createdAt: number; expiresAt: number; revokedAt?: number;
}

interface Store {
  clients: Record<string, McpClient>;
  codes: Record<string, McpCode>;
  tokens: Record<string, McpToken>;
  refreshTokens: Record<string, McpRefreshToken>;
}

const STORE_PATH = process.env.OS_MCP_STORE ?? path.join(os.homedir(), ".mso", "mcp.json");

export const CODE_TTL_MS = 60_000; // RFC 6749 wants ≤10 min; the exchange is immediate
export const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // legacy/manual bearer lifetime
export const OAUTH_ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // short-lived; refresh token rotates it
export const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_CLIENTS = 64;

const empty = (): Store => ({ clients: {}, codes: {}, tokens: {}, refreshTokens: {} });

// Same rule as device-store: "no file yet" is the ONLY failure that may read as an
// empty store. A corrupt file or EACCES must throw, because read() feeds a
// read-modify-write — swallowing it would silently erase every issued token and,
// worse, keep answering requests as if nothing had been revoked.
async function read(): Promise<Store> {
  let raw: string;
  try {
    raw = await fs.readFile(STORE_PATH, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return empty();
    throw e;
  }
  const p = JSON.parse(raw) as Partial<Store>;
  return { clients: p.clients ?? {}, codes: p.codes ?? {}, tokens: p.tokens ?? {}, refreshTokens: (p as Partial<Store>).refreshTokens ?? {} };
}

async function write(store: Store): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true, mode: 0o700 });
  // Per-process temp name prevents an operator-side helper / another server process
  // from clobbering the exact temp path while this process is committing a write.
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, STORE_PATH);
}

// Every credential mutation is a read-modify-write. Atomic rename only makes ONE
// write indivisible; without serialising the whole transaction, concurrent requests
// can both read the same old state and then overwrite each other's decisions. That
// is security-significant here: a token touch must never resurrect a token that a
// concurrent revoke just killed, and an OAuth code must be consumable exactly once.
let mutationChain: Promise<unknown> = Promise.resolve();
function mutate<T>(fn: () => Promise<T>): Promise<T> {
  const locked = () => withSecurityStoreLock(STORE_PATH, fn);
  const run = mutationChain.then(locked, locked);
  mutationChain = run.then(() => undefined, () => undefined);
  return run;
}

/** Drop expired codes on every write path — they are single-use and short-lived,
 *  so without this the file grows one dead row per abandoned consent, forever. */
function sweep(store: Store): Store {
  const now = Date.now();
  for (const [k, v] of Object.entries(store.codes)) if (v.expiresAt < now) delete store.codes[k];
  for (const [k, v] of Object.entries(store.refreshTokens)) if (v.expiresAt < now || v.revokedAt) delete store.refreshTokens[k];
  return store;
}

function referencedClientIds(store: Store): Set<string> {
  const now = Date.now();
  return new Set([
    ...Object.values(store.codes).filter((row) => row.expiresAt >= now).map((row) => row.clientId),
    ...Object.values(store.tokens).filter((row) => !row.revokedAt && row.expiresAt >= now).map((row) => row.clientId),
    ...Object.values(store.refreshTokens).filter((row) => !row.revokedAt && row.expiresAt >= now).map((row) => row.clientId),
  ].filter(Boolean));
}

function pruneUnreferencedClients(store: Store): void {
  const ids = Object.keys(store.clients);
  if (ids.length < MAX_CLIENTS) return;
  const referenced = referencedClientIds(store);
  const removable = ids
    .filter((id) => !referenced.has(id))
    .sort((a, b) => store.clients[a].createdAt - store.clients[b].createdAt);
  const removeCount = Math.min(removable.length, ids.length - MAX_CLIENTS + 1);
  for (const id of removable.slice(0, removeCount)) delete store.clients[id];
}

export function registerClient(name: string, redirectUris: string[]): Promise<string> {
  return mutate(async () => {
    const store = sweep(await read());
    // RFC 7591 registration represents a client registration instance. Redirect
    // URIs are metadata, not client identity: two ChatGPT apps legitimately share
    // the same callback host and must not collapse onto one historical client_id.
    pruneUnreferencedClients(store);
    const clientId = "mcpc_" + randomUUID().replaceAll("-", "").slice(0, 24);
    const cleanName = name.slice(0, 80) || "MCP Client";
    store.clients[clientId] = { name: cleanName, redirectUris, profile: detectMcpToolProfile({ clientId, name: cleanName, redirectUris }), createdAt: Date.now() };
    await write(store);
    return clientId;
  });
}

export async function getClient(clientId: string): Promise<McpClient | null> {
  return (await read()).clients[clientId] ?? null;
}

export function storeCode(code: string, rec: McpCode): Promise<void> {
  return mutate(async () => {
    const store = sweep(await read());
    store.codes[sha256hex(code)] = rec;
    await write(store);
  });
}

/**
 * Single-use exchange. The row is DELETED before the caller mints anything, so a
 * replayed code finds nothing and gets `invalid_grant` — and the table does not
 * grow a dead "consumed" row per successful login.
 */
export function consumeCode(code: string): Promise<McpCode | null> {
  return mutate(async () => {
    const store = sweep(await read());
    const hash = sha256hex(code);
    const rec = store.codes[hash];
    if (!rec || rec.expiresAt < Date.now()) return null;
    delete store.codes[hash];
    await write(store);
    return rec;
  });
}

export function storeToken(token: string, rec: Omit<McpToken, "createdAt" | "expiresAt">): Promise<void> {
  return mutate(async () => {
    const store = sweep(await read());
    const now = Date.now();
    store.tokens[sha256hex(token)] = { ...rec, createdAt: now, expiresAt: now + TOKEN_TTL_MS };
    await write(store);
  });
}


export function storeOAuthGrant(input: {
  accessToken: string; refreshToken: string; label: string; clientId: string; scope: Scope; resource: string; profile?: McpToolProfile; offlineAccess?: boolean; grantId: string;
}): Promise<void> {
  return mutate(async () => {
    const store = sweep(await read()); const now = Date.now();
    store.tokens[sha256hex(input.accessToken)] = { label: input.label, clientId: input.clientId, scope: input.scope, resource: input.resource, profile: input.profile, grantId: input.grantId, createdAt: now, expiresAt: now + OAUTH_ACCESS_TOKEN_TTL_MS };
    store.refreshTokens[sha256hex(input.refreshToken)] = { grantId: input.grantId, clientId: input.clientId, scope: input.scope, resource: input.resource, profile: input.profile, offlineAccess: input.offlineAccess, createdAt: now, expiresAt: now + REFRESH_TOKEN_TTL_MS };
    await write(store);
  });
}

export function rotateOAuthGrant(input: { oldRefreshToken: string; accessToken: string; refreshToken: string; label: string; clientId: string; resource: string }): Promise<McpRefreshToken | null> {
  return mutate(async () => {
    const store = sweep(await read()), oldHash = sha256hex(input.oldRefreshToken), rec = store.refreshTokens[oldHash];
    if (!rec || rec.revokedAt || rec.expiresAt < Date.now() || rec.clientId !== input.clientId || rec.resource !== input.resource) return null;
    delete store.refreshTokens[oldHash];
    const now = Date.now();
    store.tokens[sha256hex(input.accessToken)] = { label: input.label, clientId: rec.clientId, scope: rec.scope, resource: rec.resource, profile: rec.profile, grantId: rec.grantId, createdAt: now, expiresAt: now + OAUTH_ACCESS_TOKEN_TTL_MS };
    store.refreshTokens[sha256hex(input.refreshToken)] = { ...rec, createdAt: now, expiresAt: now + REFRESH_TOKEN_TTL_MS };
    await write(store); return rec;
  });
}

/** Returns the live token record, or null for unknown / revoked / expired. Both
 *  revocation and expiry are re-checked on EVERY call — that is what makes the
 *  Revoke button in Settings kill an in-flight connector immediately. */
export async function validateToken(token: string): Promise<(McpToken & { hash: string }) | null> {
  if (!token) return null;
  const hash = sha256hex(token);
  const rec = (await read()).tokens[hash];
  if (!rec || rec.revokedAt) return null;
  if (rec.expiresAt < Date.now()) return null;
  return { ...rec, hash };
}

export function touchToken(hash: string): Promise<void> {
  return mutate(async () => {
    const store = await read();
    const rec = store.tokens[hash];
    if (!rec) return;
    rec.lastUsedAt = Date.now();
    await write(store);
  });
}

export interface TokenView extends McpToken {
  id: string;
  /** Resolved HERE, not in the browser: the server owns the clock, and computing
   *  it during render is an impure read the React compiler rejects anyway. */
  status: "active" | "revoked" | "expired";
}

/** For the Settings table. There is no raw token to withhold — only the sha256
 *  was ever written — so the id here is a short prefix of the hash. */
export async function listTokens(): Promise<TokenView[]> {
  const store = await read();
  const now = Date.now();
  return Object.entries(store.tokens)
    .map(([hash, t]) => ({
      ...t,
      id: hash.slice(0, 16),
      status: t.revokedAt ? ("revoked" as const) : t.expiresAt < now ? ("expired" as const) : ("active" as const),
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function revokeToken(id: string): Promise<boolean> {
  return mutate(async () => {
    const store = await read();
    const hit = Object.keys(store.tokens).find((h) => h.startsWith(id));
    if (!hit || store.tokens[hit].revokedAt) return false;
    const now = Date.now(), grantId = store.tokens[hit].grantId;
    for (const token of Object.values(store.tokens)) if (token === store.tokens[hit] || (grantId && token.grantId === grantId)) token.revokedAt = now;
    if (grantId) for (const refresh of Object.values(store.refreshTokens)) if (refresh.grantId === grantId) refresh.revokedAt = now;
    await write(store); return true;
  });
}

/** Panic button — kills every live bearer at once. */
export function revokeAllTokens(): Promise<number> {
  return mutate(async () => {
    const store = await read();
    let n = 0;
    const now = Date.now();
    for (const t of Object.values(store.tokens)) if (!t.revokedAt) { t.revokedAt = now; n++; }
    for (const t of Object.values(store.refreshTokens)) if (!t.revokedAt) t.revokedAt = now;
    if (n || Object.keys(store.refreshTokens).length) await write(store);
    return n;
  });
}
