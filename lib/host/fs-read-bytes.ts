import { promises as fs, constants as fsConstants } from "fs";
import { HostError } from "./host-error";
import { resolveReadable } from "./paths";

/** Binary-safe bounded read using the same READ roots and sensitive-path jail as fs_read. */
export async function readFileBytes(requested: string, maxBytes = 10 * 1024 * 1024): Promise<Buffer> {
  const p = await resolveReadable(requested);
  let handle;
  try {
    handle = await fs.open(p, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile()) throw new HostError(stat.isDirectory() ? "Is a directory" : "Not a regular file");
    if (!Number.isFinite(maxBytes) || maxBytes < 1 || stat.size > maxBytes) {
      throw new HostError(`File too large to export (max ${Math.floor(maxBytes / (1024 * 1024))} MiB)`);
    }
    return await handle.readFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") throw new HostError("Refusing symlink file");
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
