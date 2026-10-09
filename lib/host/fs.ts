// SERVER-ONLY. Host filesystem ops behind /api/v1/fs/*. Reads follow READ
// roots (browse), mutations follow WRITE roots (see paths.ts). Returns the
// os-rr shapes directly so route handlers are thin.
import { promises as fs, constants as fsConstants, type ReadStream } from "fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { openReadableHandle, pinDirectory } from "./fs-descriptors";
import { copyPinned, removePinned } from "./fs-recursive";
import { randomUUID } from "node:crypto";
import type { FsUsage } from "@/lib/os-api/types";
import { HostError } from "./host-error";
import {
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
    handle = await openReadableHandle(p);
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
  const parent = await pinDirectory(path.dirname(p), true);
  let handle, tmp: string | undefined;
  try {
    tmp = await parent.child(`${path.basename(p)}.tmp-${randomUUID()}`);
    handle = await fs.open(tmp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
    await handle.writeFile(content ?? ""); await handle.close();
    await fs.rename(tmp, await parent.child(path.basename(p)));
  } finally { await handle?.close().catch(() => undefined); if (tmp) await fs.unlink(tmp).catch(() => undefined); await parent.handle.close(); }
}

export async function makeDir(requested: string): Promise<void> {
  const p = await safeMkdirPath(requested);
  const dir = await pinDirectory(p, true, true);
  await dir.handle.close();
}

export async function remove(requested: string): Promise<void> {
  const p = await safeWritePath(requested, true);
  await assertNotRoot(p);
  await assertNoCredentialDescendants(p);
  const parent = await pinDirectory(path.dirname(p), true);
  try { await removePinned(await parent.child(path.basename(p))); }
  finally { await parent.handle.close(); }
}

export async function move(from: string, to: string): Promise<void> {
  const src = await safeWritePath(from, true);
  await assertNotRoot(src);
  assertNoSensitiveDescendants(src); // fixed sensitive locations under a parent
  assertNoAppSecretDescendants(src); // the cockpit's own .env* under a parent
  await assertNoCredentialDescendants(src); // loose id_* / *.pem anywhere below
  const dest = await safeWritePath(to, false);
  const sourceParent = await pinDirectory(path.dirname(src), true);
  let destParent;
  try {
    destParent = await pinDirectory(path.dirname(dest), true);
    const source = await sourceParent.child(path.basename(src)), target = await destParent.child(path.basename(dest));
    try { await fs.rename(source, target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      await copyPinned(source, target);
      await removePinned(await sourceParent.child(path.basename(src)));
    }
  } finally { await sourceParent.handle.close(); await destParent?.handle.close(); }
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
  if (dest === src || dest.startsWith(src + path.sep)) throw new HostError("Cannot copy a directory into itself");
  const sourceParent = await pinDirectory(path.dirname(src), true);
  let destParent;
  try {
    destParent = await pinDirectory(path.dirname(dest), true);
    await copyPinned(await sourceParent.child(path.basename(src)), await destParent.child(path.basename(dest)));
  } finally { await sourceParent.handle.close(); await destParent?.handle.close(); }
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
): Promise<{ path: string; size: number; mime: string; handle: FileHandle }> {
  const p = await resolveReadable(requested);
  const handle = await openReadableHandle(p);
  try {
    const st = await handle.stat();
    if (!st.isFile()) throw new HostError(st.isDirectory() ? "Is a directory" : "Not a regular file");
    return { path: p, size: st.size, mime: mimeFor(p), handle };
  } catch (error) { await handle.close(); throw error; }
}

// Transfer the verified handle to the stream, optionally for a byte range.
export function fileStream(handle: FileHandle, start?: number, end?: number): ReadStream {
  return handle.createReadStream({ autoClose: true, ...(start !== undefined ? { start, end } : {}) });
}
