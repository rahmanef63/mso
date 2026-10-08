// SERVER-ONLY. Host filesystem ops behind /api/v1/fs/*. Reads follow READ
// roots (browse), mutations follow WRITE roots (see paths.ts). Returns the
// os-rr shapes directly so route handlers are thin.
import { promises as fs, constants as fsConstants, createReadStream, type ReadStream } from "fs";
import { randomUUID } from "node:crypto";
import type { FsUsage } from "@/lib/os-api/types";
import { HostError } from "./host-error";
import {
  appSecretCopyFilter,
  assertNoAppSecretDescendants,
  assertNoCredentialDescendants,
  assertNoSensitiveDescendants,
  assertNotRoot,
  resolveReadable,
  safeMkdirPath,
  safeWritePath,
} from "./paths";

export { listDir, searchFs } from "./fs-enumeration";

export async function readFile(requested: string): Promise<string> {
  const p = await resolveReadable(requested);
  let handle;
  try {
    handle = await fs.open(p, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile()) throw new HostError(stat.isDirectory() ? "Is a directory" : "Not a regular file");
    if (stat.size > 5_000_000) throw new HostError("File too large to read (max 5 MiB)");
    return await handle.readFile("utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") throw new HostError("Refusing symlink file");
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function writeFile(requested: string, content: string): Promise<void> {
  const p = await safeWritePath(requested, false);
  await assertNotRoot(p);
  const tmp = `${p}.tmp-${randomUUID()}`;
  const handle = await fs.open(tmp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(content ?? ""); await handle.close(); await fs.rename(tmp, p); }
  finally { await handle.close().catch(() => undefined); await fs.unlink(tmp).catch(() => undefined); }
}

export async function makeDir(requested: string): Promise<void> {
  const p = await safeMkdirPath(requested);
  await fs.mkdir(p, { recursive: true });
}

export async function remove(requested: string): Promise<void> {
  const p = await safeWritePath(requested, true);
  await assertNotRoot(p);
  await assertNoCredentialDescendants(p);
  await fs.rm(p, { recursive: true, force: true });
}

export async function move(from: string, to: string): Promise<void> {
  const src = await safeWritePath(from, true);
  await assertNotRoot(src);
  assertNoSensitiveDescendants(src); // fixed sensitive locations under a parent
  assertNoAppSecretDescendants(src); // the cockpit's own .env* under a parent
  await assertNoCredentialDescendants(src); // loose id_* / *.pem anywhere below
  const dest = await safeWritePath(to, false);
  try {
    await fs.rename(src, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EXDEV") {
      await fs.cp(src, dest, { recursive: true });
      await fs.rm(src, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}

export async function copy(from: string, to: string): Promise<void> {
  const src = await safeWritePath(from, true);
  assertNoSensitiveDescendants(src); // fixed sensitive locations under a parent
  // The app's own .env* are intentionally filtered below; every other credential
  // descendant (including arbitrary nested id_* / *.pem) makes the copy fail closed.
  await assertNoCredentialDescendants(src, { ignoreAppSecrets: true });
  const dest = await safeWritePath(to, false);
  // Skip the cockpit's own .env* rather than refuse the copy — on the default
  // roots APP_DIR sits under ~/projects, so refusing would block copying it.
  await fs.cp(src, dest, { recursive: true, filter: appSecretCopyFilter(src) });
}

export async function usage(requested: string): Promise<FsUsage> {
  const p = await resolveReadable(requested || "~");
  const s = await fs.statfs(p);
  const total = s.blocks * s.bsize;
  const free = s.bfree * s.bsize;
  return { used: total - free, total };
}

// --- raw byte serving (images / video / audio / pdf preview) ---

// PASSIVE MEDIA TYPES ONLY. Everything absent from this table is served as
// application/octet-stream, which browsers download instead of executing — and that
// is doing real work: `text/html` here would turn any host file into an ACTIVE
// document on the cockpit's own origin, with the session cookie attached (the exact
// hazard the SVG sandbox header below exists for). The Preview app reads text and
// HTML with fetch() and renders it in a sandboxed frame precisely so this table
// never has to grow an executable type. Do not add html/xhtml/xml here.
const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", jfif: "image/jpeg",
  gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", avif: "image/avif",
  bmp: "image/bmp", ico: "image/x-icon", tif: "image/tiff", tiff: "image/tiff",
  heic: "image/heic", heif: "image/heif",
  mp4: "video/mp4", m4v: "video/x-m4v", webm: "video/webm", mov: "video/quicktime",
  mkv: "video/x-matroska", avi: "video/x-msvideo", ogv: "video/ogg",
  mpg: "video/mpeg", mpeg: "video/mpeg", "3gp": "video/3gpp", wmv: "video/x-ms-wmv",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", flac: "audio/flac",
  aiff: "audio/aiff", aif: "audio/aiff", ogg: "audio/ogg", oga: "audio/ogg",
  opus: "audio/opus", aac: "audio/aac", wma: "audio/x-ms-wma",
  pdf: "application/pdf", json: "application/json", zip: "application/zip",
};

export function mimeFor(p: string): string {
  return MIME[p.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

// Resolve + stat a readable file (within READ roots) for byte streaming.
export async function statReadable(
  requested: string,
): Promise<{ path: string; size: number; mime: string }> {
  const p = await resolveReadable(requested);
  const st = await fs.stat(p);
  if (st.isDirectory()) throw new HostError("Is a directory");
  return { path: p, size: st.size, mime: mimeFor(p) };
}

// Node read stream for a (pre-resolved) path, optionally a byte range.
export function fileStream(p: string, start?: number, end?: number): ReadStream {
  return start !== undefined ? createReadStream(p, { start, end }) : createReadStream(p);
}
