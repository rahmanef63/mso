import { constants as C, promises as fs, type Stats } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { MAX_STORE_BYTES, validateSnapshot, type TenantSnapshot } from "./persistence-schema";

export class TenantStoreConflict extends Error {}
export class TenantCommitUncertain extends Error {
  constructor(readonly operationId: string) { super("tenant commit durability is uncertain; reconcile operation ID before retry"); }
}
type Pin = { dev: number; ino: number };
const safeFile = (s: Stats) =>
  s.isFile() && s.nlink === 1 && s.uid === process.getuid?.() && (s.mode & 0o777) === 0o600;
export async function tenantFile(root: string) {
  if (process.platform !== "linux" || !root || !path.isAbsolute(root) || path.resolve(root) !== root || root === "/") {
    throw new Error("explicit canonical Linux tenant root required");
  }
  async function pin(expected?: Pin) {
    if (await fs.realpath(root) !== root) throw new Error("tenant root must not contain symlinks");
    const handle = await fs.open(root, C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW);
    try {
      const s = await handle.stat();
      if (!s.isDirectory() || s.uid !== process.getuid?.() || (s.mode & 0o777) !== 0o700
        || (expected && (s.dev !== expected.dev || s.ino !== expected.ino))) throw new Error("invalid tenant root");
      return { handle, pin: { dev: s.dev, ino: s.ino }, directory: "/proc/self/fd/" + handle.fd };
    } catch (error) { await handle.close(); throw error; }
  }
  const initial = await pin();
  const identity = initial.pin;
  await initial.handle.close();
  async function transaction<T>(fn: (directory: string, sync: () => Promise<void>) => Promise<T>) {
    const p = await pin(identity);
    const lock = p.directory + "/state.lock";
    let held: Awaited<ReturnType<typeof fs.open>> | undefined;
    let result: T | undefined;
    let failure: unknown;
    let cleanupFailure: unknown;
    try {
      const deadline = performance.now() + 3000;
      while (!held) {
        try { held = await fs.open(lock, C.O_RDWR | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o600); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          if (performance.now() >= deadline) throw new Error("tenant store busy; abandoned locks require reviewed recovery");
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
      const selected = await pin(identity);
      await selected.handle.close();
      result = await fn(p.directory, () => p.handle.sync());
    } catch (error) { failure = error; }
    finally {
      try {
        if (held) {
          try {
            const ours = await held.stat();
            const current = await fs.lstat(lock);
            if (current.ino !== ours.ino || current.dev !== ours.dev) throw new Error("tenant lock replaced");
            await fs.unlink(lock);
          } finally { await held.close(); }
        }
      } catch (error) { cleanupFailure = error; }
      finally { await p.handle.close().catch(error => { cleanupFailure ??= error; }); }
    }
    if (failure) throw failure;
    if (cleanupFailure) {
      const operationId = (result as { operationId?: string } | undefined)?.operationId;
      if (operationId) throw new TenantCommitUncertain(operationId);
      throw cleanupFailure;
    }
    return result as T;
  }

  async function read(directory: string): Promise<TenantSnapshot> {
    const handle = await fs.open(directory + "/state.json", C.O_RDONLY | C.O_NOFOLLOW | C.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      if (!safeFile(stat) || stat.size < 1 || stat.size > MAX_STORE_BYTES) throw new Error("invalid tenant state file");
      const bytes = Buffer.alloc(stat.size + 1);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead !== stat.size) throw new Error("tenant state changed during read");
      return validateSnapshot(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, bytesRead))));
    } finally { await handle.close(); }
  }
  async function write(directory: string, sync: () => Promise<void>, state: TenantSnapshot, operationId: string, guard?: () => void) {
    validateSnapshot(state);
    const bytes = JSON.stringify(state);
    if (Buffer.byteLength(bytes) > MAX_STORE_BYTES) throw new Error("tenant store capacity reached");
    const temporary = directory + "/state-" + randomUUID() + ".tmp";
    const handle = await fs.open(temporary, C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o600);
    let renamed = false;
    try {
      await handle.writeFile(bytes, "utf8");
      await handle.sync();
      await handle.close();
      guard?.();
      await fs.rename(temporary, directory + "/state.json");
      renamed = true;
      await sync();
    } catch (error) {
      if (renamed) throw new TenantCommitUncertain(operationId);
      throw error;
    } finally {
      await handle.close().catch(() => undefined);
      if (!renamed) await fs.unlink(temporary).catch(() => undefined);
    }
  }
  return { transaction, read, write };
}
