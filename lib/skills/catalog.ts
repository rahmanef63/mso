import os from "os";
import path from "path";
import { scanRoot, type RootSpec } from "./catalog-scan";
import { decodeSkillCursor, encodeSkillCursor } from "./catalog-cursor";
import {
  SKILL_FILE, SKILL_SCAN_LIMITS, skillIsExecutableByDefault,
  type ProjectRef, type SkillInfo, type SkillScanCursor, type SkillScanReport, type SkillSource, type SkillTrust,
} from "./catalog-types";
import { discoveredProjects, projectSkillRoots } from "./project-skills";

export { SKILL_FILE, SKILL_SCAN_LIMITS, skillIsExecutableByDefault };
export { readSkillFile, skillDescription } from "./catalog-scan";
export { decodeSkillCursor, encodeSkillCursor } from "./catalog-cursor";
export type { ProjectRef, SkillInfo, SkillScanCursor, SkillScanReport, SkillSource, SkillTrust };

type CatalogOptions = {
  appDir?: string;
  homeDir?: string;
  /** Projects to scan for per-project skill roots. Defaults to every project across
   *  every configured container; pass `[]` to catalog global roots only. */
  projects?: ProjectRef[];
  /** A `scan.continuation.cursor` from a truncated build, to resume it. */
  cursor?: string;
};

/**
 * Root priority is a security boundary, not just display order.
 *
 * Explicit operator-owned ~/.mso/skills may override anything: placing a file there
 * is an intentional MSO action. Official repo skills beat generic agent registries,
 * so installing a same-named OpenClaw/Claude/Codex skill cannot silently replace
 * MSO's own instructions. Bundled third-party skills are verified by their ClawHub
 * SKILL.md hash. Generic discovered roots are visible but untrusted.
 *
 * Per-project roots sit BELOW all of these (priority 56–60) and are addressed by a
 * `<rootId>/<project>/<name>` id, so a project skill can neither outrank nor collide
 * with an operator or official one — nor with the same-named project in another root.
 */
export function skillRoots(appDir = process.cwd(), homeDir = os.homedir()): RootSpec[] {
  return [
    { path: process.env.MSO_SKILL_INSTALL_ROOT ? path.resolve(/* turbopackIgnore: true */ process.env.MSO_SKILL_INSTALL_ROOT) : path.join(homeDir, ".mso/skills"), source: "operator", trust: "local", priority: 120 },
    { path: path.join(appDir, "claude-skills"), source: "mso", trust: "official", priority: 100 },
    { path: path.join(appDir, "skills"), source: "bundled", trust: "untrusted", priority: 80, verifyClawHub: true },
    { path: path.join(homeDir, ".claude/skills"), source: "claude", trust: "untrusted", priority: 20 },
    { path: path.join(homeDir, ".agents/skills"), source: "agents", trust: "untrusted", priority: 20 },
    { path: path.join(homeDir, ".codex/skills"), source: "codex", trust: "untrusted", priority: 20 },
    { path: path.join(homeDir, ".openclaw/workspace/skills"), source: "openclaw", trust: "untrusted", priority: 20 },
    { path: path.join(homeDir, ".local/lib/node_modules/openclaw/skills"), source: "openclaw", trust: "untrusted", priority: 20 },
  ];
}

export type SkillCatalog = { skills: SkillInfo[]; scan: SkillScanReport };

/** The full build, including what it could not cover. Callers that surface
 *  completeness to a model or an operator must use this, not `catalogSkills`. */
