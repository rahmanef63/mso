// The ONLY way project/skill discovery reads a file off disk.
//
// Discovery walks directories the owner did not necessarily author — a cloned repo,
// a vendored skill pack, a checkout someone else pushed to. Two things must therefore
// be true of every read here, and neither was before:
//
//   1. NO SYMLINK on the final component. `O_NOFOLLOW` fails with ELOOP rather than
//      handing back whatever the link points at. Doing the check with lstat-then-read
//      is a TOCTOU race; letting the kernel refuse the open is not.
//   2. THE CAP IS CHECKED BEFORE ANY BYTES MOVE. fstat first, refuse on size, then
//      allocate. `readFile()`-then-`slice()` has already paid for the whole file, so a
//      2 GiB `package.json` turned a read-scope `projects_list` into a memory-
//      exhaustion primitive.
//
// Returns null — never throws and never partially reads. A file that fails any check
// is simply "no metadata", which every caller already handles.
import { constants, promises as fs } from "fs";

/** Per-artifact caps. Generous enough for real files, small enough that the worst
 *  case of a full scan is bounded arithmetic rather than "whatever is on disk". */
export const BOUNDED_READ = {
  packageJson: 256 * 1024,
  skillMd: 256 * 1024,
  gitHead: 4 * 1024,
  gitRef: 4 * 1024,
  packedRefs: 1024 * 1024,
  projectFunctions: 256 * 1024,
  projectMcpConfig: 256 * 1024,
} as const;

export async function readBoundedRegularFile(file: string, maxBytes: number): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof fs.open>>;
  try {
    // O_NOFOLLOW: ELOOP if `file` itself is a symlink. Intermediate directories are
    // the caller's problem — they are realpath-contained before we get here.
    handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return null;
    if (stat.size > maxBytes) return null;
    const size = Number(stat.size);
    if (size === 0) return "";
    const buffer = Buffer.allocUnsafe(size);
    const { bytesRead } = await handle.read(buffer, 0, size, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => undefined);
  }
}
