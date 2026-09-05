import { randomUUID } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { getInfraProviderDefinition, normalizeInfraValues } from "./catalog";
import type { InfraProviderId, InfraProviderSummary, InfraProviderValues, InfraStore } from "./types";

export const INFRA_STORE_PATH = process.env.OS_INFRA_STORE ?? path.join(os.homedir(), ".mso", "private", "infra-providers.json");
const MAX_STORE_BYTES = 256 * 1024;

function mask(value: string): string {
  return value ? "configured" : "";
}

async function readUnlocked(): Promise<InfraStore> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(INFRA_STORE_PATH, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("infrastructure provider store must be a regular file");
    if (stat.size <= 0 || stat.size > MAX_STORE_BYTES) throw new Error("infrastructure provider store has an invalid size");
    if ((stat.mode & 0o077) !== 0) throw new Error("infrastructure provider store permissions are too broad; expected 0600");
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("infrastructure provider store is not owned by the MSO user");
    const raw = JSON.parse(await handle.readFile("utf8")) as InfraStore;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("infrastructure provider store has an invalid shape");
    return raw;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function writeUnlocked(store: InfraStore): Promise<void> {
  const dir = path.dirname(INFRA_STORE_PATH);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700).catch(() => undefined);
  const tmp = `${INFRA_STORE_PATH}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.chmod(tmp, 0o600);
  await fs.rename(tmp, INFRA_STORE_PATH);
  await fs.chmod(INFRA_STORE_PATH, 0o600);
}

export async function readInfraProvider(id: InfraProviderId): Promise<InfraProviderValues> {
  const store = await readUnlocked();
  return { ...(store.providers?.[id] ?? {}) };
}

export async function setInfraProvider(id: InfraProviderId, raw: Record<string, unknown>): Promise<InfraProviderValues> {
  return withSecurityStoreLock(INFRA_STORE_PATH, async () => {
    const store = await readUnlocked();
    const current = store.providers?.[id] ?? {};
    const normalized = normalizeInfraValues(id, raw);
    const values = { ...current, ...normalized };
    const def = getInfraProviderDefinition(id);
    const missing = def.fields.filter((field) => field.required && !values[field.key]).map((field) => field.key);
    if (id === "composio" && !values.apiKey && !values.orgApiKey) missing.push("project or organization API key");
    if (id === "convex-cloud" && !values.personalToken && !(values.deployKey && values.deploymentName)) missing.push("personal token or deployment key and name");
    if (missing.length) throw new Error(`${id} is missing required value(s): ${missing.join(", ")}`);
    await writeUnlocked({ ...store, providers: { ...(store.providers ?? {}), [id]: values } });
    return values;
  });
}

export async function removeInfraProvider(id: InfraProviderId): Promise<void> {
  await withSecurityStoreLock(INFRA_STORE_PATH, async () => {
    const store = await readUnlocked();
    const providers = { ...(store.providers ?? {}) };
    delete providers[id];
    await writeUnlocked({ ...store, providers });
  });
}

export function summarizeInfraProvider(id: InfraProviderId, values: InfraProviderValues): InfraProviderSummary {
  const def = getInfraProviderDefinition(id);
  const missing = def.fields.filter((field) => field.required && !values[field.key]).map((field) => field.key);
  if (id === "composio" && !values.apiKey && !values.orgApiKey) missing.push("project or organization API key");
    if (id === "convex-cloud" && !values.personalToken && !(values.deployKey && values.deploymentName)) missing.push("personal token or deployment key and name");
  const safeValues = Object.fromEntries(def.fields
    .filter((field) => values[field.key])
    .map((field) => [field.key, field.secret ? mask(values[field.key]) : values[field.key]]));
  return { id, title: def.title, description: def.description, feature: def.feature, configured: missing.length === 0, missing, values: safeValues, fields: def.fields };
}
