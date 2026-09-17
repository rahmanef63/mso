import { randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { pinSecurityStorePath } from "@/lib/security-store-path";

/** Read one bounded snapshot through the same descriptor that was validated.
 * The existing security-store authority pins every ancestor; a pathname swap
 * cannot redirect either the size/permission check or the subsequent read.
 */
export async function readWorkflowJson(file: string, maximumBytes: number, label: string): Promise<unknown> {
  const pinned = await pinSecurityStorePath(file);
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(/* turbopackIgnore: true */ pinned.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat();
    if (!before.isFile() || before.size <= 0 || before.size > maximumBytes || (before.mode & 0o077) || before.uid !== process.getuid?.()) {
      throw new Error(`unsafe ${label}`);
    }
    const bytes = Buffer.alloc(before.size + 1);
    let used = 0;
    while (used < bytes.length) {
      const { bytesRead } = await handle.read(bytes, used, bytes.length - used, used);
      if (!bytesRead) break;
      used += bytesRead;
    }
    const after = await handle.stat();
    // Atomic replacement unlinks the old inode and changes ctime, while its
    // open descriptor remains a valid immutable snapshot. Only that case is
    // permitted; growth, content timestamps and unsafe permissions still fail.
    const replacedSnapshot = after.nlink === 0 && after.dev === before.dev && after.ino === before.ino;
    if (used !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
      (after.ctimeMs !== before.ctimeMs && !replacedSnapshot) || (after.mode & 0o077) || after.uid !== before.uid) {
      throw new Error(`${label} changed while reading`);
    }
    return JSON.parse(bytes.subarray(0, used).toString("utf8"));
  } catch (error) {
    if (["ELOOP", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw new Error(`unsafe ${label}`);
    throw error;
  } finally { await handle?.close(); await pinned.directory.close(); }
}

/** Preserve the existing atomic JSON format; never chmod or reopen a renamed pathname. */
export async function writeWorkflowFile(file: string, body: string): Promise<void> {
  const pinned = await pinSecurityStorePath(file);
  const temporary = `${pinned.file}.${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    await pinned.directory.chmod(0o700);
    handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(body, "utf8");
    await handle.close(); handle = undefined;
    await fs.rename(temporary, pinned.file);
  } finally {
    await handle?.close();
    await fs.unlink(temporary).catch(() => undefined);
    await pinned.directory.close();
  }
}

/** Directory entries are only names, never trusted paths. Callers validate each basename. */
export async function listWorkflowFiles(directory: string): Promise<string[]> {
  const pinned = await pinSecurityStorePath(path.join(directory, ".index"));
  try { return await fs.readdir(/* turbopackIgnore: true */ path.dirname(pinned.file)); }
  finally { await pinned.directory.close(); }
}

export async function removeWorkflowFile(file: string): Promise<void> {
  const pinned = await pinSecurityStorePath(file);
  try { await fs.unlink(pinned.file); }
  finally { await pinned.directory.close(); }
}

/** Pruning needs timestamps, not JSON parsing or receipt contents. */
export async function workflowFileMtime(file: string): Promise<number> {
  const pinned = await pinSecurityStorePath(file);
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(/* turbopackIgnore: true */ pinned.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || (stat.mode & 0o077) || stat.uid !== process.getuid?.()) throw new Error("unsafe workflow receipt");
    return stat.mtimeMs;
  } finally { await handle?.close(); await pinned.directory.close(); }
}
