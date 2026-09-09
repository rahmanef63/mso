// SERVER-ONLY. Path resolution + bounds for host filesystem access. mso runs
// as a host process, so /api/v1 talks to the FS directly (no agent). READ and
// WRITE roots are separate: reads can be wide (browse), writes are narrow so the
// browser shell can't clobber system files. Symlinks are realpath-resolved BEFORE the
// bounds check so a link can't escape a root. Configure with OS_FS_READ_ROOTS /
// OS_FS_WRITE_ROOTS (colon-separated; "~" = home, "/" = whole filesystem).
import type { FsRoot } from "@/lib/os-api/types";
import { promises as fs } from "fs";
import path from "path";
import { HostError } from "./host-error";
import { isCredentialPath } from "./path-credentials";
import { homeDir, isUnderRoot, readRootList, writeRootList } from "./path-roots";
export { appDir, isAppSecret, isCredentialPath, isSensitivePath, looseCredentialExcludes } from "./path-credentials";
export { appSecretCopyFilter, assertNoAppSecretDescendants, assertNoCredentialDescendants, assertNoSensitiveDescendants, sensitiveExcludes } from "./path-recursive";
export { homeDir, isUnderRoot, readRootList, writeRootList } from "./path-roots";

function assertNotCredential(real: string): void {
  if (isCredentialPath(real)) throw new HostError("Access to credential/sensitive files is blocked");
}

// Upload target guard — the write-side equivalent of safeWritePath for a file
// that will land at `full` inside the already-resolved `destReal`. Upload writers
// create intermediate dirs, so we can't realpath the (not-yet-existing) parent as
// safeWritePath does; instead: (1) `full` is lexically under destReal, (2) the
// DEEPEST EXISTING ancestor realpaths to still-under destReal (a symlinked
// intermediate dir can't redirect the write outside), and (3) `full` is not a
// credential/sensitive file — the same denylist writeFile/move/copy enforce but
// the upload path was skipping (a session could otherwise drop
// ~/.ssh/authorized_keys or ~/.mso/auth-devices.json via /api/v1/fs/upload).
export async function assertUploadTarget(full: string, destReal: string): Promise<void> {
  if (!isUnderRoot(full, destReal)) throw new HostError("Upload path escapes destination");
  for (let anc = path.dirname(full); ; ) {
    try {
      const real = await fs.realpath(anc);
      if (!isUnderRoot(real, destReal)) throw new HostError("Upload path escapes destination via symlink");
      break;
    } catch (e) {
      if (e instanceof HostError) throw e;
      const parent = path.dirname(anc);
      if (parent === anc) break; // walked to the fs root; nothing existed
      anc = parent;
    }
  }
  assertNotCredential(full);
}

async function realRoots(list: string[]): Promise<string[]> {
  return Promise.all(
    list.map(async (r) => {
      try {
        return await fs.realpath(r);
      } catch {
        return path.resolve(r);
      }
    }),
  );
}

function lexicalRoots(list: string[]): string[] {
  return list.map((root) => path.resolve(root));
}

// Realpath-resolved WRITE roots — shared by safeWritePath/assertNotRoot here and
// exec.ts's cwd bounds, so the realpath-fallback strategy lives in one place.
export async function resolveWriteRoots(): Promise<string[]> {
  return realRoots(writeRootList());
}

// READ: "/" is the filesystem root (browse-anywhere if a read root allows it);
// "~"/"" = home. Resolves symlinks, then asserts inside a read root.
export async function resolveReadable(requested: string): Promise<string> {
  const h = homeDir();
  let absolute: string;
  if (!requested || requested === "~") absolute = h;
  else if (requested.startsWith("~/")) absolute = path.join(h, requested.slice(2));
  else absolute = path.resolve(requested);
  const normalized = path.resolve(absolute);
  const configured = lexicalRoots(readRootList());

  // Keep each filesystem sink inside the SAFE branch of CodeQL's documented
  // path.relative sanitizer. Runtime-equivalent flags/helpers hide the proof from
  // the analyzer. The second check uses real paths, so symlinks cannot escape.
  for (const root of configured) {
    const relative = path.relative(root, normalized);
    if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
      continue;
    } else {
      const real = await fs.realpath(normalized);
      const realRoot = await fs.realpath(root).catch(() => path.resolve(root));
      const realRelative = path.relative(realRoot, real);
      if (
        realRelative === ".." ||
        realRelative.startsWith(".." + path.sep) ||
        path.isAbsolute(realRelative)
      ) {
        throw new HostError("Path outside readable roots");
      }
      assertNotCredential(real);
      return real;
    }
  }
  throw new HostError("Path outside readable roots");
}

