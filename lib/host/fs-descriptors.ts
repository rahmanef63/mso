import { constants, promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { HostError } from "./host-error";
import { isCredentialPath } from "./path-credentials";
import { isUnderRoot, readRootList, writeRootList } from "./path-roots";

const fdPath = (fd: number) => `/proc/self/fd/${fd}`;

/** Validate the object we actually opened, not a pathname that can be exchanged. */
export async function descriptorPath(handle: FileHandle, write: boolean): Promise<string> {
  if (process.platform !== "linux") throw new HostError("Secure host filesystem access requires Linux/WSL descriptor support");
  const real = await fs.realpath(fdPath(handle.fd));
  if (isCredentialPath(real)) throw new HostError("Access to credential/sensitive files is blocked");
  for (const root of write ? writeRootList() : readRootList()) {
    const canonical = path.resolve(/* turbopackIgnore: true */ root);
    if (isUnderRoot(real, canonical)) return real;
  }
  throw new HostError(`Path outside ${write ? "writable" : "readable"} roots`);
}

export async function openReadableHandle(resolved: string, write = false): Promise<FileHandle> {
  const handle = await fs.open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try { await descriptorPath(handle, write); return handle; }
  catch (error) { await handle.close(); throw error; }
}

export interface PinnedDirectory {
  handle: FileHandle;
  child(name: string): Promise<string>;
}

/** Every child has one basename under a held directory; no mutable ancestor is reopened. */
export async function pinDirectory(resolved: string, write: boolean, create = false): Promise<PinnedDirectory> {
  let handle: FileHandle;
  try { handle = await fs.open(resolved, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); }
  catch (error) {
    if (!create || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = await pinDirectory(path.dirname(resolved), true, true);
    try {
      const target = await parent.child(path.basename(resolved));
      await fs.mkdir(target, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
      handle = await fs.open(target, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    } finally { await parent.handle.close(); }
  }
  try { await descriptorPath(handle, write); }
  catch (error) { await handle.close(); throw error; }
  return { handle, async child(name) {
    if (!name || name === "." || name === ".." || path.basename(name) !== name || name.includes("\0")) throw new HostError("Invalid item name");
    const real = await descriptorPath(handle, write);
    if (isCredentialPath(path.join(/* turbopackIgnore: true */ real, name))) throw new HostError("Access to credential/sensitive files is blocked");
    return path.join(fdPath(handle.fd), name);
  } };
}
