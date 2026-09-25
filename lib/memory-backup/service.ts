import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { gzip, gunzipSync } from "node:zlib";
import { promisify } from "node:util";
import { memorySources, type Source } from "./sources";
import { scanSources, LIMITS, type Limits, type Scan } from "./scan";
import { digest, readBytes, safeRelative, writeExclusive } from "./io";
import type { MemoryBackupSummary, MemoryBackupVerification } from "@/lib/contracts/memory-backup";

const compress = promisify(gzip);
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
type Entry = { name: string; bytes: number; sha256: string; compressedBytes: number; compressedSha256: string };
type Manifest = { version: 1; id: string; createdAt: string; scan: Scan; sourceDiscoveryTruncated: boolean; entries: Entry[] };
export const memoryBackupRoot = () => path.join(os.homedir(), ".mso", "backups", "memory");
function target(root: string, id: string) {
  if (!ID.test(id)) throw new Error("invalid memory backup id");
  return path.join(root, id);
}

export async function previewMemoryBackup() {
  const inventory = await memorySources();
  const scan = await scanSources(inventory.sources, LIMITS);
  return {
    scan, sourceDiscoveryTruncated: inventory.incomplete, sourceCount: inventory.sources.length,
    directory: memoryBackupRoot(), limits: LIMITS, offsite: false,
    scope: "Existing allowlisted memory, session, workflow and organization sources; not a full VPS or database backup. Credential stores and browser profiles are excluded. Private source content remains private.",
    consistency: "Per-file verified copies, not a transactionally consistent point-in-time snapshot.",
  };
}

/** Core accepts only server-resolved sources. Never pass browser-provided paths here. */
export async function createSnapshot(sources: Source[], root: string, sourceDiscoveryTruncated = false, limits: Limits = LIMITS): Promise<MemoryBackupSummary> {
  const id = randomUUID(), directory = target(root, id), createdAt = new Date().toISOString();
  const entries: Entry[] = [];
  let compressedBytes = 0;
  const scan = await scanSources(sources, limits, async (name, bytes) => {
    const packed = await compress(bytes, { level: 3 });
    await writeExclusive(path.join(directory, "files", `${name}.gz`), packed);
    const check = await readBytes(path.join(directory, "files", `${name}.gz`), limits.fileBytes + 65536);
    if (digest(check) !== digest(packed)) throw new Error("backup copy verification failed");
    entries.push({ name, bytes: bytes.length, sha256: digest(bytes), compressedBytes: packed.length, compressedSha256: digest(packed) });
    compressedBytes += packed.length;
  });
  const manifest: Manifest = { version: 1, id, createdAt, scan, sourceDiscoveryTruncated, entries };
  const body = Buffer.from(JSON.stringify(manifest));
  if (body.length > 8 * 1024 * 1024) throw new Error("backup manifest limit exceeded; partial files preserved");
  await writeExclusive(path.join(directory, "manifest.json"), body);
  const manifestSha256 = digest(await readBytes(path.join(directory, "manifest.json"), 8 * 1024 * 1024));
  if (manifestSha256 !== digest(body)) throw new Error("backup manifest verification failed");
  return { id, createdAt, directory, manifestSha256, scan, compressedBytes, sourceDiscoveryTruncated,
    state: scan.files > 0 && !scan.truncated && !scan.rejected && !sourceDiscoveryTruncated ? "snapshot" : "partial",
    consistency: "per-file-verified-not-point-in-time", offsite: false };
}

export async function createMemoryBackup() {
  const space = await fs.statfs(os.homedir());
  if (space.bavail * space.bsize < LIMITS.bytes * 3 + 1024 * 1024 * 1024) throw new Error("insufficient headroom for a backup and isolated restore; source files preserved");
  const inventory = await memorySources();
  return createSnapshot(inventory.sources, memoryBackupRoot(), inventory.incomplete);
}

/** Restore rehearsal writes a NEW isolated tree only; never restore over source. */
export async function verifySnapshot(root: string, id: string, expectedManifestSha256: string): Promise<MemoryBackupVerification> {
  if (!/^[a-f0-9]{64}$/.test(expectedManifestSha256)) throw new Error("manifest checksum required");
  const directory = target(root, id), bytes = await readBytes(path.join(directory, "manifest.json"), 8 * 1024 * 1024);
  if (digest(bytes) !== expectedManifestSha256) throw new Error("backup manifest checksum mismatch");
  const manifest = JSON.parse(bytes.toString("utf8")) as Manifest;
  if (manifest.version !== 1 || manifest.id !== id || !Array.isArray(manifest.entries) || manifest.entries.length > LIMITS.files || !manifest.scan) throw new Error("invalid backup manifest");
  const names = new Set<string>();
  let total = 0;
  for (const row of manifest.entries) {
    if (!row || !safeRelative(row.name) || names.has(row.name) || !Number.isSafeInteger(row.bytes) || row.bytes < 0 || row.bytes > LIMITS.fileBytes || !Number.isSafeInteger(row.compressedBytes) || row.compressedBytes < 0 || row.compressedBytes > LIMITS.fileBytes + 65536 || !/^[a-f0-9]{64}$/.test(row.sha256) || !/^[a-f0-9]{64}$/.test(row.compressedSha256)) throw new Error("unsafe backup entry");
    names.add(row.name); total += row.bytes;
    if (total > LIMITS.bytes) throw new Error("restore size limit exceeded");
  }
  const restoreDirectory = path.join(directory, `restore-check-${randomUUID()}`);
  let restoredFiles = 0;
  for (const row of manifest.entries) {
    const packed = await readBytes(path.join(directory, "files", `${row.name}.gz`), row.compressedBytes);
    if (digest(packed) !== row.compressedSha256) throw new Error("backup file checksum mismatch");
    const plain = gunzipSync(packed, { maxOutputLength: LIMITS.fileBytes });
    if (plain.length !== row.bytes || digest(plain) !== row.sha256) throw new Error("restored content checksum mismatch");
    const destination = path.join(restoreDirectory, row.name);
    await writeExclusive(destination, plain);
    if (digest(await readBytes(destination, LIMITS.fileBytes)) !== row.sha256) throw new Error("restore rehearsal checksum mismatch");
    restoredFiles++;
  }
  const result = { id, integrity: true, restoredFiles, restoreDirectory,
    complete: restoredFiles > 0 && !manifest.scan.truncated && !manifest.scan.rejected && !manifest.sourceDiscoveryTruncated,
    sourceWritesPerformed: 0 as const };
  await writeExclusive(path.join(restoreDirectory, "verification.json"), Buffer.from(JSON.stringify(result)));
  return result;
}

export async function verifyMemoryBackup(id: string, expectedManifestSha256: string) {
  return verifySnapshot(memoryBackupRoot(), id, expectedManifestSha256);
}
