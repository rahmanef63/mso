import { constants, promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { isCredentialPath, resolveReadable } from "@/lib/host/paths";

export const ARTIFACT_FILE_LIMIT = 4 * 1024 * 1024;

/** Reapply current host policy even when reading a historical blob of a deleted file. */
export async function authorizeArtifactPath(file: string): Promise<string | null> {
  const absolute = path.resolve(file);
  if (isCredentialPath(absolute)) return null;
  try {
    const real = await resolveReadable(absolute);
    // Captures must name the actual file, not a mutable symlink alias.
    return real === absolute ? real : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null;
    try {
      const parent = await resolveReadable(path.dirname(absolute));
      return parent === path.dirname(absolute) ? absolute : null;
    } catch { return null; }
  }
}

/** Descriptor-based, bounded read: never follow a last-component symlink or read a growing file unboundedly. */
export async function readArtifactFile(file: string): Promise<{ bytes: Buffer; sha256: string; size: number } | null> {
  const real = await authorizeArtifactPath(file);
  if (!real) return null;
  let handle;
  try {
    handle = await fs.open(real, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat();
    // Re-resolve after opening to reject a parent symlink changed between guard and open.
    const authorized = await authorizeArtifactPath(file);
    if (authorized !== real) return null;
    const named = await fs.lstat(real);
    if (named.dev !== before.dev || named.ino !== before.ino) return null;
    if (!before.isFile() || before.size > ARTIFACT_FILE_LIMIT) return null;
    const buffer = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await handle.stat();
    if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) return null;
    if (await authorizeArtifactPath(file) !== real) return null;
    const finalPath = await fs.lstat(real);
    if (finalPath.dev !== before.dev || finalPath.ino !== before.ino) return null;
    const bytes = buffer.subarray(0, length);
    return { bytes, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
  } catch { return null; }
  finally { await handle?.close(); }
}
