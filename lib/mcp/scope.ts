// MCP-specific policy layered on the transport-neutral capability scope.
export { SCOPES, allows, parseScope, type Scope } from "@/lib/capabilities/scope";
import { SCOPES, scopeRank, type Scope } from "@/lib/capabilities/scope";

/** OAuth scope strings are cumulative so a standards-compliant host can see that an exec token also satisfies read/write tool schemes. */
export function oauthScopeString(scope: Scope, offline = false): string {
  const values = scope === "read" ? ["read"] : scope === "write" ? ["read", "write"] : ["read", "write", "exec"];
  if (offline) values.push("offline_access");
  return values.join(" ");
}

export function mcpEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_OS_DEMO === "1") return false;
  return process.env.OS_MCP_ENABLED === "1";
}

export function maxScope(): Scope {
  const raw = process.env.OS_MCP_MAX_SCOPE;
  if (!raw) return "exec";
  const s = String(raw).trim();
  return (SCOPES as readonly string[]).includes(s) ? (s as Scope) : "write";
}

export function clampScope(asked: Scope): Scope {
  const ceiling = maxScope();
  return scopeRank(asked) > scopeRank(ceiling) ? ceiling : asked;
}

export function defaultConsentScope(ceiling: Scope): Scope { return ceiling; }
