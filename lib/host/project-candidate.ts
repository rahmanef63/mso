// Host-owned runtime data is not a build asset; tracing exclusions preserve runtime guards.
// THE shared project-candidate validator.
//
// There used to be two of these: a strict one inside the enumeration walk, and
// `resolveReadable()` standing in for it on every `resolveProjectHint` strategy. That
// split is precisely how `workflow_start` could resolve — and then read metadata from —
// a project that `projects_list` correctly refused to show: a symlinked entry, a hidden
// directory, or one owned by another uid.
//
// One function now decides, and every caller goes through it. The rules, in order:
//   hidden   — no path component below the container may start with "."
//   symlink  — no component may BE a symlink, target legal or not. A link is not a
//              child of this container, and following it is a TOCTOU bet.
//   escape   — the canonical result must stay inside the container
//   credential — never a denylisted credential path
//   uid      — owned by the uid MSO runs as, checked BEFORE any metadata read
import { promises as fs } from "fs";
import path from "path";
import { isCredentialPath, isUnderRoot } from "./paths";
import type { ProjectContainer } from "./project-containers";

export type CandidateRejection = "hidden" | "symlink" | "not-directory" | "escape" | "credential" | "uid" | "missing";
export type CandidateResult = { ok: true; path: string } | { ok: false; reason: CandidateRejection };

const currentUid = (): number | undefined => (typeof process.getuid === "function" ? process.getuid() : undefined);

/** A single path component: real, visible, not a link, owned by us. `parent` is already
 *  validated (or is the container), so this never re-walks the whole prefix. */
async function validateComponent(parent: string, name: string): Promise<CandidateResult> {
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\")) return { ok: false, reason: "escape" };
  if (name.startsWith(".")) return { ok: false, reason: "hidden" };
  const full = path.join(parent, name);
  const stat = await fs.lstat(full).catch(() => null);
  if (!stat) return { ok: false, reason: "missing" };
  if (stat.isSymbolicLink()) return { ok: false, reason: "symlink" };
  if (!stat.isDirectory()) return { ok: false, reason: "not-directory" };
  const uid = currentUid();
  if (uid !== undefined && stat.uid !== uid) return { ok: false, reason: "uid" };
  if (isCredentialPath(full)) return { ok: false, reason: "credential" };
  return { ok: true, path: full };
}

/**
 * ONE direct child of a container — the enumeration case and the exact-name/alias probe.
 * A final realpath check catches a swap between lstat and here.
 */
export async function validateProjectChild(container: ProjectContainer, name: string): Promise<CandidateResult> {
  const component = await validateComponent(container.path, name);
  if (!component.ok) return component;
  const real = await fs.realpath(/* turbopackIgnore: true */ component.path).catch(() => null);
  if (real !== component.path || !isUnderRoot(real, container.path)) return { ok: false, reason: "escape" };
  return component;
}

/**
 * A path at ANY depth below a container — the absolute/`~`/relative path-hint case.
 * Validated component by component from the container down, so a symlink or hidden
 * directory three levels in is refused just as a direct child would be. Canonicalizing
 * first and checking afterwards is what let a symlinked intermediate through.
 */
export async function validateProjectDescendant(container: ProjectContainer, target: string): Promise<CandidateResult> {
  const absolute = path.resolve(target);
  if (!isUnderRoot(absolute, container.path)) return { ok: false, reason: "escape" };
  const relative = path.relative(container.path, absolute);
  if (relative === "") return { ok: true, path: container.path };
  let parent = container.path;
  for (const segment of relative.split(path.sep)) {
    const component = await validateComponent(parent, segment);
    if (!component.ok) return component;
    parent = component.path;
  }
  const real = await fs.realpath(/* turbopackIgnore: true */ parent).catch(() => null);
  if (real !== parent || !isUnderRoot(real, container.path)) return { ok: false, reason: "escape" };
  return { ok: true, path: parent };
}

/**
 * The same rules applied to a caller-supplied ROOT directory, before it is trusted as a
 * container. A symlinked or hidden `rootHint` is refused rather than canonicalized into
 * something the caller never named.
 *
 * `authorizedRoot` is required for the hidden check, and the relative calculation is the
 * whole point: the authorized root's OWN path may legitimately contain dot components
 * (a checkout under `~/.claude/worktrees`, say), but nothing BELOW it may. Checking only
 * the final component let `<authorized-root>/.hidden/widget` resolve by exact name while
 * enumeration refused the same directory.
 */
export async function validateRootHint(absolute: string, authorizedRoot: string): Promise<CandidateResult> {
  if (!isUnderRoot(absolute, authorizedRoot)) return { ok: false, reason: "escape" };
  const relative = path.relative(authorizedRoot, absolute);
  if (relative && relative.split(path.sep).some((segment) => segment.startsWith("."))) return { ok: false, reason: "hidden" };
  const stat = await fs.lstat(absolute).catch(() => null);
  if (!stat) return { ok: false, reason: "missing" };
  if (stat.isSymbolicLink()) return { ok: false, reason: "symlink" };
  if (!stat.isDirectory()) return { ok: false, reason: "not-directory" };
  const uid = currentUid();
  if (uid !== undefined && stat.uid !== uid) return { ok: false, reason: "uid" };
  if (isCredentialPath(absolute)) return { ok: false, reason: "credential" };
  const real = await fs.realpath(absolute).catch(() => null);
  if (real !== absolute) return { ok: false, reason: "symlink" };
  return { ok: true, path: absolute };
}
