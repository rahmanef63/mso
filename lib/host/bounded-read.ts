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
import path from "node:path";
import { readRootList } from "./path-roots";

async function openReadableFile(file: string, trustedRoot?: string) {
  const absolute = path.resolve(file);
  for (const configured of trustedRoot ? [trustedRoot] : readRootList()) {
    const root = path.resolve(configured);
    const relative = path.relative(root, absolute);
    if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
      continue;
    } else {
      const parent = await fs.realpath(path.dirname(absolute));
      const realRoot = await fs.realpath(root);
      const realRelative = path.relative(realRoot, parent);
      if (realRelative === ".." || realRelative.startsWith(".." + path.sep) || path.isAbsolute(realRelative)) {
        throw new Error("bounded read outside readable roots");
      }
      // Keep O_NOFOLLOW on the original final component; only resolve its parent.
      return fs.open(path.join(parent, path.basename(absolute)), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    }
  }
  throw new Error("bounded read outside readable roots");
}

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

// Internal stores/skill scans may supply their already-authorized root; host reads default to configured read roots.
export async function readBoundedRegularBufferOrThrow(file: string, maxBytes: number, trustedRoot?: string): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 64 * 1024 * 1024) throw new Error("invalid bounded-read limit");
  const handle = await openReadableFile(file, trustedRoot);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maxBytes) throw new Error("not a bounded regular file");
    const buffer = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) throw new Error("file changed during bounded read");
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error("file changed during bounded read");
    return buffer;
  } finally { await handle.close(); }
}

export async function readBoundedRegularBuffer(file: string, maxBytes: number, trustedRoot?: string): Promise<Buffer | null> {
  try { return await readBoundedRegularBufferOrThrow(file, maxBytes, trustedRoot); }
  catch { return null; }
}

export async function readBoundedRegularFile(file: string, maxBytes: number, trustedRoot?: string): Promise<string | null> {
  const buffer = await readBoundedRegularBuffer(file, maxBytes, trustedRoot);
  return buffer === null ? null : buffer.toString("utf8");
}
