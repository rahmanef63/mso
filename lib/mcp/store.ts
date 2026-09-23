import { randomUUID } from "node:crypto";
import { sha256hex } from "./pkce";
import type { Scope } from "./scope";
import type { McpToolProfile } from "./tool-contract";
import { detectMcpToolProfile } from "./client-profile";
import {
  commitMcpStore as write,
  mutateMcpStore as mutate,
  pruneUnreferencedClients,
  readMcpStore as read,
  sweepMcpStore as sweep,
} from "./store-state";
import type { McpClient, McpCode, McpRefreshToken, McpToken } from "./store-types";

export type { McpClient, McpCode, McpRefreshToken, McpToken, TokenView } from "./store-types";

export const CODE_TTL_MS = 60_000;
export const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const OAUTH_ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export function registerClient(name: string, redirectUris: string[]): Promise<string> {
  return mutate(async () => {
    const store = sweep(await read());
    pruneUnreferencedClients(store);
    const clientId = "mcpc_" + randomUUID().replaceAll("-", "").slice(0, 24);
    const cleanName = name.slice(0, 80) || "MCP Client";
    store.clients[clientId] = {
      name: cleanName,
      redirectUris,
      profile: detectMcpToolProfile({ clientId, name: cleanName, redirectUris }),
      createdAt: Date.now(),
    };
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

/** Single-use exchange: delete the authorization code before minting anything. */
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
  accessToken: string;
  refreshToken: string;
  label: string;
  clientId: string;
  scope: Scope;
  resource: string;
  profile?: McpToolProfile;
  offlineAccess?: boolean;
  grantId: string;
}): Promise<void> {
  return mutate(async () => {
    const store = sweep(await read());
    const now = Date.now();
    store.tokens[sha256hex(input.accessToken)] = {
      label: input.label,
      clientId: input.clientId,
      scope: input.scope,
      resource: input.resource,
      profile: input.profile,
      grantId: input.grantId,
      createdAt: now,
      expiresAt: now + OAUTH_ACCESS_TOKEN_TTL_MS,
    };
    store.refreshTokens[sha256hex(input.refreshToken)] = {
      grantId: input.grantId,
      clientId: input.clientId,
      scope: input.scope,
      resource: input.resource,
      profile: input.profile,
      offlineAccess: input.offlineAccess,
      createdAt: now,
      expiresAt: now + REFRESH_TOKEN_TTL_MS,
    };
    await write(store);
  });
}

export function rotateOAuthGrant(input: {
  oldRefreshToken: string;
  accessToken: string;
  refreshToken: string;
  label: string;
  clientId: string;
  resource: string;
}): Promise<McpRefreshToken | null> {
  return mutate(async () => {
    const store = sweep(await read());
    const oldHash = sha256hex(input.oldRefreshToken);
    const rec = store.refreshTokens[oldHash];
    if (!rec || rec.revokedAt || rec.expiresAt < Date.now() || rec.clientId !== input.clientId || rec.resource !== input.resource) return null;
    delete store.refreshTokens[oldHash];
    const now = Date.now();
    store.tokens[sha256hex(input.accessToken)] = {
      label: input.label,
      clientId: rec.clientId,
      scope: rec.scope,
      resource: rec.resource,
      profile: rec.profile,
      grantId: rec.grantId,
      createdAt: now,
      expiresAt: now + OAUTH_ACCESS_TOKEN_TTL_MS,
    };
    store.refreshTokens[sha256hex(input.refreshToken)] = {
      ...rec,
      createdAt: now,
      expiresAt: now + REFRESH_TOKEN_TTL_MS,
    };
    await write(store);
    return rec;
  });
}

export async function validateToken(token: string): Promise<(McpToken & { hash: string }) | null> {
  if (!token) return null;
  const hash = sha256hex(token);
  const rec = (await read()).tokens[hash];
  if (!rec || rec.revokedAt) return null;
  if (rec.expiresAt > 0 && rec.expiresAt < Date.now()) return null;
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

export { listTokens, mintPatToken, revokeAllTokens, revokeToken } from "./store-token-admin";
