import { createHash, randomBytes } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

const VERSION = 1 as const;
const MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_TTL_MS = 15 * 60_000;
const DEFAULT_READS = 5;
const ID_RE = /^[a-f0-9]{48}$/;

type Entry = {
  version: typeof VERSION; id: string; file: string; filename: string; mimeType: string;
  ownerHash: string; sha256: string; bytes: number; createdAt: number; expiresAt: number; readsLeft: number;
};
export type McpFileResourceInfo = Omit<Entry, "ownerHash" | "file" | "version"> & { uri: string };

function rootDir(): string {
  if (process.env.VITEST) return path.join(os.tmpdir(), `mso-mcp-file-resources-${process.pid}`);
  return path.join(os.homedir(), ".mso", "mcp-file-resources");
}
const ownerHash = (principal: string, sessionId: string) => createHash("sha256").update(`${principal}\0${sessionId}`).digest("hex");
const uriOf = (id: string) => `mso-file:///${id}`;
const metaPath = (id: string) => path.join(rootDir(), `${id}.json`);
const dataPath = (id: string) => path.join(rootDir(), `${id}.bin`);

function idFromUri(uri: string): string | null {
  let parsed: URL;
  try { parsed = new URL(uri); } catch { return null; }
  if (parsed.protocol !== "mso-file:" || parsed.hostname || parsed.search || parsed.hash) return null;
  const id = parsed.pathname.replace(/^\//, "");
  return ID_RE.test(id) ? id : null;
}
function safeFilename(input: string): string {
  const value = path.basename(input || "download.bin").replace(/[\u0000-\u001f\u007f"\\/]/g, "_").slice(0, 120);
  return value || "download.bin";
}
function safeMime(input: string): string {
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(input) ? input.toLowerCase() : "application/octet-stream";
}
async function remove(id: string) {
  await Promise.all([fs.rm(metaPath(id), { force: true }), fs.rm(dataPath(id), { force: true })]);
}
async function readEntry(id: string): Promise<Entry> {
  const raw = await fs.readFile(metaPath(id), "utf8");
  const entry = JSON.parse(raw) as Entry;
  if (entry.version !== VERSION || entry.id !== id || !ID_RE.test(entry.id)) throw new Error("file resource is invalid");
  return entry;
}
async function writeEntry(entry: Entry) {
  const tmp = `${metaPath(entry.id)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(entry), { mode: 0o600, flag: "wx" });
  await fs.rename(tmp, metaPath(entry.id));
}

export async function createMcpFileResource(input: {
  data: Uint8Array | Buffer; filename: string; mimeType: string; principal: string; sessionId: string; ttlMs?: number; maxReads?: number;
}): Promise<McpFileResourceInfo> {
  if (!input.principal || !input.sessionId) throw new Error("authenticated MCP principal and session required");
  const data = Buffer.from(input.data);
  if (!data.length || data.length > MAX_BYTES) throw new Error("MCP file resource must be between 1 byte and 10 MiB");
  const ttlMs = Math.min(Math.max(input.ttlMs ?? DEFAULT_TTL_MS, 60_000), 60 * 60_000);
  const readsLeft = Math.min(Math.max(Math.round(input.maxReads ?? DEFAULT_READS), 1), 10);
  const id = randomBytes(24).toString("hex"), now = Date.now();
  const entry: Entry = {
    version: VERSION, id, file: `${id}.bin`, filename: safeFilename(input.filename), mimeType: safeMime(input.mimeType),
    ownerHash: ownerHash(input.principal, input.sessionId), sha256: createHash("sha256").update(data).digest("hex"),
    bytes: data.length, createdAt: now, expiresAt: now + ttlMs, readsLeft,
  };
  await fs.mkdir(rootDir(), { recursive: true, mode: 0o700 });
  try {
    await fs.writeFile(dataPath(id), data, { mode: 0o600, flag: "wx" });
    await writeEntry(entry);
  } catch (error) {
    await remove(id).catch(() => undefined);
    throw error;
  }
  const timer = setTimeout(() => void remove(id), ttlMs + 1_000);
  timer.unref?.();
  const { ownerHash: _owner, file: _file, version: _version, ...safe } = entry;
  return { ...safe, uri: uriOf(id) };
}

export async function readMcpFileResource(uri: string, principal?: string, sessionId?: string): Promise<({ data: Buffer } & McpFileResourceInfo) | null> {
  const id = idFromUri(uri);
  if (!id) return null;
  if (!principal || !sessionId) throw new Error("authenticated MCP principal and session required for file resource");
  let entry: Entry;
  try { entry = await readEntry(id); } catch { throw new Error("unknown or expired file resource"); }
  if (entry.ownerHash !== ownerHash(principal, sessionId)) throw new Error("unknown or expired file resource");
  if (entry.expiresAt <= Date.now() || entry.readsLeft <= 0) {
    await remove(id).catch(() => undefined);
    throw new Error("unknown or expired file resource");
  }
  let data: Buffer;
  try { data = await fs.readFile(dataPath(id)); } catch {
    await remove(id).catch(() => undefined);
    throw new Error("unknown or expired file resource");
  }
  const actual = createHash("sha256").update(data).digest("hex");
  if (data.length !== entry.bytes || actual !== entry.sha256) {
    await remove(id).catch(() => undefined);
    throw new Error("file resource integrity check failed");
  }
  entry.readsLeft -= 1;
  if (entry.readsLeft <= 0) await remove(id);
  else await writeEntry(entry);
  const { ownerHash: _owner, file: _file, version: _version, ...safe } = entry;
  return { ...safe, uri: uriOf(id), data };
}
