import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { descriptorPath, openReadableHandle, pinDirectory } from "./fs-descriptors";
import { isAppSecret } from "./path-credentials";
import { HostError } from "./host-error";

export async function removePinned(target: string): Promise<void> {
  const stat = await fs.lstat(target);
  if (!stat.isDirectory()) { await fs.unlink(target); return; }
  const dir = await pinDirectory(target, true);
  try {
    for (const name of await fs.readdir(`/proc/self/fd/${dir.handle.fd}`)) await removePinned(await dir.child(name));
    await descriptorPath(dir.handle, true);
    const current = await fs.lstat(target), held = await dir.handle.stat();
    if (current.dev !== held.dev || current.ino !== held.ino) throw new HostError("Directory changed during removal");
    await fs.rmdir(target);
  } finally { await dir.handle.close(); }
}

export async function copyPinned(source: string, destination: string): Promise<void> {
  const stat = await fs.lstat(source);
  if (stat.isDirectory()) {
    const dir = await pinDirectory(source, true);
    try {
      const real = await descriptorPath(dir.handle, true);
      await fs.mkdir(destination, { mode: stat.mode & 0o777 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
      const dest = await pinDirectory(destination, true);
      try {
        for (const name of await fs.readdir(`/proc/self/fd/${dir.handle.fd}`)) {
          if (isAppSecret(path.join(real, name))) continue;
          await copyPinned(await dir.child(name), await dest.child(name));
        }
      } finally { await dest.handle.close(); }
    } finally { await dir.handle.close(); }
    return;
  }
  if (stat.isSymbolicLink()) {
    // Copy the link itself; later reads still enforce the target's credential/root boundary.
    const link = await fs.readlink(source);
    const target = path.isAbsolute(link) ? link : path.resolve(/* turbopackIgnore: true */ await fs.realpath(/* turbopackIgnore: true */ path.dirname(source)), link);
    const tmp = `${destination}.tmp-${randomUUID()}`;
    try { await fs.symlink(target, tmp); await fs.rename(tmp, destination); }
    finally { await fs.unlink(tmp).catch(() => undefined); }
    return;
  }
  const input = await openReadableHandle(source, true), tmp = `${destination}.tmp-${randomUUID()}`;
  let output;
  try {
    if (!(await input.stat()).isFile()) throw new HostError("Not a regular file");
    output = await fs.open(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, stat.mode & 0o777);
    const chunk = Buffer.alloc(1024 * 1024);
    while (true) {
      const { bytesRead } = await input.read(chunk);
      if (!bytesRead) break;
      let offset = 0;
      while (offset < bytesRead) {
        const {bytesWritten} = await output.write(chunk, offset, bytesRead - offset);
        if (!bytesWritten) throw new HostError("Failed to copy file");
        offset += bytesWritten;
      }
    }
    await output.close();
    await fs.rename(tmp, destination);
  } finally {
    await input.close(); await output?.close().catch(() => undefined); await fs.unlink(tmp).catch(() => undefined);
  }
}
