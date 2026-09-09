import { existsSync, promises as fs, readdirSync } from "fs";
import path from "path";
import { HostError } from "./host-error";
import { appDir, isAppSecret, isCredentialPath, SENSITIVE_HOME } from "./path-credentials";
import { homeDir, isUnderRoot } from "./path-roots";

/** The app's own secrets sitting UNDER `realBase` — empty when APP_DIR is not a
 *  descendant, or holds no secrets. The per-path gate is exact-or-under, so a
 *  recursive walk starting at a PARENT of APP_DIR never consults it for these. */
function appSecretsUnder(realBase: string): string[] {
  const dir = appDir();
  if (dir === realBase || !isUnderRoot(dir, realBase)) return [];
  try {
    return readdirSync(dir)
      .map((n) => path.join(dir, n))
      .filter((p) => isAppSecret(p));
  } catch {
    return [];
  }
}

// The per-path gate above is exact-or-under, so a PARENT of a denied entry never
// matches it — and the two recursive callers (`zip -r`, `fs.cp {recursive}`) walk
// straight past the gate into the children. Both need the nested locations named
// explicitly. Filtered by existence so the callers never refuse (or exclude) over
// a path that isn't on this box.
function sensitiveUnder(realBase: string): string[] {
  if (process.env.OS_FS_ALLOW_SENSITIVE === "1") return [];
  const h = homeDir();
  return [...SENSITIVE_HOME, ".mso"]
    .map((n) => path.join(h, n))
    .filter((p) => p !== realBase && isUnderRoot(p, realBase) && existsSync(p));
}

// Recursive READ (zip): NARROW the archive rather than refuse it — same shape as
// appSecretExcludes. Info-ZIP `*` spans `/` and entries are stored relative to the
// archive base, so `rel` drops a file and `rel/*` drops a whole dir.
export function sensitiveExcludes(realBase: string): string[] {
  return sensitiveUnder(realBase).flatMap((p) => {
    const rel = path.relative(realBase, p);
    return [rel, `${rel}/*`];
  });
}

// Recursive WRITE (copy/move): REFUSE. Filtering is wrong for move — its EXDEV
// branch is cp-then-rm, so a skipped file would be deleted instead of moved. And
// a completed move relocates credentials OUT of their denylisted path, which makes
// them plainly readable at the destination (relocate-then-read escalation).
export function assertNoSensitiveDescendants(real: string): void {
  const hit = sensitiveUnder(real)[0];
  if (hit)
    throw new HostError(
      `Refusing: this directory contains a credential path (${path.relative(real, hit)})`,
    );
}

/** Walk a recursive mutation source and apply the same credential predicate used
 * by per-path reads/writes to every descendant. Directory operations otherwise
 * let fs.cp/fs.rename/fs.rm walk past the top-level gate. Symlinks are inspected
 * by their own path/name but never followed, so this guard cannot escape the
 * already-resolved mutation root or traverse a cycle. */
export async function assertNoCredentialDescendants(
  realBase: string,
  options: { ignoreAppSecrets?: boolean } = {},
): Promise<void> {
  const rootStat = await fs.lstat(realBase).catch(() => null);
  if (!rootStat?.isDirectory()) return;

  const stack = [realBase];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      throw new HostError(`Refusing recursive mutation: cannot inspect ${path.relative(realBase, dir) || "."}`);
    }
    for (const entry of entries) {
      const child = path.join(dir, entry.name);
      const credential = isCredentialPath(child);
      const ignoredAppSecret = options.ignoreAppSecrets === true && isAppSecret(child);
      if (credential && !ignoredAppSecret) {
        throw new HostError(
          `Refusing: this directory contains a credential path (${path.relative(realBase, child)})`,
        );
      }
      if (entry.isDirectory()) stack.push(child);
    }
  }
}

// The app's own `.env*` needed the narrower fix the ~/ list can't give: on the
// DEFAULT roots (~ and ~/projects) APP_DIR is a descendant of a copyable dir, so
// `copy(~/projects, ~/backup)` walked past the per-path gate and duplicated
// .env.local somewhere /api/v1/fs/read serves. Refusing outright would block
// copying ~/projects, which is an ordinary thing to do — so copy SKIPS them and
// only move refuses.
//
// Recursive COPY: a filter for `fs.cp`. Returns undefined when there is nothing
// to skip, so the ordinary copy path stays exactly as it was.
export function appSecretCopyFilter(realBase: string): ((src: string) => boolean) | undefined {
  const secrets = new Set(appSecretsUnder(realBase));
  return secrets.size ? (src: string) => !secrets.has(src) : undefined;
}

// Recursive MOVE: REFUSE, for the same reason the ~/ list does. A filter is wrong
// here — the EXDEV branch is cp-then-rm, so a skipped secret would be DELETED
// rather than moved, and a completed move relocates it out of its denylisted path
// and makes it plainly readable at the destination.
export function assertNoAppSecretDescendants(real: string): void {
  const hit = appSecretsUnder(real)[0];
  if (hit)
    throw new HostError(
      `Refusing: this directory contains the cockpit's own secrets (${path.relative(real, hit)})`,
    );
}

