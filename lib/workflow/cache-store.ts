import { createHash } from "node:crypto";
import path from "node:path";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { agentSessionsDir } from "@/lib/agent/session-paths";

import { readWorkflowJson, writeWorkflowFile } from "./private-file";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_VALUE_BYTES = 64 * 1024;
type CacheEntry = { key: string; value: unknown; updatedAt: string; expiresAt?: string };
type CacheFile = { version: 1; entries: Record<string, CacheEntry> };

const owner = (principal: string) => createHash("sha256").update(principal).digest("hex");
const keyId = (key: string) => createHash("sha256").update(key).digest("hex");
function target(principal: string) { return path.join(agentSessionsDir(), ".workflow-cache", `${owner(principal)}.json`); }
function normalizedKey(raw: string) { const value = raw.trim(); if (!value || value.length > 256) throw new Error("cache key must be 1-256 characters"); return value; }
function expired(entry: CacheEntry, now = Date.now()) { return Boolean(entry.expiresAt && Date.parse(entry.expiresAt) <= now); }
async function read(file: string): Promise<CacheFile> {
  try {
    const parsed = await readWorkflowJson(file, MAX_FILE_BYTES, "workflow cache store") as CacheFile;
    if (parsed.version !== 1 || !parsed.entries || typeof parsed.entries !== "object") throw new Error("invalid workflow cache store");
    return parsed;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, entries: {} }; throw error; }
}
async function write(file: string, data: CacheFile) {
  const body = JSON.stringify(data);
  if (Buffer.byteLength(body) > MAX_FILE_BYTES) throw new Error("workflow cache store exceeds 2 MiB");
  await writeWorkflowFile(file, body);
}
export async function workflowCacheGet(principal: string, rawKey: string) {
  const file = target(principal), key = normalizedKey(rawKey); return withSecurityStoreLock(file, async () => {
    const data = await read(file), id = keyId(key), entry = data.entries[id]; if (!entry || entry.key !== key) return { hit: false as const };
    if (expired(entry)) { delete data.entries[id]; await write(file, data); return { hit: false as const }; }
    return { hit: true as const, value: structuredClone(entry.value), updatedAt: entry.updatedAt, expiresAt: entry.expiresAt };
  });
}
export async function workflowCacheSet(principal: string, rawKey: string, value: unknown, ttlSeconds = 300) {
  const key = normalizedKey(rawKey), encoded = JSON.stringify(value); if (Buffer.byteLength(encoded) > MAX_VALUE_BYTES) throw new Error("workflow cache value exceeds 64 KiB");
  const file = target(principal), ttl = Math.max(0, Math.min(30 * 86400, Math.trunc(ttlSeconds) || 0)); return withSecurityStoreLock(file, async () => {
    const data = await read(file), now = new Date(), entry: CacheEntry = { key, value: structuredClone(value), updatedAt: now.toISOString(), ...(ttl ? { expiresAt: new Date(now.getTime() + ttl * 1000).toISOString() } : {}) };
    for (const [id, row] of Object.entries(data.entries)) if (expired(row)) delete data.entries[id]; data.entries[keyId(key)] = entry; await write(file, data); return { hit: true as const, ...entry };
  });
}
export async function workflowCacheDelete(principal: string, rawKey: string) {
  const file = target(principal), key = normalizedKey(rawKey); return withSecurityStoreLock(file, async () => { const data = await read(file), removed = delete data.entries[keyId(key)]; if (removed) await write(file, data); return { removed }; });
}
