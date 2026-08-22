// WHICH directories may hold projects — the authorization half of project discovery.
// The walk itself lives in project-roots.ts.
//
// EVERY configured project container, not just ~/projects — and never one byte
// outside them.
//
// MSO used to hard-code `~/projects` as "where projects live". That was invisible
// scoping: an owner who set OS_FS_READ_ROOTS to two or three checkout areas still
// had project resolution, skill discovery and the MCP bootstrap looking at exactly
// one of them, and nothing said so.
//
// A container is a directory that HOLDS projects: every AUTHORIZED read root, plus
// its `projects/` child when that child is a REAL directory whose realpath stays
// inside that same root. A symlinked `projects/` is refused outright — even when it
// currently points somewhere legal — because accepting it is a TOCTOU bet: the link
// can be repointed between the check and the walk. `/` is never a container either:
// "/" as a read root means browse-anywhere, not "every top-level system directory is
// a project".
//
// Everything the scan omits is REPORTED. `truncated:false` means "this is all of it";
// hitting a root, entry, project or time cap sets `truncated:true` with a named
// reason. A silent slice that claims completeness is worse than a refusal.
import { promises as fs } from "fs";
import path from "path";
import { isCredentialPath, isUnderRoot } from "./paths";
import { PROJECT_LIMITS, shortId, type AuthorizedRoot } from "./project-identity";
import { allConfiguredRoots, authorizedRoots } from "./project-authorized-roots";

export { allConfiguredRoots, authorizedRoots };
export { PROJECT_LIMITS, shortId, containerKey } from "./project-identity";
export type { AuthorizedRoot } from "./project-identity";





export type { ScanCursor, ScanReport } from "./project-scan-types";
export { configuredRootPaths, overflowRoots } from "./project-authorized-roots";

export type ProjectContainer = {
  /** Short sha256 of the canonical container path. The DERIVED `projects/` child gets
   *  its own id on purpose: without it `~/widget` and `~/projects/widget` would share
   *  a project id and one would shadow the other. */
  id: string;
  path: string;
  authorizedRootId: string;
  authorizedRoot: string;
  derived: boolean;
  /** (rootIndex, containerIndex) is this container's exact address for a cursor. */
  rootIndex: number;
  containerIndex: number;
};

export type ProjectRow = {
  /** Globally unique: `<rootId>/<name>`. */
  id: string;
  name: string;
  path: string;
  /** Id of the container this project lives in. */
  rootId: string;
  root: string;
  authorizedRoot: string;
  packageName?: string;
  packageVersion?: string;
  git?: { branch?: string; head?: string };
  capabilities?: import("./project-capabilities").ProjectCapabilities;
};



const currentUid = (): number | undefined => (typeof process.getuid === "function" ? process.getuid() : undefined);

/** Ownership by the uid MSO runs as. Checked BEFORE any metadata read, so a directory
 *  another user controls never reaches packageMeta/boundedGitMeta at all. */
export async function ownedByUs(target: string): Promise<boolean> {
  const uid = currentUid();
  if (uid === undefined) return true; // no uid concept (Windows); containment still applies
  const stat = await fs.lstat(target).catch(() => null);
  return !!stat && stat.uid === uid;
}

/**
 * Each configured OS_FS_READ_ROOTS entry, resolved ONCE to its canonical directory.
 * Following a symlinked CONFIGURED root is intended — its realpath simply becomes the
 * authorized real root, and everything else is measured against that.
 */
/** `<root>/projects`, only when it is a real, non-symlink directory contained in that
 *  same authorized root. */
async function derivedContainerPath(root: AuthorizedRoot): Promise<string | null> {
  const candidate = path.join(root.path, "projects");
  const stat = await fs.lstat(candidate).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) return null;
  const real = await fs.realpath(candidate).catch(() => null);
  if (!real || !isUnderRoot(real, root.path) || isCredentialPath(real)) return null;
  return real;
}

/** Every container, deterministically: configured root order, each root followed by
 *  its derived `projects/` child, deduped by canonical path. */
export async function projectContainers(startIndex = 0): Promise<ProjectContainer[]> {
  const out: ProjectContainer[] = [];
  const seen = new Set<string>();
  for (const root of await authorizedRoots(startIndex)) {
    let containerIndex = 0;
    for (const [candidate, derived] of [[root.path, false], [await derivedContainerPath(root), true]] as const) {
      if (!candidate || seen.has(candidate)) { containerIndex += 1; continue; }
      seen.add(candidate);
      out.push({
        id: shortId(candidate), path: candidate, authorizedRootId: root.id, authorizedRoot: root.path,
        derived, rootIndex: root.index, containerIndex,
      });
      containerIndex += 1;
    }
  }
  return out;
}

/** Resolve a 32-hex rootId to its container, across EVERY configured root — not just the
 *  scan-capped window. An exact id must address the same project on every call. */
export async function containerById(rootId: string): Promise<ProjectContainer | null> {
  if (!/^[a-f0-9]{32}$/.test(rootId)) return null;
  for (const root of await allConfiguredRoots()) {
    let containerIndex = 0;
    for (const [candidate, derived] of [[root.path, false], [await derivedContainerPath(root), true]] as const) {
      if (candidate && shortId(candidate) === rootId) {
        return {
          id: rootId, path: candidate, authorizedRootId: root.id, authorizedRoot: root.path,
          derived, rootIndex: root.index, containerIndex,
        };
      }
      containerIndex += 1;
    }
  }
  return null;
}

/** Back-compat view: just the container paths. */
export async function projectRoots(): Promise<string[]> {
  return (await projectContainers()).map((c) => c.path);
}

/** A container built from ONE explicitly named directory. Used by `resolveProjectHint`'s
 *  `rootHint`: the caller named this root, so every strategy must run inside it even
 *  when the global container list is already at its cap. Same id derivation, same
 *  containment rules — only the discovery path differs. */
export function containerFor(realDir: string): ProjectContainer {
  return {
    id: shortId(realDir), path: realDir, authorizedRootId: shortId(realDir), authorizedRoot: realDir,
    derived: false, rootIndex: 0, containerIndex: 0,
  };
}

