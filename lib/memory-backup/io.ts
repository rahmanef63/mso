import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pinSecurityStorePath } from "@/lib/security-store-path";
export const digest = (data: Buffer) => createHash("sha256").update(data).digest("hex");
export function safeRelative(value: string) {
  return value.length > 0 && value.length < 2048 && value.split("/").every(p => /^[A-Za-z0-9_.-]{1,180}$/.test(p) && p !== "." && p !== "..");
}
// Do not create missing source directories (the shared write pin can create parents).
export async function existing(file: string) {
  if (!path.isAbsolute(file) || file.split(path.sep).includes("..")) throw new Error("unsafe path");
  let current = "/";
  for (const part of file.split("/").filter(Boolean)) {
    // Host-owned runtime paths are guarded below, not deployable build assets.
    current = path.join(/* turbopackIgnore: true */ current, part);
    if ((await fs.lstat(/* turbopackIgnore: true */ current)).isSymbolicLink()) throw new Error("unsafe path");
  }
}
export async function readBytes(file: string, max: number) {
  await existing(file);
  const pin = await pinSecurityStorePath(file);
  let handle;
  try {
    handle = await fs.open(/* turbopackIgnore: true */ pin.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat();
    if (!before.isFile() || before.uid !== process.getuid?.() || (before.mode & 0o022) || before.size > max) throw new Error("unsafe or oversized input");
    const bytes = Buffer.alloc(before.size + 1);
    let used = 0;
    while (used < bytes.length) {
      const part = await handle.read(bytes, used, bytes.length - used, used);
      if (!part.bytesRead) break;
      used += part.bytesRead;
    }
    const after = await handle.stat();
    const replaced = after.nlink === 0 && after.ino === before.ino && after.dev === before.dev;
    if (used !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
      (after.ctimeMs !== before.ctimeMs && !replaced) || after.mode !== before.mode || after.uid !== before.uid) throw new Error("changed input");
    return bytes.subarray(0, used);
  } finally { await handle?.close(); await pin.directory.close(); }
}
export async function writeExclusive(file: string, bytes: Buffer) {
  const pin = await pinSecurityStorePath(file);
  let handle;
  try {
    if ((await pin.directory.stat()).mode & 0o077) throw new Error("backup directory is not private");
    handle = await fs.open(/* turbopackIgnore: true */ pin.file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(bytes); await handle.sync();
  } finally { await handle?.close(); await pin.directory.close(); }
}
