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

/** The same short-hash identity `lib/host/project-roots` assigns a container, so a
 *  skill's `project.rootId` and a `projects_list` row's `rootId` are the same value. */
export function projectRefFor(dir: string, containerPath: string): ProjectRef {
  // The SAME function lib/host uses, not a second copy of the recipe. A local
  // reimplementation is how the two sides silently drifted to different widths.
  const rootId = shortId(containerPath);
  const name = path.basename(dir);
  return { id: `${rootId}/${name}`, name, path: dir, rootId };
}

/** Repository content remains untrusted even when checked out by the host owner.
 * Review and copy approved instructions into the external operator skill root. */
export async function projectSkillTrust(_skillDir: string, _projectPath: string): Promise<SkillTrust> {
  return "untrusted";
}

export async function projectSkillReadable(skillDir: string, projectPath: string): Promise<boolean> {
  const project = await fs.realpath(projectPath).catch(() => null);
  const dir = await fs.realpath(skillDir).catch(() => null);
  if (!project || !dir) return false;
  const relative = path.relative(project, dir);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return false;
  const file = await fs.lstat(path.join(skillDir, SKILL_FILE)).catch(() => null);
  return !!file?.isFile() && !file.isSymbolicLink();
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
