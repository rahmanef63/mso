import { TenantDenied } from "@/lib/tenancy/authority";
import { tenantCredentialFields } from "@/lib/tenancy/credentials";
import { authorizeMcpTenantGrant } from "@/lib/tenancy/runtime";
import type { TenantCredentialBinding } from "@/lib/tenancy/types";
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
export class OAuthRefreshRateLimit extends Error {}

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
  const clients = (await read()).clients;
  return Object.hasOwn(clients, clientId) ? clients[clientId] : null;
}

export function storeCode(code: string, rec: McpCode): Promise<void> {
  const captured = structuredClone(rec), tenant = tenantCredentialFields(captured);
  return mutate(async () => {
    const store = sweep(await read());
    store.codes[sha256hex(code)] = { ...captured, ...tenant };
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
    try { await authorizeMcpTenantGrant(rec); } catch (error) { if (error instanceof TenantDenied) return null; throw error; }
    delete store.codes[hash];
    await write(store);
    return rec;
  });
}

export function storeToken(token: string, rec: Omit<McpToken, "createdAt" | "expiresAt">): Promise<void> {
  const captured = structuredClone(rec), tenant = tenantCredentialFields(captured);
  return mutate(async () => {
    const store = sweep(await read());
    const now = Date.now();
    store.tokens[sha256hex(token)] = { ...captured, ...tenant, createdAt: now, expiresAt: now + TOKEN_TTL_MS };
    await write(store);
  });
}

export function storeOAuthGrant(input: {
  tenantBinding?: Readonly<TenantCredentialBinding>;
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
  const captured = structuredClone(input), tenant = tenantCredentialFields(captured);
  return mutate(async () => {
    const store = sweep(await read());
    const now = Date.now();
    await authorizeMcpTenantGrant({ ...captured, ...tenant, expiresAt: now + OAUTH_ACCESS_TOKEN_TTL_MS });
    store.tokens[sha256hex(captured.accessToken)] = {
      ...tenant,
      label: captured.label,
      clientId: captured.clientId,
      scope: captured.scope,
      resource: captured.resource,
      profile: captured.profile,
      grantId: captured.grantId,
      createdAt: now,
      expiresAt: now + OAUTH_ACCESS_TOKEN_TTL_MS,
    };
    store.refreshTokens[sha256hex(captured.refreshToken)] = {
      ...tenant,
      grantId: captured.grantId,
      clientId: captured.clientId,
      scope: captured.scope,
      resource: captured.resource,
      profile: captured.profile,
      offlineAccess: captured.offlineAccess,
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
  const captured = structuredClone(input);
  return mutate(async () => {
    const store = sweep(await read());
    const oldHash = sha256hex(captured.oldRefreshToken);
    const spent = store.spentRefreshTokens[oldHash];
    if (spent) {
      if (spent.clientId !== captured.clientId || spent.resource !== captured.resource) return null;
      const now = Date.now();
      for (const token of Object.values(store.tokens)) {
        if (token.grantId === spent.grantId && !token.revokedAt) token.revokedAt = now;
      }
      for (const refresh of Object.values(store.refreshTokens)) {
        if (refresh.grantId === spent.grantId && !refresh.revokedAt) refresh.revokedAt = now;
      }
      await write(store);
      return null;
    }
    const rec = store.refreshTokens[oldHash];
    if (!rec || rec.revokedAt || rec.expiresAt < Date.now() || rec.clientId !== captured.clientId || rec.resource !== captured.resource) return null;
    try { await authorizeMcpTenantGrant(rec); } catch (error) { if (error instanceof TenantDenied) return null; throw error; }
    const now = Date.now();
    if (rec.lastRotatedAt !== undefined && now - rec.lastRotatedAt < 30_000) throw new OAuthRefreshRateLimit("refresh grant rate limited");
    const tenant = tenantCredentialFields(rec);
    delete store.refreshTokens[oldHash];
    store.spentRefreshTokens[oldHash] = {
      grantId: rec.grantId,
      clientId: rec.clientId,
      resource: rec.resource,
      expiresAt: rec.expiresAt,
    };
    store.tokens[sha256hex(captured.accessToken)] = {
      ...tenant,
      label: captured.label,
      clientId: rec.clientId,
      scope: rec.scope,
      resource: rec.resource,
      profile: rec.profile,
      grantId: rec.grantId,
      createdAt: now,
      expiresAt: now + OAUTH_ACCESS_TOKEN_TTL_MS,
    };
    store.refreshTokens[sha256hex(captured.refreshToken)] = {
      ...rec, ...tenant,
      createdAt: now,
      lastRotatedAt: now,
      expiresAt: rec.expiresAt,
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
  try { return { ...rec, ...tenantCredentialFields(rec), hash }; } catch { return null; }
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
