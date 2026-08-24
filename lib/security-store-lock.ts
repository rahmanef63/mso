import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";

// Cross-process lock for the tiny JSON files that carry security decisions.
// Atomic rename protects one write, but not a whole read-modify-write transaction.
// The web process also serializes in-process callers; this lock covers supported
// operator-side helpers (notably `mso device ...`) that edit the same store.
const WAIT_MS = 25;
const BUSY_TIMEOUT_MS = 3_000;
const STALE_MS = 30_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface HeldLock {
  handle: FileHandle;
  token: string;
}

function pidIsGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

async function abandoned(lockPath: string): Promise<boolean> {
  const stat = await fs.stat(lockPath).catch(() => null);
  if (!stat) return true;
  const age = Date.now() - stat.mtimeMs;
  const owner = await fs.readFile(lockPath, "utf8").catch(() => "");
  const pid = Number(owner.split(":", 1)[0]);
  // A valid, live PID wins over age: never break mutual exclusion merely because
  // the process was paused. Age is only the recovery path for malformed owner data.
  if (Number.isInteger(pid) && pid > 1) return pidIsGone(pid);
  return age > STALE_MS;
}

async function acquire(lockPath: string): Promise<HeldLock> {
  await fs.mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  const token = `${process.pid}:${randomUUID()}`;
  const deadline = Date.now() + BUSY_TIMEOUT_MS;
  while (true) {
    try {
      const handle = await fs.open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(token, "utf8");
      } catch (error) {
        await handle.close().catch(() => undefined);
        await fs.unlink(lockPath).catch(() => undefined);
        throw error;
      }
      return { handle, token };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await abandoned(lockPath)) {
        await fs.unlink(lockPath).catch(() => undefined);
        continue;
      }
      if (Date.now() >= deadline) throw new Error("security store is busy; retry the operation");
      await sleep(WAIT_MS);
    }
  }
}

async function release(lockPath: string, held: HeldLock): Promise<void> {
  await held.handle.close().catch(() => undefined);
  const owner = await fs.readFile(lockPath, "utf8").catch(() => "");
  // Never remove a lock that a stale-lock recovery may have handed to another process.
  if (owner === held.token) await fs.unlink(lockPath).catch(() => undefined);
}

export async function withSecurityStoreLock<T>(storePath: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = `${storePath}.lock`;
  const held = await acquire(lockPath);
  try {
    return await fn();
  } finally {
    await release(lockPath, held);
  }
}
