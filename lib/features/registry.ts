// Owner-private registry & asset loader for modular features installed under
// ~/.mso/features/<id>/. Enables independent feature updates without rebuilding
// or restarting the core MSO Next.js runtime.
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, renameSync, writeFileSync } from "node:fs";
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

function readManifestForDir(featureDir: string, expectedId: string): ModularFeatureManifest | null {
  const manifestPath = path.join(/* turbopackIgnore: true */ featureDir, "manifest.json");
  if (!existsSync(/* turbopackIgnore: true */ manifestPath)) return null;
  if (lstatSync(/* turbopackIgnore: true */ manifestPath).isSymbolicLink()) return null;
  const parsed = JSON.parse(readFileSync(/* turbopackIgnore: true */ manifestPath, "utf8")) as unknown;
  const manifest = validateModularManifest(parsed);
  if (manifest.id !== expectedId) return null;
  const distDir = path.join(/* turbopackIgnore: true */ featureDir, "dist");
  const entryPath = path.join(/* turbopackIgnore: true */ distDir, manifest.entry);
  if (!existsSync(/* turbopackIgnore: true */ distDir) || !existsSync(/* turbopackIgnore: true */ entryPath)) return null;
  assertContained(distDir, entryPath);
  return manifest;
}

export function listModularFeatures(role: DeviceRole, rootOverride?: string): ModularFeatureSnapshot {
  const root = resolveFeaturesRoot(rootOverride);
  if (!existsSync(/* turbopackIgnore: true */ root)) return { schemaVersion: 1, features: [] };
  const features = [];
  for (const entry of readdirSync(/* turbopackIgnore: true */ root, { withFileTypes: true })) {
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
  if (!existsSync(/* turbopackIgnore: true */ featureDir)) throw new ModularFeatureError("feature_not_found", 404);

  const manifest = readManifestForDir(featureDir, id);
  if (!manifest) throw new ModularFeatureError("feature_not_found", 404);
  if (!roleAtLeast(role, manifest.minRole)) throw new ModularFeatureError("role_forbidden", 403);

  const distDir = path.join(/* turbopackIgnore: true */ featureDir, "dist");
  const candidate = path.join(/* turbopackIgnore: true */ distDir, relPath);
  if (!existsSync(/* turbopackIgnore: true */ candidate)) throw new ModularFeatureError("asset_not_found", 404);
  const realAsset = assertContained(distDir, candidate);
  const stat = lstatSync(/* turbopackIgnore: true */ realAsset);
  if (!stat.isFile() || stat.size > MAX_ASSET_BYTES) {
    throw new ModularFeatureError("asset_unreadable", 413);
  }
  const bytes = readFileSync(/* turbopackIgnore: true */ realAsset);
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
  if (!existsSync(/* turbopackIgnore: true */ srcManifestPath) || !existsSync(/* turbopackIgnore: true */ srcDist)) {
    throw new ModularFeatureError("package requires manifest.json and dist/ directory", 400);
  }
  const raw = JSON.parse(readFileSync(/* turbopackIgnore: true */ srcManifestPath, "utf8")) as Record<string, unknown>;
  const entry = typeof raw.entry === "string" ? raw.entry : "index.html";
  if (!isValidRelativeEntry(entry)) throw new ModularFeatureError("invalid entry path", 400);
  const entryPath = path.join(/* turbopackIgnore: true */ srcDist, entry);
  if (!existsSync(/* turbopackIgnore: true */ entryPath)) throw new ModularFeatureError(`missing dist/${entry}`, 400);
  assertContained(srcDist, entryPath);

  const entryBytes = readFileSync(/* turbopackIgnore: true */ entryPath);
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

  if (existsSync(/* turbopackIgnore: true */ target)) renameSync(/* turbopackIgnore: true */ target, backup);
  try {
    renameSync(/* turbopackIgnore: true */ staging, target);
    rmSync(/* turbopackIgnore: true */ backup, { recursive: true, force: true });
  } catch (err) {
    if (existsSync(/* turbopackIgnore: true */ backup) && !existsSync(/* turbopackIgnore: true */ target)) renameSync(/* turbopackIgnore: true */ backup, target);
    rmSync(/* turbopackIgnore: true */ staging, { recursive: true, force: true });
    throw err;
  }
  return manifest;
}
