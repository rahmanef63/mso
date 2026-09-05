import { expandOwnerStorePath } from "@/lib/owner-store-path.js";
import { randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pinSecurityStorePath } from "@/lib/security-store-path";
import { withSecurityStoreLock } from "@/lib/security-store-lock";

// Owner-authenticated facts, persisted as bounded JSON data, never executable source.
export interface Memory { id: string; text: string; createdAt: number; }
const FILE = expandOwnerStorePath(process.env.OS_MEMORY_STORE || path.join(os.homedir(), ".mso", "memory.json"));
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_RECORDS = 1000;

function records(value: unknown): Memory[] {
  if (!Array.isArray(value) || value.length > MAX_RECORDS) throw new Error("Invalid or oversized memory store");
  return value.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)
      || typeof row.id !== "string" || !/^mem_[a-zA-Z0-9_-]{1,80}$/.test(row.id)
      || typeof row.text !== "string" || row.text.length > 500
      || !Number.isSafeInteger(row.createdAt) || row.createdAt < 0) throw new Error("Invalid memory record");
    // Deliberate projection: persisted objects cannot inject additional fields.
    return { id: row.id, text: row.text, createdAt: row.createdAt };
  });
}

async function read(): Promise<Memory[]> {
  const pinned = await pinSecurityStorePath(FILE);
  let handle;
  try {
    handle = await fs.open(pinned.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.uid !== process.getuid?.() || stat.nlink !== 1 || (stat.mode & 0o077) || stat.size > MAX_BYTES) throw new Error("Unsafe memory store");
    const bytes = Buffer.alloc(Number(stat.size));
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!read.bytesRead) throw new Error("Memory store changed during read");
      offset += read.bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error("Memory store changed during read");
    return records(JSON.parse(bytes.toString("utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error; // Never overwrite corrupt/unreadable existing state with an empty list.
  } finally { await handle?.close(); await pinned.directory.close(); }
}

async function write(list: Memory[]): Promise<void> {
  const body = JSON.stringify(records(list), null, 2) + "\n";
  if (Buffer.byteLength(body) > MAX_BYTES) throw new Error("Memory store exceeds its byte limit");
  const pinned = await pinSecurityStorePath(FILE);
  const temporary = `${pinned.file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(body, "utf8"); await handle.sync(); }
    finally { await handle.close(); }
    await fs.rename(temporary, pinned.file);
  } finally {
    await fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
    await pinned.directory.close();
  }
}

export async function listMemories(): Promise<Memory[]> { return (await read()).sort((a, b) => b.createdAt - a.createdAt); }

export async function addMemory(text: string): Promise<Memory> {
  if (typeof text !== "string") throw new Error("Memory text must be a string");
  const clean = text.trim().slice(0, 500);
  if (!clean || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(clean)) throw new Error("Memory text is empty or contains control characters");
  const memory: Memory = { id: `mem_${randomUUID()}`, text: clean, createdAt: Date.now() };
  return withSecurityStoreLock(FILE, async () => {
    const list = await read();
    if (list.length >= MAX_RECORDS) throw new Error("Memory store is full; remove an old record first");
    await write([...list, memory]);
    return memory;
  });
}

export async function removeMemory(id: string): Promise<void> {
  await withSecurityStoreLock(FILE, async () => { await write((await read()).filter((memory) => memory.id !== id)); });
}

// Bounded substring recall, not a claim of semantic retrieval or trusted instructions.
export async function recall(query: string, limit = 8): Promise<Memory[]> {
  const all = await read(), count = Math.max(1, Math.min(100, Math.floor(limit) || 8));
  const words = query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  if (!words.length) return all.slice(-count);
  return all.map((memory) => ({ memory, hits: words.filter((word) => memory.text.toLowerCase().includes(word)).length }))
    .filter((row) => row.hits > 0).sort((a, b) => b.hits - a.hits).slice(0, count).map((row) => row.memory);
}
