// What an MCP bearer is allowed to do. mso is single-owner, so a token is not an
// identity — it IS the capability, and the only thing standing between a leaked
// bearer and the host is this tier.
//
// Deliberately three tiers, not one: "let ChatGPT read my VPS" and "let ChatGPT
// run shell commands as me" are wildly different bets, and a connector that only
// ever needs to read files should not hold the second one. The owner picks per
// token on the consent page.

export const SCOPES = ["read", "write", "exec"] as const;
export type Scope = (typeof SCOPES)[number];

/** Ranked: holding a tier implies every tier below it. */
const RANK: Record<Scope, number> = { read: 0, write: 1, exec: 2 };

export function parseScope(raw: string | undefined | null): Scope {
  const asked = String(raw ?? "")
    .split(/[\s,]+/)
    .filter((s): s is Scope => (SCOPES as readonly string[]).includes(s));
  if (asked.length === 0) return "read"; // unknown/absent → least privilege
  return asked.reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
}


/** OAuth scope strings are cumulative so a standards-compliant host can see that an exec token also satisfies read/write tool schemes. */
export function oauthScopeString(scope: Scope, offline = false): string {
  const values = scope === "read" ? ["read"] : scope === "write" ? ["read", "write"] : ["read", "write", "exec"];
  if (offline) values.push("offline_access");
  return values.join(" ");
}

export function allows(held: Scope, needed: Scope): boolean {
  return RANK[held] >= RANK[needed];
}

/** MCP is OFF unless the owner turns it on. An install that never sets this has
 *  no MCP surface at all — not an unauthenticated one, none. Demo mode disables
 *  login entirely, so it must never expose a host-control endpoint either. */
export function mcpEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_OS_DEMO === "1") return false;
  return process.env.OS_MCP_ENABLED === "1";
}

/** The ceiling the deployment allows, whatever a consent page asks for. The
 *  owner wants full MCP capability on a fresh install, so an absent value defaults
 *  to `exec`. Set `OS_MCP_MAX_SCOPE=read` or `write` to opt down. A malformed explicit
 *  value still fails closed to `write` rather than silently granting shell access. */
export function maxScope(): Scope {
  const raw = process.env.OS_MCP_MAX_SCOPE;
  if (!raw) return "exec";
  const s = String(raw).trim();
  return (SCOPES as readonly string[]).includes(s) ? (s as Scope) : "write";
}

export function clampScope(asked: Scope): Scope {
  const ceiling = maxScope();
  return RANK[asked] > RANK[ceiling] ? ceiling : asked;
}

/** OAuth consent starts at the deployment ceiling; the owner may select a lower tier. */
export function defaultConsentScope(ceiling: Scope): Scope {
  return ceiling;
}
