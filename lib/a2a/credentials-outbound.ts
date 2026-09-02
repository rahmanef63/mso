import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import type { A2ACredentialKind, A2AOutboundCredentialSummary } from "./types";
import {
  cleanA2ACredentialId,
  cleanA2ACredentialLabel,
  readA2APrivateStore,
  writeA2APrivateStore,
} from "./credential-private-store";

const MAX_SECRET_BYTES = 16 * 1024;
const HEADER_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,80}$/;
export const A2A_CREDENTIAL_STORE_PATH =
  process.env.OS_A2A_CREDENTIAL_STORE ??
  path.join(os.homedir(), ".mso", "private", "a2a-credentials.json");

type OutboundRecord = A2AOutboundCredentialSummary & { secret: string };
type OutboundStore = { version: 1; profiles: OutboundRecord[] };

function cleanSecret(value: string): string {
  const out = String(value ?? "").trim();
  if (!out) throw new Error("A2A credential secret is required");
  if (Buffer.byteLength(out, "utf8") > MAX_SECRET_BYTES)
    throw new Error(`A2A credential secret exceeds ${MAX_SECRET_BYTES} bytes`);
  return out;
}

function cleanExpiry(value?: string): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed))
    throw new Error("A2A credential expiresAt must be ISO-8601");
  return new Date(parsed).toISOString();
}

function cleanHeader(value?: string): string | undefined {
  if (!value) return undefined;
  const header = value.trim();
  if (!HEADER_RE.test(header))
    throw new Error("A2A API-key header name is invalid");
  const lower = header.toLowerCase();
  if (
    [
      "cookie",
      "host",
      "content-length",
      "transfer-encoding",
      "connection",
    ].includes(lower)
  )
    throw new Error(`A2A API-key header ${header} is not allowed`);
  return header;
}

function cleanKind(value: string): A2ACredentialKind {
  if (value === "api-key" || value === "bearer" || value === "oauth2")
    return value;
  throw new Error("A2A credential kind must be api-key, bearer, or oauth2");
}

const isStore = (value: unknown): value is OutboundStore =>
  Boolean(
    value &&
    typeof value === "object" &&
    (value as OutboundStore).version === 1 &&
    Array.isArray((value as OutboundStore).profiles),
  );
const readStore = () =>
  readA2APrivateStore(
    A2A_CREDENTIAL_STORE_PATH,
    { version: 1, profiles: [] } as OutboundStore,
    isStore,
  );
const summary = ({ secret: _secret, ...row }: OutboundRecord) => row;

export async function listA2AOutboundCredentials(
  agentId?: string,
): Promise<A2AOutboundCredentialSummary[]> {
  const query = agentId?.trim();
  return (await readStore()).profiles
    .filter((row) => !query || row.agentId === query)
    .map(summary)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getA2AOutboundCredential(
  id: string,
): Promise<A2AOutboundCredentialSummary | null> {
  const query = cleanA2ACredentialId(id, "A2A credential id");
  const row = (await readStore()).profiles.find((entry) => entry.id === query);
  return row ? summary(row) : null;
}

export async function createA2AOutboundCredential(input: {
  agentId: string;
  label: string;
  kind: A2ACredentialKind;
  secret: string;
  schemeName?: string;
  headerName?: string;
  expiresAt?: string;
}): Promise<A2AOutboundCredentialSummary> {
  const now = new Date().toISOString();
  const kind = cleanKind(input.kind);
  const expiresAt = cleanExpiry(input.expiresAt);
  const record: OutboundRecord = {
    id: `cred_${randomUUID()}`,
    agentId: cleanA2ACredentialId(input.agentId, "A2A agent id"),
    label: cleanA2ACredentialLabel(input.label),
    kind,
    secret: cleanSecret(input.secret),
    ...(input.schemeName?.trim()
      ? { schemeName: input.schemeName.trim().slice(0, 120) }
      : {}),
    ...(kind === "api-key"
      ? { headerName: cleanHeader(input.headerName) ?? "X-API-Key" }
      : {}),
    ...(expiresAt ? { expiresAt } : {}),
    createdAt: now,
    updatedAt: now,
  };
  return withSecurityStoreLock(A2A_CREDENTIAL_STORE_PATH, async () => {
    const store = await readStore();
    if (
      store.profiles.some(
        (row) =>
          row.agentId === record.agentId &&
          row.label.toLowerCase() === record.label.toLowerCase(),
      )
    )
      throw new Error(
        `A2A credential label already exists for this peer: ${record.label}`,
      );
    store.profiles.push(record);
    await writeA2APrivateStore(A2A_CREDENTIAL_STORE_PATH, store);
    return summary(record);
  });
}

export async function removeA2AOutboundCredential(
  id: string,
): Promise<boolean> {
  const query = cleanA2ACredentialId(id, "A2A credential id");
  return withSecurityStoreLock(A2A_CREDENTIAL_STORE_PATH, async () => {
    const store = await readStore();
    const before = store.profiles.length;
    store.profiles = store.profiles.filter((row) => row.id !== query);
    if (store.profiles.length !== before)
      await writeA2APrivateStore(A2A_CREDENTIAL_STORE_PATH, store);
    return store.profiles.length !== before;
  });
}

export async function a2aCredentialHeaders(
  profileId?: string,
): Promise<Record<string, string>> {
  if (!profileId) return {};
  const query = cleanA2ACredentialId(profileId, "A2A credential id");
  const row = (await readStore()).profiles.find((entry) => entry.id === query);
  if (!row) throw new Error(`A2A credential profile not found: ${query}`);
  if (row.expiresAt && Date.parse(row.expiresAt) <= Date.now())
    throw new Error(`A2A credential profile has expired: ${row.label}`);
  return row.kind === "api-key"
    ? { [row.headerName || "X-API-Key"]: row.secret }
    : { authorization: `Bearer ${row.secret}` };
}
