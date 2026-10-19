import "server-only";
import { constants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The ONLY way the Orca bridge reads MSO's private runtime metadata.
 *
 * The managed root is MSO-owned state, not the owner's `~/.orca` profile. The
 * receipt/status files carry live credential material, so a read must be
 * symlink-proof, owner-only, and bounded — `lstat`-then-`readFile` is a TOCTOU
 * race and an unbounded `readFile` is a memory primitive. The root's canonical
 * path must equal its configured spelling (no symlink ancestor), the final
 * component is opened `O_NOFOLLOW`, and the cap is enforced from `fstat` before
 * any byte moves.
 */
export const ORCA_PRIVATE_MAX_BYTES = 64 * 1024;
const PRIVATE_FILES = new Set(["private-status.json", "runtime-identity.json"]);
const CONTROL = /[\0\r\n]/;

export type ManagedRootResult = { ok: true; root: string } | { ok: false; reason: "managed_root_invalid" };
export type PrivateReadResult = { ok: true; text: string } | { ok: false; reason: "missing" | "insecure" };

/** Portable default is MSO-managed state, never the owner's personal `~/.orca`. */
export function defaultOrcaManagedRoot(home: string = os.homedir()): string {
  return path.join(home, ".local", "share", "mso", "orca");
}

/** Resolve ORCA_HOME strictly, with the same policy as `scripts/orca/managed-paths.mjs`:
 *  an invalid override fails the bridge instead of silently falling back to the
 *  owner's default directory. `home` is injectable for parity tests only. */
export function resolveOrcaManagedRoot(
  env: Record<string, string | undefined> = process.env,
  home: string = os.homedir(),
): ManagedRootResult {
  const invalid: ManagedRootResult = { ok: false, reason: "managed_root_invalid" };
  const raw = env.ORCA_HOME;
  if (raw === undefined) return { ok: true, root: defaultOrcaManagedRoot(home) };
  // A SET but empty/relative/dirty override is a misconfiguration, not "unset":
  // fail the bridge clearly instead of falling back to the owner's default.
  if (typeof raw !== "string" || raw.trim() === "" || CONTROL.test(raw) || !path.isAbsolute(raw)) return invalid;
  const normalized = path.normalize(raw);
  // A trailing slash, `//`, or a `.`/`..` segment changes the canonical spelling;
  // refuse it instead of quietly rewriting the operator's config.
  if (normalized !== raw || (raw.length > 1 && raw.endsWith(path.sep))) return invalid;
  if (normalized.split(/[\\/]/).includes("..")) return invalid;
  const resolvedHome = path.normalize(home);
  // Never manage the filesystem root or the owner home itself.
  if (normalized === path.sep || normalized === resolvedHome) return invalid;
  // Never reuse the operator's personal Orca state, including any subtree.
  for (const personal of [".orca", ".orca-remote"]) {
    const prefix = path.join(resolvedHome, personal);
    if (normalized === prefix || normalized.startsWith(`${prefix}${path.sep}`)) return invalid;
  }
  return { ok: true, root: normalized };
}

function uidMatches(uid: number): boolean {
  return typeof process.getuid !== "function" || uid === process.getuid();
}

export async function readOrcaPrivateFile(root: string, filename: string): Promise<PrivateReadResult> {
  if (!PRIVATE_FILES.has(filename)) return { ok: false, reason: "insecure" };

  let canonicalRoot: string;
  try {
    canonicalRoot = await fs.realpath(root);
  } catch {
    return { ok: false, reason: "missing" };
  }
  // A symlinked ancestor changes the canonical path; refuse rather than follow it.
  if (canonicalRoot !== path.resolve(root)) return { ok: false, reason: "insecure" };

  let directory;
  try {
    directory = await fs.open(canonicalRoot, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  } catch {
    return { ok: false, reason: "missing" };
  }
  try {
    const rootStat = await directory.stat();
    if (!rootStat.isDirectory() || (rootStat.mode & 0o077) !== 0 || !uidMatches(rootStat.uid)) {
      return { ok: false, reason: "insecure" };
    }

    let handle;
    try {
      // Pin the verified directory inode and open the leaf by basename only.
      handle = await fs.open(`/proc/self/fd/${directory.fd}/${filename}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch (err) {
      return { ok: false, reason: (err as NodeJS.ErrnoException)?.code === "ENOENT" ? "missing" : "insecure" };
    }
    try {
      const before = await handle.stat();
      if (!before.isFile() || (before.mode & 0o077) !== 0 || !uidMatches(before.uid)) return { ok: false, reason: "insecure" };
      if (before.size > ORCA_PRIVATE_MAX_BYTES) return { ok: false, reason: "insecure" };
      const buffer = Buffer.alloc(Number(before.size));
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
        if (!bytesRead) return { ok: false, reason: "insecure" };
        offset += bytesRead;
      }
      const after = await handle.stat();
      if (after.size !== before.size || after.ino !== before.ino || after.mtimeMs !== before.mtimeMs) {
        return { ok: false, reason: "insecure" };
      }
      return { ok: true, text: buffer.toString("utf-8") };
    } finally {
      await handle.close();
    }
  } finally {
    await directory.close();
  }
}
