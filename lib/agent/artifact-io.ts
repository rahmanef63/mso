import { constants, promises as fs } from "node:fs";
import path from "node:path";
/** Artifact paths are private and never follow symbolic links. */
export async function ensureArtifactDirectory(directory: string, privateRoot: string, create = true): Promise<boolean> {
  const relative = path.relative(privateRoot, directory);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("artifact directory outside session root");
  let current = path.parse(directory).root;
  for (const component of path.resolve(directory).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    let stat = await fs.lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!stat) {
      if (!create) return false;
      await fs.mkdir(current, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
      stat = await fs.lstat(current);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("artifact directory must not be a symlink");
    if (current === privateRoot || current.startsWith(privateRoot + path.sep)) {
      if ((stat.mode & 0o077) !== 0) throw new Error("artifact directory must have owner-only permissions");
      if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("artifact directory owner mismatch");
    }
  }
  return true;
}
export async function readArtifactBytes(file: string, maxBytes: number): Promise<Buffer> {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size < 1 || stat.size > maxBytes) throw new Error("invalid artifact file or size");
    if ((stat.mode & 0o077) !== 0) throw new Error("artifact file must have owner-only permissions");
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("artifact file owner mismatch");
    const bytes = await handle.readFile();
    if (bytes.length > maxBytes) throw new Error("artifact grew beyond the size limit");
    return bytes;
  } finally {
    await handle.close();
  }
}
