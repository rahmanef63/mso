import { randomUUID } from "node:crypto";
import path from "node:path";
import { realpathSync } from "node:fs";
export const SOURCES = ["direct", "composio", "native-mcp"] as const;
export type ConnectionSource = typeof SOURCES[number];
export type ConnectionSelector = { user?: string; connection?: string; cwd?: string; source?: ConnectionSource; authMethod?: string };
export type ExternalIdentity = { toolkit?: string; connectedAccountId?: string; authConfigId?: string; brokerConnection?: string; remoteUserId?: string; status?: string; checkedAt?: number };
export type IntegrationConnection = {
  id: string; uid: string; label: string; provider: string; source: ConnectionSource; authMethod: string;
  scope: string; revision: number; values: Record<string,string>; external?: ExternalIdentity;
  createdAt: number; updatedAt: number; verifiedAt?: number; lease?: {id:string;until:number};
};
export type IntegrationUser = { id: string; uid:string; label: string; connections: Record<string, Record<string, IntegrationConnection>>; defaults: Record<string, string> };
export type IntegrationBinding = { path: string; user: string; connections: Record<string, string> };
export type IntegrationState = { version: 2; instanceId:string; defaultUser: string | null; users: Record<string, IntegrationUser>; bindings: IntegrationBinding[]; migratedAt?: number };
export class IntegrationError extends Error { constructor(public readonly code: string, public readonly status = 400) { super(code); } }
export const emptyIntegrationState = (): IntegrationState => ({ version: 2, instanceId:randomUUID(), defaultUser: null, users: {}, bindings: [] });
export function identity(value: unknown, name = "identity"): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value) || ["__proto__", "constructor", "prototype"].includes(value)) throw new IntegrationError(`invalid_${name}`);
  return value;
}
export function connectionLabel(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 120 || /[\x00-\x1f\x7f]/.test(value)) throw new IntegrationError("invalid_label");
  return value.trim();
}
export function canonicalFolder(value: string): string {
  if (!path.isAbsolute(value) || value.length > 4096 || /[\x00-\x1f]/.test(value)) throw new IntegrationError("invalid_folder");
  try { return realpathSync(value); } catch { return path.resolve(value); }
}
export function folderBinding(state: IntegrationState, cwd?: string) {
  if (!cwd) return undefined;
  const p = canonicalFolder(cwd);
  return state.bindings.filter(b => p === b.path || p.startsWith(b.path.endsWith(path.sep) ? b.path : b.path + path.sep)).sort((a,b) => b.path.length-a.path.length)[0];
}
export function resolveUser(state: IntegrationState, selection: ConnectionSelector = {}): string {
  const name = selection.user ?? folderBinding(state, selection.cwd)?.user ?? state.defaultUser;
  if (!name) throw new IntegrationError("user_required", 409);
  identity(name, "user"); if (!Object.hasOwn(state.users, name)) throw new IntegrationError("user_not_found", 404);
  return name;
}
export function selectConnection(state: IntegrationState, provider: string, selection: ConnectionSelector = {}) {
  identity(provider, "provider"); const user = resolveUser(state, selection), profile = state.users[user];
  const bound = folderBinding(state, selection.cwd);
  const mapped = bound?.user === user ? bound.connections[provider] : undefined;
  const rows = profile.connections[provider] ?? {};
  const requested = selection.connection ?? mapped ?? profile.defaults[provider];
  const id = requested ?? (Object.keys(rows).length === 1 ? Object.keys(rows)[0] : undefined);
  if (!id) throw new IntegrationError(Object.keys(rows).length ? "connection_ambiguous" : "connection_not_found", Object.keys(rows).length ? 409 : 404);
  const connection = Object.hasOwn(rows, identity(id,"connection")) ? rows[id] : undefined;
  if (!connection) throw new IntegrationError("connection_not_found", 404);
  if (selection.source && selection.source !== connection.source) throw new IntegrationError("connection_source_mismatch",409);
  if (selection.authMethod && selection.authMethod !== connection.authMethod) throw new IntegrationError("connection_auth_mismatch",409);
  return { user, connection, reason: selection.connection ? "explicit" : mapped ? "folder" : profile.defaults[provider] ? "default" : "only-connection" };
}
// Safe machine operations accept metadata only. Secret form endpoints use a separate schema.
export function metadataOnly(value: unknown, depth = 0): void {
  if (depth > 12) throw new IntegrationError("metadata_too_deep");
  if (!value || typeof value !== "object") return;
  for (const [k,v] of Object.entries(value)) {
    if (/^(values?|secrets?|secretValue|password|token|apiKey|apiToken|accessToken|refreshToken|authorization|headers|__proto__|constructor|prototype)$/i.test(k)) throw new IntegrationError("secret_input_forbidden");
    metadataOnly(v,depth+1);
  }
}

export function assertNotBusy(c:IntegrationConnection){if(c.lease&&c.lease.until>Date.now())throw new IntegrationError("connection_busy",409);}
