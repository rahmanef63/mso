/** Transport-neutral authority tiers shared by MCP, A2A and internal agent delegation. */
export const SCOPES = ["read", "write", "exec"] as const;
export type Scope = (typeof SCOPES)[number];

const RANK: Record<Scope, number> = { read: 0, write: 1, exec: 2 };

export function scopeRank(scope: Scope): number { return RANK[scope]; }

export function parseScope(raw: string | undefined | null): Scope {
  const asked = String(raw ?? "")
    .split(/[\s,]+/)
    .filter((value): value is Scope => (SCOPES as readonly string[]).includes(value));
  if (asked.length === 0) return "read";
  return asked.reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
}

export function allows(held: Scope, needed: Scope): boolean {
  return RANK[held] >= RANK[needed];
}
