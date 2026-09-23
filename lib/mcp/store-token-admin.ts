import { randomBytes, randomUUID } from "node:crypto";
import { sha256hex } from "./pkce";
import type { Scope } from "./scope";
import { commitMcpStore as write, mutateMcpStore as mutate, readMcpStore as read, sweepMcpStore as sweep } from "./store-state";
import type { McpToken, TokenView } from "./store-types";

export async function listTokens(): Promise<TokenView[]> {
  const store = await read();
  const now = Date.now();
  return Object.entries(store.tokens)
    .map(([hash, token]) => ({
      ...token,
      id: hash.slice(0, 16),
      status: token.revokedAt
        ? ("revoked" as const)
        : token.expiresAt > 0 && token.expiresAt < now
          ? ("expired" as const)
          : ("active" as const),
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function revokeToken(id: string): Promise<boolean> {
  return mutate(async () => {
    const store = await read();
    const hit = Object.keys(store.tokens).find((hash) => hash.startsWith(id));
    if (!hit || store.tokens[hit].revokedAt) return false;
    const now = Date.now();
    const grantId = store.tokens[hit].grantId;
    for (const token of Object.values(store.tokens)) {
      if (token === store.tokens[hit] || (grantId && token.grantId === grantId)) token.revokedAt = now;
    }
    if (grantId) {
      for (const refresh of Object.values(store.refreshTokens)) {
        if (refresh.grantId === grantId) refresh.revokedAt = now;
      }
    }
    await write(store);
    return true;
  });
}

export function revokeAllTokens(): Promise<number> {
  return mutate(async () => {
    const store = await read();
    let count = 0;
    const now = Date.now();
    for (const token of Object.values(store.tokens)) {
      if (!token.revokedAt) {
        token.revokedAt = now;
        count += 1;
      }
    }
    for (const token of Object.values(store.refreshTokens)) {
      if (!token.revokedAt) token.revokedAt = now;
    }
    if (count || Object.keys(store.refreshTokens).length) await write(store);
    return count;
  });
}

export function mintPatToken(input: {
  label: string;
  scope: Scope;
  ttlDays?: number | null;
}): Promise<{ rawToken: string; tokenView: TokenView }> {
  return mutate(async () => {
    const store = sweep(await read());
    const rawToken = "mso_pat_" + randomUUID().replaceAll("-", "") + randomBytes(16).toString("hex");
    const now = Date.now();
    const ttlDays = typeof input.ttlDays === "number" && input.ttlDays > 0 ? input.ttlDays : 0;
    const expiresAt = ttlDays > 0 ? now + ttlDays * 24 * 60 * 60 * 1000 : 0;
    const label = input.label.trim().slice(0, 80) || "Personal Access Token";
    const tokenRec: McpToken = { label, clientId: "manual:pat", scope: input.scope, createdAt: now, expiresAt };
    const hash = sha256hex(rawToken);
    store.tokens[hash] = tokenRec;
    await write(store);
    return { rawToken, tokenView: { ...tokenRec, id: hash.slice(0, 16), status: "active" as const } };
  });
}
