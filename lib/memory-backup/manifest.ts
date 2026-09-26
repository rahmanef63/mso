import path from "node:path";
import { digest, readBytes, safeRelative } from "./io";
import { LIMITS, type Scan } from "./scan";
import type { MemoryBackupSummary } from "@/lib/contracts/memory-backup";

export const BACKUP_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const SHA256 = /^[a-f0-9]{64}$/;
export const MANIFEST_BYTES = 8 * 1024 * 1024;
export type Entry = { name: string; bytes: number; sha256: string; compressedBytes: number; compressedSha256: string };
export type Manifest = { version: 1; id: string; createdAt: string; scan: Scan; sourceDiscoveryTruncated: boolean; entries: Entry[] };
export function backupTarget(root: string, id: string) {
  if (!BACKUP_ID.test(id)) throw new Error("invalid memory backup id");
  return path.join(root, id);
}
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
export function validateManifest(value: unknown, id: string): Manifest {
  const m = value as Manifest;
  if (!m || m.version !== 1 || m.id !== id || !Array.isArray(m.entries) || m.entries.length > LIMITS.files ||
    typeof m.createdAt !== "string" || !Number.isFinite(Date.parse(m.createdAt)) || typeof m.sourceDiscoveryTruncated !== "boolean" ||
    !m.scan || typeof m.scan.truncated !== "boolean" || ![m.scan.files, m.scan.bytes, m.scan.missing, m.scan.rejected, m.scan.excluded].every(count)) {
    throw new Error("invalid backup manifest");
  }
  const names = new Set<string>();
  let total = 0;
  for (const row of m.entries) {
    if (!row || typeof row.name !== "string" || !safeRelative(row.name) || names.has(row.name) ||
      !count(row.bytes) || row.bytes > LIMITS.fileBytes || !count(row.compressedBytes) || row.compressedBytes > LIMITS.fileBytes + 65536 ||
      typeof row.sha256 !== "string" || !SHA256.test(row.sha256) || typeof row.compressedSha256 !== "string" || !SHA256.test(row.compressedSha256)) {
      throw new Error("unsafe backup entry");
    }
    names.add(row.name); total += row.bytes;
    if (total > LIMITS.bytes) throw new Error("restore size limit exceeded");
  }
  if (m.scan.files !== m.entries.length || m.scan.bytes !== total) throw new Error("backup coverage totals mismatch");
  return m;
}
export async function readManifest(root: string, id: string, expectedSha?: string) {
  const directory = backupTarget(root, id);
  if (expectedSha !== undefined && !SHA256.test(expectedSha)) throw new Error("manifest checksum required");
  const bytes = await readBytes(path.join(directory, "manifest.json"), MANIFEST_BYTES);
  const manifestSha256 = digest(bytes);
  if (expectedSha !== undefined && manifestSha256 !== expectedSha) throw new Error("backup manifest checksum mismatch");
  return { directory, manifestSha256, manifest: validateManifest(JSON.parse(bytes.toString("utf8")), id) };
}
export function snapshotComplete(manifest: Manifest) {
  return manifest.entries.length > 0 && !manifest.scan.truncated && !manifest.scan.rejected && !manifest.sourceDiscoveryTruncated;
}
export function snapshotSummary(directory: string, manifestSha256: string, m: Manifest): MemoryBackupSummary {
  return { id: m.id, createdAt: m.createdAt, directory, manifestSha256, scan: m.scan,
    compressedBytes: m.entries.reduce((sum, e) => sum + e.compressedBytes, 0), sourceDiscoveryTruncated: m.sourceDiscoveryTruncated,
    state: snapshotComplete(m) ? "snapshot" : "partial", consistency: "per-file-verified-not-point-in-time", offsite: false };
}
