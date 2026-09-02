import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { discoverA2AAgent } from "./client";
import { getA2AOutboundCredential } from "./credentials";
import type { A2ADiscoveredAgent, A2ARegisteredAgent } from "./types";

export const A2A_STORE_PATH =
  process.env.OS_A2A_STORE ??
  path.join(os.homedir(), ".mso", "private", "a2a-agents.json");
const MAX_STORE_BYTES = 1024 * 1024;
type A2AStore = { version: 1; agents: A2ARegisteredAgent[] };

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "agent"
  );
}
function idFor(cardUrl: string): string {
  return createHash("sha256").update(cardUrl).digest("hex").slice(0, 16);
}
function validAlias(value: string): string {
  const alias = String(value || "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(alias))
    throw new Error(
      "A2A alias must be 1-64 lowercase letters, digits, dot, underscore, or dash",
    );
  return alias;
}

async function readUnlocked(): Promise<A2AStore> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(
      A2A_STORE_PATH,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_STORE_BYTES)
      throw new Error("A2A registry has an invalid file shape");
    if ((stat.mode & 0o077) !== 0)
      throw new Error("A2A registry permissions are too broad; expected 0600");
    if (typeof process.getuid === "function" && stat.uid !== process.getuid())
      throw new Error("A2A registry is not owned by the MSO user");
    const data = JSON.parse(await handle.readFile("utf8")) as A2AStore;
    if (data?.version !== 1 || !Array.isArray(data.agents))
      throw new Error("A2A registry has an invalid shape");
    return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { version: 1, agents: [] };
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function writeUnlocked(store: A2AStore): Promise<void> {
  const body = JSON.stringify(store, null, 2);
  if (Buffer.byteLength(body, "utf8") > MAX_STORE_BYTES)
    throw new Error("A2A registry exceeds 1 MiB");
  const dir = path.dirname(A2A_STORE_PATH);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700).catch(() => undefined);
  const tmp = `${A2A_STORE_PATH}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, body, { encoding: "utf8", mode: 0o600 });
  await fs.chmod(tmp, 0o600);
  await fs.rename(tmp, A2A_STORE_PATH);
  await fs.chmod(A2A_STORE_PATH, 0o600);
}

export async function listA2AAgents(): Promise<A2ARegisteredAgent[]> {
  return (await readUnlocked()).agents
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function registerA2AAgent(
  source: string,
  requestedAlias?: string,
): Promise<A2ARegisteredAgent> {
  const discovered = await discoverA2AAgent(source);
  const now = new Date().toISOString();
  const id = idFor(discovered.cardUrl);
  return withSecurityStoreLock(A2A_STORE_PATH, async () => {
    const store = await readUnlocked();
    const existing = store.agents.find((row) => row.id === id);
    const alias = validAlias(
      requestedAlias || existing?.alias || slug(discovered.card.name),
    );
    const collision = store.agents.find(
      (row) => row.alias === alias && row.id !== id,
    );
    if (collision)
      throw new Error(
        `A2A alias ${alias} is already used by ${collision.card.name}`,
      );
    const record: A2ARegisteredAgent = {
      id,
      alias,
      cardUrl: discovered.cardUrl,
      card: discovered.card,
      ...(existing?.credentialProfileId
        ? { credentialProfileId: existing.credentialProfileId }
        : {}),
      registeredAt: existing?.registeredAt || now,
      updatedAt: now,
    };
    store.agents = [...store.agents.filter((row) => row.id !== id), record];
    await writeUnlocked(store);
    return record;
  });
}

export async function removeA2AAgent(ref: string): Promise<boolean> {
  return withSecurityStoreLock(A2A_STORE_PATH, async () => {
    const store = await readUnlocked();
    const q = String(ref || "")
      .trim()
      .toLowerCase();
    const before = store.agents.length;
    store.agents = store.agents.filter(
      (row) => row.id.toLowerCase() !== q && row.alias.toLowerCase() !== q,
    );
    if (store.agents.length !== before) await writeUnlocked(store);
    return store.agents.length !== before;
  });
}

export async function setA2AAgentCredential(
  ref: string,
  credentialProfileId?: string,
): Promise<A2ARegisteredAgent> {
  return withSecurityStoreLock(A2A_STORE_PATH, async () => {
    const store = await readUnlocked();
    const q = String(ref || "")
      .trim()
      .toLowerCase();
    const matches = store.agents.filter(
      (row) =>
        row.id.toLowerCase() === q ||
        row.alias.toLowerCase() === q ||
        row.card.name.toLowerCase() === q,
    );
    if (!matches.length) throw new Error(`A2A agent not found: ${ref}`);
    if (matches.length > 1)
      throw new Error(
        `A2A target is ambiguous: ${matches.map((row) => row.alias).join(", ")}`,
      );
    const target = matches[0];
    if (credentialProfileId) {
      const credential = await getA2AOutboundCredential(credentialProfileId);
      if (!credential)
        throw new Error(
          `A2A credential profile not found: ${credentialProfileId}`,
        );
      if (credential.agentId !== target.id)
        throw new Error("A2A credential profile belongs to a different peer");
      target.credentialProfileId = credential.id;
    } else delete target.credentialProfileId;
    target.updatedAt = new Date().toISOString();
    await writeUnlocked(store);
    return target;
  });
}

export async function resolveA2AAgent(
  ref: string,
): Promise<A2ADiscoveredAgent> {
  const raw = String(ref || "").trim();
  if (!raw) throw new Error("A2A target is required");
  if (/^https?:\/\//i.test(raw)) return discoverA2AAgent(raw);
  const q = raw.toLowerCase();
  const agents = await listA2AAgents();
  const exact = agents.filter(
    (row) =>
      row.id.toLowerCase() === q ||
      row.alias.toLowerCase() === q ||
      row.card.name.toLowerCase() === q,
  );
  if (!exact.length)
    throw new Error(
      `A2A agent not found: ${raw}; register it first or pass a public Agent Card URL`,
    );
  if (exact.length > 1)
    throw new Error(
      `A2A target is ambiguous: ${exact.map((row) => row.alias).join(", ")}`,
    );
  const discovered = await discoverA2AAgent(exact[0].cardUrl);
  return {
    ...discovered,
    ...(exact[0].credentialProfileId
      ? { credentialProfileId: exact[0].credentialProfileId }
      : {}),
  };
}
