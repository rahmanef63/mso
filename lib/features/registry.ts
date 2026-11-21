// Owner-private registry & asset loader for modular features installed under
// ~/.mso/features/<id>/. Enables independent feature updates without rebuilding
// or restarting the core MSO Next.js runtime.
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  cpSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { roleAtLeast, type DeviceRole } from "@/lib/auth/roles";
import {
  isValidFeatureId,
  isValidRelativeEntry,
  validateModularManifest,
  type ModularFeatureManifest,
  type ModularFeatureSnapshot,
} from "@/lib/contracts/modular-feature";

const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_ASSET_BYTES = 5 * 1024 * 1024;
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

export class ModularFeatureError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ModularFeatureError";
    this.status = status;
  }
}

export function resolveFeaturesRoot(override?: string): string {
  const configured = override ?? process.env.MSO_FEATURES_DIR;
  if (configured && configured.trim()) return path.resolve(/* turbopackIgnore: true */ configured.trim());
  return path.join(/* turbopackIgnore: true */ os.homedir(), ".mso", "features");
}

function sha256Integrity(bytes: Buffer): string {
  return `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
}

function assertContained(baseDir: string, targetPath: string): string {
  const baseReal = realpathSync(/* turbopackIgnore: true */ baseDir);
  const targetReal = realpathSync(/* turbopackIgnore: true */ targetPath);
  const rel = path.relative(baseReal, targetReal);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new ModularFeatureError("asset_path_outside_package", 403);
  }
  return targetReal;
}

/**
 * Race-free file read: opens once with O_NOFOLLOW, validates type/size on the
 * open file descriptor via fstatSync, and reads directly from that descriptor.
 */
function readRegularFileNoFollow(filePath: string, maxBytes: number): Buffer {
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
  let fd: number;
  try {
    fd = openSync(/* turbopackIgnore: true */ filePath, flags);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") throw new ModularFeatureError("asset_not_found", 404);
    if (code === "ELOOP") throw new ModularFeatureError("asset_path_outside_package", 403);
    throw new ModularFeatureError("asset_unreadable", 400);
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes) {
      throw new ModularFeatureError("asset_unreadable", 413);
    }
    const buf = Buffer.allocUnsafe(stat.size);
    let offset = 0;
    while (offset < stat.size) {
      const n = readSync(fd, buf, offset, stat.size - offset, offset);
      if (n <= 0) break;
      offset += n;
    }
    return offset === stat.size ? buf : buf.subarray(0, offset);
  } finally {
    closeSync(fd);
  }
}

function readManifestForDir(featureDir: string, expectedId: string): ModularFeatureManifest | null {
  const manifestPath = path.join(/* turbopackIgnore: true */ featureDir, "manifest.json");
  let bytes: Buffer;
  try {
    bytes = readRegularFileNoFollow(manifestPath, MAX_MANIFEST_BYTES);
  } catch {
    return null;
  }
  const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  const manifest = validateModularManifest(parsed);
  if (manifest.id !== expectedId) return null;
  const distDir = path.join(/* turbopackIgnore: true */ featureDir, "dist");
  const entryPath = path.join(/* turbopackIgnore: true */ distDir, manifest.entry);
  try {
    assertContained(distDir, entryPath);
  } catch {
    return null;
  }
  return manifest;
}

export function listModularFeatures(role: DeviceRole, rootOverride?: string): ModularFeatureSnapshot {
  const root = resolveFeaturesRoot(rootOverride);
  let entries;
  try {
    entries = readdirSync(/* turbopackIgnore: true */ root, { withFileTypes: true });
  } catch {
    return { schemaVersion: 1, features: [] };
  }
  const features = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isValidFeatureId(entry.name)) continue;
    try {
      const manifest = readManifestForDir(path.join(/* turbopackIgnore: true */ root, entry.name), entry.name);
      if (!manifest || !roleAtLeast(role, manifest.minRole)) continue;
      features.push({
        id: manifest.id,
        version: manifest.version,
        title: manifest.title,
        description: manifest.description,
        slug: manifest.slug,
        minRole: manifest.minRole,
        entry: manifest.entry,
        defaultSize: manifest.defaultSize,
        updatedAt: manifest.updatedAt,
      });
    } catch {
      // Ignore malformed or untrusted package folders without breaking valid features.
    }
  }
  features.sort((a, b) => a.id.localeCompare(b.id));
  return { schemaVersion: 1, features };
}

export function readModularFeatureAsset(
  id: string,
  relPath: string,
  role: DeviceRole,
  rootOverride?: string,
): { bytes: Buffer; contentType: string; version: string } {
  if (!isValidFeatureId(id)) throw new ModularFeatureError("invalid_feature_id", 400);
  if (!isValidRelativeEntry(relPath)) throw new ModularFeatureError("invalid_asset_path", 400);
  const root = resolveFeaturesRoot(rootOverride);
  const featureDir = path.join(/* turbopackIgnore: true */ root, id);
  const manifest = readManifestForDir(featureDir, id);
  if (!manifest) throw new ModularFeatureError("feature_not_found", 404);
  if (!roleAtLeast(role, manifest.minRole)) throw new ModularFeatureError("role_forbidden", 403);

  const distDir = path.join(/* turbopackIgnore: true */ featureDir, "dist");
  const candidate = path.join(/* turbopackIgnore: true */ distDir, relPath);
  const bytes = readRegularFileNoFollow(candidate, MAX_ASSET_BYTES);
  const realAsset = assertContained(distDir, candidate);
  if (relPath === manifest.entry && sha256Integrity(bytes) !== manifest.integrity) {
    throw new ModularFeatureError("entry_integrity_mismatch", 500);
  }
  const ext = path.extname(realAsset).toLowerCase();
  return {
    bytes,
    contentType: MIME_TYPES[ext] ?? "application/octet-stream",
    version: manifest.version,
  };
}

export function installModularFeaturePackage(
  sourceDir: string,
  rootOverride?: string,
): ModularFeatureManifest {
  const srcManifestPath = path.join(/* turbopackIgnore: true */ sourceDir, "manifest.json");
  const srcDist = path.join(/* turbopackIgnore: true */ sourceDir, "dist");
  const raw = JSON.parse(readRegularFileNoFollow(srcManifestPath, MAX_MANIFEST_BYTES).toString("utf8")) as Record<string, unknown>;
  const entry = typeof raw.entry === "string" ? raw.entry : "index.html";
  if (!isValidRelativeEntry(entry)) throw new ModularFeatureError("invalid entry path", 400);
  const entryPath = path.join(/* turbopackIgnore: true */ srcDist, entry);
  const entryBytes = readRegularFileNoFollow(entryPath, MAX_ASSET_BYTES);
  assertContained(srcDist, entryPath);

  const manifest = validateModularManifest({
    ...raw,
    schemaVersion: 1,
    entry,
    integrity: sha256Integrity(entryBytes),
    updatedAt: new Date().toISOString(),
  });

  const root = resolveFeaturesRoot(rootOverride);
  mkdirSync(/* turbopackIgnore: true */ root, { recursive: true, mode: 0o700 });
  const target = path.join(/* turbopackIgnore: true */ root, manifest.id);
  const staging = path.join(/* turbopackIgnore: true */ root, `.staging-${manifest.id}-${Date.now()}`);
  const backup = path.join(/* turbopackIgnore: true */ root, `.previous-${manifest.id}-${Date.now()}`);
  rmSync(/* turbopackIgnore: true */ staging, { recursive: true, force: true });
  mkdirSync(/* turbopackIgnore: true */ staging, { recursive: true, mode: 0o700 });
  cpSync(/* turbopackIgnore: true */ srcDist, path.join(/* turbopackIgnore: true */ staging, "dist"), { recursive: true, dereference: false });
  writeFileSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

  let hadBackup = false;
  try {
    renameSync(/* turbopackIgnore: true */ target, backup);
    hadBackup = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
  }
  try {
    renameSync(/* turbopackIgnore: true */ staging, target);
    if (hadBackup) rmSync(/* turbopackIgnore: true */ backup, { recursive: true, force: true });
  } catch (err) {
    if (hadBackup) renameSync(/* turbopackIgnore: true */ backup, target);
    rmSync(/* turbopackIgnore: true */ staging, { recursive: true, force: true });
    throw err;
  }
  return manifest;
}
