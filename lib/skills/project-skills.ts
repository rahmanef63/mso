// Per-PROJECT skill roots, across every configured project container.
//
// A skill that lives with the repository it automates is the normal case, and MSO
// was blind to all of them: only global roots (~/.mso/skills, the MSO repo, ~/.claude
// and friends) were cataloged, so an agent working in project X could not see X's own
// SKILL.md. That is capability scoping nobody chose.
//
// Trust is EARNED per directory, never assumed from the path. A project skill reaches
// `local` only when all three hold:
//   1. containment — the skill directory realpaths back inside the project directory,
//      so a `.claude/skills -> /tmp/attacker` symlink is discovered, not followed;
//   2. ownership   — the skill directory and its SKILL.md belong to the uid MSO runs
//      as, so a world-writable drop-in cannot become executable instructions;
//   3. shape       — SKILL.md is a regular file, not a symlink to somewhere else.
// Anything else is cataloged as `untrusted`: visible for inspection, instructions
// withheld. The generic HOME agent roots (~/.claude/skills, …) keep their existing
// untrusted behaviour — this promotion is for project-scoped roots only.
import { promises as fs } from "fs";
import path from "path";
import { listProjectDirs, shortId } from "@/lib/host/project-roots";
import { SKILL_FILE, SKILL_SCAN_LIMITS, type ProjectRef, type SkillTrust } from "./catalog-types";

/** Where a project may keep skills. `.mso/skills` is the explicit MSO root — the
 *  per-project counterpart of `~/.mso/skills` — and therefore ranks above the
 *  agent-tool conventions that follow it. */
export const PROJECT_SKILL_DIRS = [
  ".mso/skills",
  ".claude/skills",
  ".hermes/skills",
  ".agents/skills",
  ".codex/skills",
] as const;

export type ProjectSkillRoot = { path: string; project: ProjectRef; priority: number };

function currentUid(): number | undefined {
  return typeof process.getuid === "function" ? process.getuid() : undefined;
}

async function ownedByUs(target: string): Promise<boolean> {
  const uid = currentUid();
  if (uid === undefined) return true; // no uid concept (Windows); containment + shape still apply
  const stat = await fs.lstat(target).catch(() => null);
  return !!stat && stat.uid === uid;
}

function contains(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** The same short-hash identity `lib/host/project-roots` assigns a container, so a
 *  skill's `project.rootId` and a `projects_list` row's `rootId` are the same value. */
export function projectRefFor(dir: string, containerPath: string): ProjectRef {
  // The SAME function lib/host uses, not a second copy of the recipe. A local
  // reimplementation is how the two sides silently drifted to different widths.
  const rootId = shortId(containerPath);
  const name = path.basename(dir);
  return { id: `${rootId}/${name}`, name, path: dir, rootId };
}

/**
 * The trust decision for ONE project skill directory. Exported so the catalog and
 * its tests exercise the same three checks rather than a reimplementation.
 */
export async function projectSkillTrust(skillDir: string, projectPath: string): Promise<SkillTrust> {
  const projectReal = await fs.realpath(projectPath).catch(() => null);
  const dirReal = await fs.realpath(skillDir).catch(() => null);
  if (!projectReal || !dirReal || !contains(projectReal, dirReal)) return "untrusted";
  const file = path.join(dirReal, SKILL_FILE);
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) return "untrusted";
  if (!(await ownedByUs(dirReal)) || !(await ownedByUs(file))) return "untrusted";
  return "local";
}

/** Every project on the box, already containment- and ownership-checked by
 *  `listProjectDirs`, as catalog-facing refs plus that walk's truncation report. */
export async function discoveredProjects(): Promise<{ projects: ProjectRef[]; truncationReasons: string[] }> {
  const { dirs, scan } = await listProjectDirs();
  return {
    projects: dirs.map(({ container, dir }) => projectRefFor(dir, container.path)),
    truncationReasons: scan.truncationReasons.map((reason) => `projects:${reason}`),
  };
}

/**
 * Every per-project skill root, in deterministic order: project order from the
 * container walk, then `PROJECT_SKILL_DIRS` order. `priority` ranks a project skill
 * BELOW every global root, so a project can never shadow an operator or official one.
 */
export async function projectSkillRoots(projects: ProjectRef[]): Promise<{ roots: ProjectSkillRoot[]; truncated: boolean }> {
  const capped = projects.slice(0, SKILL_SCAN_LIMITS.maxProjects);
  const out: ProjectSkillRoot[] = [];
  for (const project of capped) {
    for (const [index, sub] of PROJECT_SKILL_DIRS.entries()) {
      const root = path.join(project.path, sub);
      // A project-root symlink is never traversed: otherwise metadata is opened before
      // containment can make a trust decision.
      const rootStat = await fs.lstat(root).catch(() => null);
      if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) continue;
      out.push({ path: root, project, priority: 60 - index });
    }
  }
  return { roots: out, truncated: projects.length > capped.length };
}
