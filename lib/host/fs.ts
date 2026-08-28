// SERVER-ONLY. Host filesystem ops behind /api/v1/fs/*. Reads follow READ
// roots (browse), mutations follow WRITE roots (see paths.ts). Returns the
// os-rr shapes directly so route handlers are thin.
import { promises as fs, constants as fsConstants, createReadStream, type ReadStream } from "fs";
import path from "path";
import type { FsList, FsUsage } from "@/lib/os-api/types";
import { HostError } from "./host-error";
import { projectAliasTarget } from "./project-aliases";
import {
  appSecretCopyFilter,
  assertNoAppSecretDescendants,
  assertNoCredentialDescendants,
  assertNoSensitiveDescendants,
  assertNotRoot,
  isSensitivePath,
  resolveReadable,
  resolveRoots,
  safeWritePath,
} from "./paths";

export async function listDir(requested: string, includeHidden = true): Promise<FsList> {
  const real = await resolveReadable(requested || "~");
  const stat = await fs.stat(real);
  if (!stat.isDirectory()) throw new HostError("Not a directory");

  const raw = await fs.readdir(real, { withFileTypes: true });
  const entries = raw
    .filter((e) => includeHidden || !e.name.startsWith("."))
    // Sensitive credential dirs don't even appear in listings (they're also
    // unreadable via resolveReadable — this just removes the temptation).
    .filter((e) => !isSensitivePath(path.join(real, e.name)))
    .map((e) => {
      const isDir = e.isDirectory() || e.isSymbolicLink();
      return {
        name: e.name,
        kind: isDir ? ("dir" as const) : ("file" as const),
        size: 0, // per-entry stat skipped for speed (matches prior agent behavior)
        ext: e.name.includes(".") ? e.name.split(".").pop() : undefined,
      };
    })
    .sort((a, b) => (a.kind !== b.kind ? (a.kind === "dir" ? -1 : 1) : a.name.localeCompare(b.name)));

  const parentCandidate = path.dirname(real);
  let parent: string | null = null;
  if (parentCandidate !== real) {
    try {
      await resolveReadable(parentCandidate);
      parent = parentCandidate;
    } catch {
      parent = null;
    }
  }
  return { path: real, entries, roots: resolveRoots(), parent };
}

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
  const tmp = `${p}.tmp-${process.pid}`;
  await fs.writeFile(tmp, content ?? "", { mode: 0o644 });
  await fs.rename(tmp, p);
}

export async function makeDir(requested: string): Promise<void> {
  const p = await safeWritePath(requested, false);
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

// Folder name search under a READ-root dir (default ~/projects). Depth/result
// bounded; skips heavy/noise dirs so it stays snappy on a real projects tree.
const SEARCH_SKIP = new Set([
  "node_modules", ".git", ".next", "dist", "build", ".cache", "vendor", ".pnpm-store", ".turbo",
]);

export async function searchFs(
  query: string,
  opts: { root?: string; max?: number; maxDepth?: number } = {},
): Promise<{ name: string; path: string; kind: "dir" }[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const root = await resolveReadable(opts.root ?? "~/projects"); // jailed to read roots
  const max = opts.max ?? 30;
  const maxDepth = opts.maxDepth ?? 6;
  const out: { name: string; path: string; kind: "dir" }[] = [];
  const alias = projectAliasTarget(query);
  if (alias) {
    const candidate = await resolveReadable(path.join(root, alias)).catch(() => null);
    if (candidate && (await fs.stat(candidate).catch(() => null))?.isDirectory())
      return [{ name: alias, path: candidate, kind: "dir" }];
  }

  async function walk(dir: string, depth: number): Promise<void> {
    if (out.length >= max || depth > maxDepth) return;
    let ents: import("fs").Dirent[];
    try {
      ents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (out.length >= max) return;
      if (!e.isDirectory()) continue;
      const hitPath = path.join(dir, e.name);
      if (e.name.toLowerCase().includes(q) && !out.some((hit) => hit.path === hitPath)) out.push({ name: e.name, path: hitPath, kind: "dir" });
      if (!SEARCH_SKIP.has(e.name) && !e.name.startsWith(".")) await walk(path.join(dir, e.name), depth + 1);
    }
  }
  await walk(root, 0);
  return out;
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
  pdf: "application/pdf",
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
