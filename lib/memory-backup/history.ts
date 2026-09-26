import { promises as fs } from "node:fs";
import path from "node:path";
import { pinSecurityStorePath } from "@/lib/security-store-path";
import { digest, existing } from "./io";
import { BACKUP_ID, readManifest, snapshotSummary } from "./manifest";
import { readVerification } from "./verification-receipt";
import type { MemoryBackupHistory } from "@/lib/contracts/memory-backup";

type Options = { offset?: number; revision?: string; limit?: number };
const stamp = (stat: { dev: number; ino: number; mtimeMs: number; ctimeMs: number }) =>
  digest(Buffer.from(JSON.stringify([stat.dev, stat.ino, stat.mtimeMs, stat.ctimeMs])));
/** Metadata only. Cursor is a bounded directory position, invalidated by root changes. */
export async function listSnapshots(root: string, options: Options = {}): Promise<MemoryBackupHistory> {
  const offset = options.offset ?? 0, limit = options.limit ?? 12;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 32768 || !Number.isSafeInteger(limit) || limit < 1 || limit > 20 ||
    (offset > 0 && !/^[a-f0-9]{64}$/.test(options.revision ?? ""))) throw new Error("invalid backup history cursor");
  try { await existing(root); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && offset === 0) return { items: [], nextOffset: null, revision: "", order: "directory", scannedEntries: 0 };
    throw error;
  }
  const pin = await pinSecurityStorePath(path.join(root, ".history-index"));
  let dir;
  try {
    const revision = stamp(await pin.directory.stat());
    if (offset > 0 && revision !== options.revision) throw new Error("backup history changed; refresh the first page");
    dir = await fs.opendir(/* turbopackIgnore: true */ path.dirname(pin.file));
    const items: MemoryBackupHistory["items"] = [];
    const deadline = Date.now() + 5000;
    let position = 0, scannedEntries = 0, finished = false;
    while (position < offset) {
      if (Date.now() > deadline) throw new Error("backup history cursor exceeded read budget; refresh");
      if (!await dir.read()) throw new Error("backup history cursor no longer exists; refresh");
      position++;
    }
    while (items.length < limit && scannedEntries < 200 && Date.now() <= deadline) {
      const entry = await dir.read();
      if (!entry) { finished = true; break; }
      position++; scannedEntries++;
      if (!BACKUP_ID.test(entry.name)) continue;
      if (!entry.isDirectory()) { items.push({ id: entry.name, status: "unreadable", error: "snapshot-unreadable" }); continue; }
      try {
        const value = await readManifest(root, entry.name);
        items.push({ id: entry.name, status: "readable", snapshot: snapshotSummary(value.directory, value.manifestSha256, value.manifest),
          ...await readVerification(value.directory, value.manifestSha256, value.manifest) });
      } catch { items.push({ id: entry.name, status: "unreadable", error: "snapshot-unreadable" }); }
    }
    if (stamp(await pin.directory.stat()) !== revision) throw new Error("backup history changed; refresh the first page");
    if (!finished && position >= 32768) throw new Error("backup history enumeration limit reached; snapshots preserved");
    return { items, nextOffset: finished ? null : position, revision, order: "directory", scannedEntries };
  } finally { await dir?.close(); await pin.directory.close(); }
}
