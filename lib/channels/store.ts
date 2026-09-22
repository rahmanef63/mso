import { randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expandOwnerStorePath } from "@/lib/owner-store-path.js";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { ChannelError } from "./errors";
import { parseChannelPatch } from "./schema";
import type { ChannelRecord, ChannelState } from "./types";

const MAX_BYTES = 1024 * 1024;
const storePath = () => expandOwnerStorePath(process.env.OS_CHANNEL_STORE ?? path.join(os.homedir(), ".mso", "private", "channels.json"));
const empty = (): ChannelState => ({ version: 1, revision: 0, channels: [] });

function validateState(value: unknown): ChannelState {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ChannelError("invalid_channel_store");
  const state = value as Partial<ChannelState>;
  if (state.version !== 1 || !Number.isSafeInteger(state.revision) || (state.revision ?? -1) < 0 || !Array.isArray(state.channels)) {
    throw new ChannelError("invalid_channel_store");
  }
  const ids = new Set<string>();
  const channels = state.channels.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ChannelError("invalid_channel_store");
    const row = raw as ChannelRecord;
    if (typeof row.id !== "string" || !/^[0-9a-f-]{36}$/i.test(row.id) || ids.has(row.id)) throw new ChannelError("invalid_channel_store");
    ids.add(row.id);
    const parsed = parseChannelPatch(row as unknown as Record<string, unknown>);
    if (typeof row.createdAt !== "string" || typeof row.updatedAt !== "string") throw new ChannelError("invalid_channel_store");
    return {
      id: row.id,
      ...parsed,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      ...(row.lastCheck ? { lastCheck: row.lastCheck } : {}),
      ...(row.lastActivityAt ? { lastActivityAt: row.lastActivityAt } : {}),
    } satisfies ChannelRecord;
  });
  return { version: 1, revision: state.revision!, channels };
}

async function readUnlocked(): Promise<ChannelState> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(storePath(), constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_BYTES || (stat.mode & 0o077)) throw new ChannelError("unsafe_channel_store");
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new ChannelError("unsafe_channel_store");
    return validateState(JSON.parse(await handle.readFile("utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty();
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function writeUnlocked(state: ChannelState) {
  const file = storePath();
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700);
  const body = JSON.stringify(state, null, 2) + "\n";
  if (Buffer.byteLength(body) > MAX_BYTES) throw new ChannelError("channel_store_capacity", 409);
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, body, { flag: "wx", mode: 0o600 });
    await fs.rename(temp, file);
    await fs.chmod(file, 0o600);
  } finally {
    await fs.unlink(temp).catch(() => undefined);
  }
}

export async function readChannelState() {
  return structuredClone(await readUnlocked());
}

async function mutate<T>(fn: (state: ChannelState) => T | Promise<T>, bumpRevision = true) {
  return withSecurityStoreLock(storePath(), async () => {
    const state = await readUnlocked();
    const result = await fn(state);
    if (bumpRevision) state.revision += 1;
    await writeUnlocked(state);
    return { result, state: structuredClone(state) };
  });
}

export async function createChannel(raw: Record<string, unknown>) {
  return mutate((state) => {
    const now = new Date().toISOString();
    const row: ChannelRecord = { id: randomUUID(), ...parseChannelPatch(raw), createdAt: now, updatedAt: now };
    state.channels.push(row);
    return structuredClone(row);
  });
}

export async function updateChannel(id: string, expectedRevision: number, raw: Record<string, unknown>) {
  return mutate((state) => {
    if (state.revision !== expectedRevision) throw new ChannelError("channel_revision_changed", 409);
    const index = state.channels.findIndex((row) => row.id === id);
    if (index < 0) throw new ChannelError("channel_not_found", 404);
    const previous = state.channels[index]!;
    const row: ChannelRecord = {
      ...previous,
      ...parseChannelPatch(raw, previous),
      id: previous.id,
      createdAt: previous.createdAt,
      updatedAt: new Date().toISOString(),
    };
    state.channels[index] = row;
    return structuredClone(row);
  });
}

export async function deleteChannel(id: string, expectedRevision: number) {
  return mutate((state) => {
    if (state.revision !== expectedRevision) throw new ChannelError("channel_revision_changed", 409);
    const index = state.channels.findIndex((row) => row.id === id);
    if (index < 0) throw new ChannelError("channel_not_found", 404);
    return state.channels.splice(index, 1)[0]!;
  });
}

export async function channelById(id: string) {
  const row = (await readUnlocked()).channels.find((item) => item.id === id);
  if (!row) throw new ChannelError("channel_not_found", 404);
  return structuredClone(row);
}

export async function recordChannelCheck(id: string, ok: boolean, detail: string) {
  return mutate((state) => {
    const row = state.channels.find((item) => item.id === id);
    if (!row) throw new ChannelError("channel_not_found", 404);
    row.lastCheck = { at: new Date().toISOString(), ok, detail: detail.slice(0, 300) };
    row.updatedAt = new Date().toISOString();
    return structuredClone(row);
  }, false);
}

export async function recordChannelActivity(id: string) {
  return mutate((state) => {
    const row = state.channels.find((item) => item.id === id);
    if (!row) throw new ChannelError("channel_not_found", 404);
    row.lastActivityAt = new Date().toISOString();
    return structuredClone(row);
  }, false);
}
