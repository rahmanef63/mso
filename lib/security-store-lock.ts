import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

// Cross-process lock for the tiny JSON files that carry security decisions.
// Atomic rename protects one write, but not a whole read-modify-write transaction.
// The web process also serializes in-process callers; this lock covers supported
// operator-side helpers (notably `mso device ...`) that edit the same store.
const DEFAULTS = { waitMs: 25, busyTimeoutMs: 3_000, staleMs: 30_000 } as const;

export type SecurityStoreLockTimings = {
  waitMs?: number;
  busyTimeoutMs?: number;
  staleMs?: number;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface HeldLock {
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

async function abandoned(lockPath: string, staleMs: number): Promise<boolean> {
  const stat = await fs.stat(lockPath).catch(() => null);
  if (!stat) return true;
  const age = Date.now() - stat.mtimeMs;
  const owner = await fs.readFile(lockPath, "utf8").catch(() => "");
  const pid = Number(owner.split(":", 1)[0]);
  // A valid, live PID wins over age: never break mutual exclusion merely because
  // the process was paused. Age is only the recovery path for malformed owner data.
  if (Number.isInteger(pid) && pid > 1) return pidIsGone(pid);
  return age > staleMs;
}

async function openExclusive(lockPath: string, token: string): Promise<HeldLock> {
  // Build the complete owner record under a private candidate name, then publish it
  // with one atomic hard-link. A competing recoverer can never observe an empty or
  // partially-written live lock.
  const candidate = `${lockPath}.${randomUUID()}.candidate`;
  const handle = await fs.open(candidate, "wx", 0o600);
  try {
    await handle.writeFile(token, "utf8");
    await handle.sync();
  } finally {
    await handle.close().catch(() => undefined);
  }
  try {
    await fs.link(candidate, lockPath);
  } finally {
    await fs.unlink(candidate).catch(() => undefined);
  }
  return { token };
}

async function release(lockPath: string, held: HeldLock): Promise<void> {
  const owner = await fs.readFile(lockPath, "utf8").catch(() => "");
  // Never remove a lock that a recovery path may have handed to another process.
  if (owner === held.token) await fs.unlink(lockPath).catch(() => undefined);
}

async function acquire(lockPath: string, timings: Required<SecurityStoreLockTimings>): Promise<HeldLock> {
  await fs.mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  const token = `${process.pid}:${randomUUID()}`;
  const recoveryPath = `${lockPath}.recovery`;
  const deadline = Date.now() + timings.busyTimeoutMs;

  while (true) {
    // Every contender takes the recovery guard before inspecting or publishing the
    // primary lock. Without this shared acquisition gate, a stale-lock recoverer can
    // stat an old lock, observe ENOENT while its owner releases, then unlink a newly
    // published live lock at the same pathname (a classic check/unlink ABA race).
    let gate: HeldLock | null = null;
    try {
      gate = await openExclusive(recoveryPath, `${process.pid}:${randomUUID()}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }

    if (gate) {
      try {
        try {
          // Publish the primary lock before releasing the gate. A recoverer that
          // removes an abandoned owner therefore hands the path directly to itself;
          // no second contender can slip into the unlink/create interval.
          return await openExclusive(lockPath, token);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }

        if (await abandoned(lockPath, timings.staleMs)) {
          try {
            await fs.unlink(lockPath);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
          // Still under the shared gate: either this succeeds, or an unsupported
          // external writer raced us and we fail closed by retrying rather than
          // deleting an unverified replacement.
          try {
            return await openExclusive(lockPath, token);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          }
        }
      } finally {
        // Recovery guards are deliberately NOT auto-broken. A crashed guard causes
        // an availability failure requiring manual cleanup, never a revocation-losing
        // race. Normal acquisition holds this guard only for the short publish step.
        await release(recoveryPath, gate);
      }
    }

    if (Date.now() >= deadline) throw new Error("security store is busy; retry the operation");
    await sleep(timings.waitMs);
  }
}

export async function withSecurityStoreLock<T>(
  storePath: string,
  fn: () => Promise<T>,
  options: SecurityStoreLockTimings = {},
): Promise<T> {
  const timings = {
    waitMs: options.waitMs ?? DEFAULTS.waitMs,
    busyTimeoutMs: options.busyTimeoutMs ?? DEFAULTS.busyTimeoutMs,
    staleMs: options.staleMs ?? DEFAULTS.staleMs,
  };
  const lockPath = `${storePath}.lock`;
  const held = await acquire(lockPath, timings);
  try {
    return await fn();
  } finally {
    await release(lockPath, held);
  }
}