// WRITE: "/" collapses to home (never the FS root). When !mustExist the parent
// is checked (target doesn't exist yet). Asserts inside a write root.
/** Resolve a mkdir -p target without requiring its immediate parent to exist.
 * The deepest existing ancestor is realpath-checked against the write root, so an
 * existing symlink component cannot redirect newly-created descendants outside the jail. */
export async function safeMkdirPath(requested: string): Promise<string> {
  const h = homeDir();
  let absolute: string;
  if (!requested || requested === "~" || requested === "/") absolute = h;
  else if (requested.startsWith("~/")) absolute = path.join(h, requested.slice(2));
  else absolute = path.resolve(requested);
  const normalized = path.resolve(absolute);
  const configured = lexicalRoots(writeRootList());

  for (const root of configured) {
    const lexicalPrefix = root === path.parse(root).root ? root : root + path.sep;
    if (normalized !== root && !normalized.startsWith(lexicalPrefix)) continue;
    const realRoot = await fs.realpath(root).catch(() => path.resolve(root));
    let ancestor = normalized;
    while (true) {
      try {
        const realAncestor = await fs.realpath(ancestor);
        if (!isUnderRoot(realAncestor, realRoot)) throw new HostError("Path outside writable roots");
        break;
      } catch (error) {
        if (error instanceof HostError) throw error;
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
        const parent = path.dirname(ancestor);
        if (parent === ancestor) throw new HostError("Path outside writable roots");
        ancestor = parent;
      }
    }
    assertNotCredential(normalized);
    return normalized;
  }
  throw new HostError("Path outside writable roots");
}

export async function safeWritePath(requested: string, mustExist: boolean): Promise<string> {
  const h = homeDir();
  let absolute: string;
  if (!requested || requested === "~" || requested === "/") absolute = h;
  else if (requested.startsWith("~/")) absolute = path.join(h, requested.slice(2));
  else absolute = path.resolve(requested);
  const normalized = path.resolve(absolute);
  const configured = lexicalRoots(writeRootList());
  const lexicalTarget = mustExist ? normalized : path.dirname(normalized);

  for (const root of configured) {
    // Use the canonical absolute-prefix containment pattern CodeQL recognizes.
    // `root + path.sep` prevents sibling-prefix tricks such as /safe vs /safe-evil.
    const lexicalPrefix = root === path.parse(root).root ? root : root + path.sep;
    if (lexicalTarget !== root && !lexicalTarget.startsWith(lexicalPrefix)) continue;

    const realRoot = await fs.realpath(root).catch(() => path.resolve(root));
    const realPrefix = realRoot === path.parse(realRoot).root ? realRoot : realRoot + path.sep;
    if (mustExist) {
      const real = await fs.realpath(normalized);
      if (real !== realRoot && !real.startsWith(realPrefix)) {
        throw new HostError("Path outside writable roots");
      }
      assertNotCredential(real);
      return real;
    }

    const parent = await fs.realpath(lexicalTarget);
    if (parent !== realRoot && !parent.startsWith(realPrefix)) {
      throw new HostError("Path outside writable roots");
    }
    const joined = path.join(parent, path.basename(normalized));
    assertNotCredential(joined);
    return joined;
  }
  throw new HostError("Path outside writable roots");
}

export async function assertNotRoot(p: string): Promise<void> {
  const rr = await realRoots(writeRootList());
  if (rr.some((r) => r === p)) throw new HostError("Refusing to modify a root directory");
}

function labelFor(p: string): string {
  const h = homeDir();
  if (p === "/") return "Filesystem";
  if (p === h) return "Home";
  if (p === path.join(h, "projects")) return "Projects";
  return path.basename(p) || p;
}

// Sidebar jump-points: Home + Projects, plus any extra read roots (e.g. "/").
export function resolveRoots(): FsRoot[] {
  const h = homeDir();
  const base: FsRoot[] = [
    { label: "Home", path: h },
    { label: "Projects", path: path.join(h, "projects") },
  ];
  const extra = readRootList()
    .filter((p) => p !== h && p !== path.join(h, "projects"))
    .map((p) => ({ label: labelFor(p), path: p }));
  return [...base, ...extra];
}
