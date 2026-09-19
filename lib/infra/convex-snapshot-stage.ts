import { createHash } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveReadable } from "@/lib/host/paths";
import { IntegrationError } from "./identity";

const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024 * 1024;
const COPY_CHUNK_BYTES = 1024 * 1024;

async function assertOpenedSnapshotIdentity(
  requestedPath: string,
  canonicalSnapshot: string,
  opened: Awaited<ReturnType<typeof fs.stat>>,
) {
  const current = await resolveReadable(requestedPath).catch(() => {
    throw new IntegrationError("invalid_snapshot_path");
  });
  if (current !== canonicalSnapshot) throw new IntegrationError("invalid_snapshot_path");
  const named = await fs.lstat(canonicalSnapshot).catch(() => null);
  if (!named?.isFile() || named.dev !== opened.dev || named.ino !== opened.ino)
    throw new IntegrationError("invalid_snapshot_path");
}

export async function stageConvexSnapshot(requestedPath: string, snapshot: string) {
  const handle = await fs
    .open(snapshot, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
    .catch(() => {
      throw new IntegrationError("invalid_snapshot_path");
    });
  let stageDir = "";
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_SNAPSHOT_BYTES)
      throw new IntegrationError("invalid_snapshot_path");
    if (typeof process.getuid === "function" && stat.uid !== process.getuid())
      throw new IntegrationError("invalid_snapshot_path");

    // Re-authorize the caller path after open and bind its current name to the
    // already-open descriptor. O_NOFOLLOW protects only the final component; this
    // additionally rejects parent-directory/symlink swaps between check and open.
    await assertOpenedSnapshotIdentity(requestedPath, snapshot, stat);

    const head = Buffer.alloc(4);
    const first = await handle.read(head, 0, 4, 0);
    if (
      first.bytesRead < 4 ||
      head[0] !== 0x50 ||
      head[1] !== 0x4b ||
      ![0x03, 0x05, 0x07].includes(head[2])
    )
      throw new IntegrationError("convex_snapshot_zip_required");

    // The CLI imports a private copy made from the same descriptor checked above.
    // Replacing the caller-controlled pathname cannot swap the validated bytes.
    stageDir = await fs.mkdtemp(path.join(os.tmpdir(), "mso-convex-snapshot-"));
    await fs.chmod(stageDir, 0o700);
    const stagedSnapshot = path.join(stageDir, "snapshot.zip");
    const staged = await fs.open(
      stagedSnapshot,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      0o600,
    );
    const hash = createHash("sha256");
    const chunk = Buffer.allocUnsafe(COPY_CHUNK_BYTES);
    let offset = 0;
    try {
      while (offset < stat.size) {
        const requested = Math.min(chunk.length, stat.size - offset);
        const { bytesRead } = await handle.read(chunk, 0, requested, offset);
        if (bytesRead <= 0) throw new IntegrationError("invalid_snapshot_path");
        const view = chunk.subarray(0, bytesRead);
        hash.update(view);
        let written = 0;
        while (written < bytesRead) {
          const { bytesWritten } = await staged.write(
            view,
            written,
            bytesRead - written,
            offset + written,
          );
          if (bytesWritten <= 0)
            throw new IntegrationError("invalid_snapshot_path");
          written += bytesWritten;
        }
        offset += bytesRead;
      }
      await staged.sync();
    } finally {
      await staged.close().catch(() => undefined);
    }

    const after = await handle.stat();
    if (
      after.dev !== stat.dev ||
      after.ino !== stat.ino ||
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ctimeMs !== stat.ctimeMs
    )
      throw new IntegrationError("invalid_snapshot_path");
    // Bind the final result metadata to the same caller-visible path as well.
    // A late rename/replacement after the copy is rejected instead of returning
    // a staged snapshot whose audit path now names different bytes.
    await assertOpenedSnapshotIdentity(requestedPath, snapshot, stat);

    return {
      stagedSnapshot,
      size: stat.size,
      sha256: hash.digest("hex"),
      cleanup: async () => {
        await fs.rm(stageDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (stageDir) await fs.rm(stageDir, { recursive: true, force: true });
    throw error;
  } finally {
    await handle.close().catch(() => undefined);
  }
}
