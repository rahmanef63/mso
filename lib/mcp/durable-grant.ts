import { createHash } from "node:crypto";
import type { AuthorizationGrant } from "@/lib/capabilities/authorization-grant";
import { deviceSessionValid } from "@/lib/auth/live-session";
import { currentSessionPolicy, getApprovedDevice } from "@/lib/auth/device-store";
import { configuredSessionCookieScope } from "@/lib/auth/session-cookie";
import { maxScope } from "./scope";
import { readMcpStore } from "./store-state";
import type { McpToken } from "./store-types";
import { toolAllowedForProfile } from "./tool-contract";

function fingerprint(token: McpToken): string {
  const { lastUsedAt: _used, revokedAt: _revoked, ...authority } = token;
  return createHash("sha256").update(JSON.stringify(authority)).digest("hex");
}

export function mcpAuthorizationGrant(token: McpToken & { hash: string }, resource: string): AuthorizationGrant {
  const { hash, ...authority } = token;
  return { kind: "mcp", id: hash, resource, fingerprint: fingerprint(authority) };
}

export async function authorizeDurableGrant(grant: AuthorizationGrant, principal: string, name?: string, args: Record<string, unknown> = {}): Promise<boolean> {
  if (!grant || typeof grant !== "object" || maxScope() !== "exec") return false;
  if (grant.kind === "device") {
    const session = grant.session;
    if (!session.device_id || !["cli:", "web:"].some((prefix) => principal === prefix + session.device_id)) return false;
    const [device, policy] = await Promise.all([getApprovedDevice(session.device_id), currentSessionPolicy(configuredSessionCookieScope())]);
    return deviceSessionValid(session, device) && device.role === "owner" && session.cookie_scope === policy.scope && session.cookie_epoch === policy.epoch;
  }
  if (grant.kind !== "mcp" || !/^[a-f0-9]{64}$/.test(grant.id)) return false;
  const store = await readMcpStore(), token = store.tokens[grant.id];
  if (!token || token.revokedAt || token.scope !== "exec" || token.tenantBinding || token.tenantSubject ||
      token.expiresAt > 0 && token.expiresAt <= Date.now() || token.resource && token.resource !== grant.resource ||
      fingerprint(token) !== grant.fingerprint || principal !== (token.clientId ? `mcp-client:${token.clientId}` : `mcp-token:${grant.id}`)) return false;
  if (!name) return true;
  if (!toolAllowedForProfile(name, token.profile ?? store.clients[token.clientId]?.profile ?? "full") || token.allowedTools && !token.allowedTools.includes(name)) return false;
  return Object.entries(token.toolArgumentConstraints?.[name] ?? {}).every(([key, allowed]) => typeof args[key] === "string" && allowed.includes(args[key] as string));
}
