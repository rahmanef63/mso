import { expandOwnerStorePath } from "@/lib/owner-store-path.js";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import os from "node:os";
import path from "node:path";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { parseScope, type Scope } from "@/lib/capabilities/scope";
import type { A2AInboundTokenSummary } from "./types";
import {
  cleanA2ACredentialId,
  cleanA2ACredentialLabel,
  readA2APrivateStore,
  writeA2APrivateStore,
} from "./credential-private-store";

export const A2A_INBOUND_TOKEN_STORE_PATH =
  expandOwnerStorePath(process.env.OS_A2A_INBOUND_TOKEN_STORE ??
  path.join(os.homedir(), ".mso", "private", "a2a-inbound-tokens.json"));
type InboundRecord = A2AInboundTokenSummary & { secretHash: string };
type InboundStore = { version: 1; tokens: InboundRecord[] };
const isStore = (value: unknown): value is InboundStore =>
  Boolean(
    value &&
    typeof value === "object" &&
    (value as InboundStore).version === 1 &&
    Array.isArray((value as InboundStore).tokens),
  );
const readStore = () =>
  readA2APrivateStore(
    A2A_INBOUND_TOKEN_STORE_PATH,
    { version: 1, tokens: [] } as InboundStore,
    isStore,
  );
const summary = ({ secretHash: _secretHash, ...row }: InboundRecord) => row;
const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest();

export async function listA2AInboundTokens(): Promise<
  A2AInboundTokenSummary[]
> {
  return (await readStore()).tokens
    .map(summary)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createA2AInboundToken(
  label: string,
  scope: Scope | string = "read",
): Promise<{ token: string; profile: A2AInboundTokenSummary }> {
  const now = new Date().toISOString();
  const token = `mso_a2a_${randomBytes(32).toString("base64url")}`;
  const record: InboundRecord = {
    id: `in_${randomUUID()}`,
    label: cleanA2ACredentialLabel(label),
    scope: parseScope(String(scope)),
    secretHash: tokenHash(token).toString("hex"),
    createdAt: now,
    updatedAt: now,
  };
  const profile = await withSecurityStoreLock(
    A2A_INBOUND_TOKEN_STORE_PATH,
    async () => {
      const store = await readStore();
      if (
        store.tokens.some(
          (row) => row.label.toLowerCase() === record.label.toLowerCase(),
        )
      )
        throw new Error(
          `A2A inbound token label already exists: ${record.label}`,
        );
      store.tokens.push(record);
      await writeA2APrivateStore(A2A_INBOUND_TOKEN_STORE_PATH, store);
      return summary(record);
    },
  );
  return { token, profile };
}

export async function removeA2AInboundToken(id: string): Promise<boolean> {
  const query = cleanA2ACredentialId(id, "A2A inbound token id");
  return withSecurityStoreLock(A2A_INBOUND_TOKEN_STORE_PATH, async () => {
    const store = await readStore();
    const before = store.tokens.length;
    store.tokens = store.tokens.filter((row) => row.id !== query);
    if (store.tokens.length !== before)
      await writeA2APrivateStore(A2A_INBOUND_TOKEN_STORE_PATH, store);
    return store.tokens.length !== before;
  });
}

export async function authenticateA2AInboundToken(
  raw: string,
): Promise<A2AInboundTokenSummary | null> {
  const token = String(raw || "").trim();
  if (!token.startsWith("mso_a2a_") || token.length > 256) return null;
  const candidate = tokenHash(token);
  for (const row of (await readStore()).tokens) {
    let stored: Buffer;
    try {
      stored = Buffer.from(row.secretHash, "hex");
    } catch {
      continue;
    }
    if (
      stored.length === candidate.length &&
      timingSafeEqual(stored, candidate)
    )
      return summary(row);
  }
  return null;
}
