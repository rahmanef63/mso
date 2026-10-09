import { AsyncLocalStorage } from "node:async_hooks";
import { constants, promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { HostError } from "./host-error";
import { isUnderRoot } from "./path-roots";

type Boundary = { root: string; handle: FileHandle; held: FileHandle[] };
const boundary = new AsyncLocalStorage<Boundary>();
export async function assertIsolatedPath(real: string): Promise<void> {
  const current = boundary.getStore();
  if (!current) return;
  if (await fs.realpath(`/proc/self/fd/${current.handle.fd}`) !== current.root || !isUnderRoot(real, current.root)) throw new HostError("Path escapes the pinned isolated workflow workspace");
}
/** Hold the worktree across the complete capability call; host descriptors recheck it before writes. */
export async function withIsolatedFilesystem<T>(root: string | undefined, run: () => Promise<T>): Promise<T> {
  if (!root) return run();
  if (process.platform !== "linux") throw new HostError("Isolated source execution requires Linux/WSL descriptors");
  const canonical = await fs.realpath(root);
  const handle = await fs.open(canonical, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const current = { root: canonical, handle, held: [] as FileHandle[] };
  try { return await boundary.run(current, run); }
  finally { await Promise.all([...current.held, handle].map((item) => item.close())); }
}
export async function isolatedCwd(real: string): Promise<string> {
  const current = boundary.getStore();
  if (!current) return real;
  await assertIsolatedPath(real);
  const handle = await fs.open(real, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await assertIsolatedPath(await fs.realpath(`/proc/self/fd/${handle.fd}`)); }
  catch (error) { await handle.close(); throw error; }
  current.held.push(handle);
  return path.join("/proc/self/fd", String(handle.fd));
}