export async function catalogSkillsDetailed(options: CatalogOptions = {}): Promise<SkillCatalog> {
  const appDir = options.appDir ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();
  const deadlineAt = Date.now() + SKILL_SCAN_LIMITS.maxScanMs;
  const cursor = decodeSkillCursor(options.cursor);
  const reasons: string[] = [];

  let projects = options.projects;
  if (!projects) {
    const discovered = await discoveredProjects();
    projects = discovered.projects;
    reasons.push(...discovered.truncationReasons);
  }
  // `projectOffset` counts projects FULLY consumed by earlier pages; the partially
  // consumed one is re-listed and resumed at its exact dirent position.
  const projectOffset = Math.min(cursor?.projectOffset ?? 0, projects.length);
  const remaining = projects.slice(projectOffset);
  const { roots: projectRoots, truncated: projectsCapped } = await projectSkillRoots(remaining);
  if (projectsCapped) reasons.push("maxProjects");

  const globalSpecs = skillRoots(appDir, homeDir);
  const specs: RootSpec[] = [
    ...globalSpecs,
    ...projectRoots.map((root): RootSpec => ({
      path: root.path, source: "project", trust: "untrusted", priority: root.priority, project: root.project,
    })),
  ];
  const doneRoots = new Set(cursor?.doneRoots ?? []);

  const chosen = new Map<string, { skill: SkillInfo; priority: number }>();
  const completedRoots: string[] = [];
  const pendingRoots: string[] = [];
  const consumedProjects: string[] = [];
  let projectSkills = 0;
  let resume: SkillScanCursor["resume"];
  let stoppedAt = -1;

  for (const [index, spec] of specs.entries()) {
    if (doneRoots.has(spec.path)) { completedRoots.push(spec.path); continue; }
    const skipEntries = cursor?.resume?.root === spec.path ? cursor.resume.entriesConsumed : 0;
    const budget = spec.project ? SKILL_SCAN_LIMITS.maxProjectSkills - projectSkills : Number.POSITIVE_INFINITY;

    if (Date.now() > deadlineAt) {
      reasons.push("deadline");
      resume = { root: spec.path, entriesConsumed: skipEntries };
      stoppedAt = index;
      break;
    }
    if (spec.project && budget <= 0) {
      reasons.push("maxProjectSkills");
      resume = { root: spec.path, entriesConsumed: skipEntries };
      stoppedAt = index;
      break;
    }

    const { found, stop, consumed } = await scanRoot(spec, deadlineAt, skipEntries, budget);
    for (const candidate of found) {
      if (spec.project) projectSkills += 1;
      const current = chosen.get(candidate.skill.id);
      if (!current || candidate.priority > current.priority) chosen.set(candidate.skill.id, candidate);
    }

    if (stop) {
      reasons.push(stop === "budget" ? "maxProjectSkills" : stop === "deadline" ? "deadline" : `maxEntriesPerRoot:${spec.path}`);
      // The exact dirent this root stopped on — never "the whole root is done".
      resume = { root: spec.path, entriesConsumed: consumed };
      stoppedAt = index;
      break;
    }
    completedRoots.push(spec.path);
    // A project counts as consumed only once EVERY one of its roots finished cleanly.
    if (spec.project && specs.slice(index + 1).every((later) => later.project?.id !== spec.project!.id)) {
      consumedProjects.push(spec.project.id);
    }
  }

  if (stoppedAt >= 0) pendingRoots.push(...specs.slice(stoppedAt).map((r) => r.path));
  const truncationReasons = [...new Set(reasons)];
  const pendingProjects = Math.max(0, projects.length - projectOffset - consumedProjects.length);
  return {
    skills: [...chosen.values()].map(({ skill }) => skill).sort((a, b) => a.id.localeCompare(b.id)),
    scan: {
      truncated: truncationReasons.length > 0,
      truncationReasons,
      scannedRoots: specs.length,
      scannedProjects: consumedProjects.length,
      ...(truncationReasons.length ? {
        continuation: {
          pendingRoots: [...new Set(pendingRoots)],
          cursors: resume ? [resume] : [],
          pendingProjects,
          cursorSemantics: "readdir-position" as const,
          note: "Pass `cursor` back to resume at the exact dirent the scan stopped on. Positions are readdir stream order and are valid while the directories are unchanged.",
          cursor: encodeSkillCursor({
            doneRoots: completedRoots,
            projectOffset: projectOffset + consumedProjects.length,
            ...(resume ? { resume } : {}),
          }),
        },
      } : {}),
    },
  };
}

export async function catalogSkills(options: CatalogOptions = {}): Promise<SkillInfo[]> {
  return (await catalogSkillsDetailed(options)).skills;
}

/**
 * Resolve a catalog id. The exact id always wins. A bare name is a CONVENIENCE, and
 * only when it is unambiguous: two projects may legitimately ship `deploy`, and
 * silently picking one would hand a model the wrong instructions. An ambiguous hint
 * returns the candidate ids instead of a guess.
 */
export function resolveSkill(skills: SkillInfo[], idOrName: string): { skill?: SkillInfo; ambiguous?: string[] } {
  const exact = skills.find((s) => s.id === idOrName);
  if (exact) return { skill: exact };
  const loose = skills.filter((s) =>
    s.name === idOrName || (s.project ? `${s.project.name}/${s.name}` === idOrName : false));
  if (loose.length === 1) return { skill: loose[0] };
  if (loose.length > 1) return { ambiguous: loose.map((s) => s.id) };
  return {};
}

/** Unambiguous-only lookup, for callers that just want a skill or a 404. */
export function findSkill(skills: SkillInfo[], idOrName: string): SkillInfo | undefined {
  return resolveSkill(skills, idOrName).skill;
}
