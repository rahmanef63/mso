// Reading ONE skill root: the bounded walk, the SKILL.md reader, and the ClawHub
// provenance check. Split from catalog.ts so the assembly/precedence logic there stays
// readable — and so every read on this side goes through the same byte-capped,
// O_NOFOLLOW reader rather than a convenient `fs.readFile`.
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { readBoundedRegularFile } from "@/lib/host/bounded-read";
import { SKILL_FILE, SKILL_SCAN_LIMITS, type ProjectRef, type SkillInfo, type SkillSource, type SkillTrust } from "./catalog-types";
import { projectSkillTrust } from "./project-skills";

export type RootSpec = {
  path: string;
  source: SkillSource;
  trust: SkillTrust;
  priority: number;
  verifyClawHub?: boolean;
  project?: ProjectRef;
};

/**
 * Skills intentionally live outside OS_FS_READ_ROOTS, so the read itself is the guard.
 *
 * The SUPPLIED path is opened, not a canonicalized substitute. The previous version
 * realpath'd first and then opened the *target* with O_NOFOLLOW, which enforced the
 * nofollow promise against a path the caller never gave us: a `SKILL.md -> other/SKILL.md`
 * symlink passed the basename check and was read. Now the final component must itself be
 * a regular file — `O_NOFOLLOW` fails with ELOOP on any symlink, whatever it points at —
 * and the byte cap is checked against `fstat` before any bytes move, because an oversized
 * SKILL.md is untrusted content we decline rather than truncate.
 *
 * Parent containment is a SEPARATE concern and belongs to the caller (`scanRoot` for the
 * root, `projectSkillTrust` for a project): canonicalizing the parent here would drag the
 * final component through `realpath` again and reopen exactly this hole.
 */
export async function readSkillFile(file: string): Promise<string | null> {
  if (path.basename(file) !== SKILL_FILE) return null;
  return readBoundedRegularFile(file, SKILL_SCAN_LIMITS.maxSkillBytes);
}

export function skillDescription(md: string): string {
  const yaml = /^---\n([\s\S]*?)\n---/.exec(md)?.[1];
  const fromYaml = yaml?.match(/^description:\s*(.+)$/m)?.[1]?.replace(/^["']|["']$/g, "").trim();
  if (fromYaml) return fromYaml;
  return md.split("\n").find((line) => line.trim() && !line.startsWith("#") && !line.startsWith("---"))?.trim() ?? "";
}

type ClawHubOrigin = {
  registry?: string;
  ownerHandle?: string;
  installedVersion?: string;
  skillFile?: { sha256?: string };
};

async function verifiedBundledSkill(dir: string, md: string): Promise<Pick<SkillInfo, "trust" | "provenance">> {
  const raw = await readBoundedRegularFile(path.join(dir, ".clawhub/origin.json"), 64 * 1024);
  if (!raw) return { trust: "untrusted" };
  let origin: ClawHubOrigin;
  try {
    origin = JSON.parse(raw) as ClawHubOrigin;
  } catch {
    return { trust: "untrusted" };
  }
  const expected = origin.skillFile?.sha256?.toLowerCase();
  const actual = createHash("sha256").update(md).digest("hex");
  if (!expected || expected !== actual) return { trust: "untrusted" };
  return {
    trust: "verified",
    provenance: { registry: origin.registry, owner: origin.ownerHandle, version: origin.installedVersion, sha256: actual },
  };
}

/**
 * ONE streaming pass over a skill root.
 *
 * The previous version read every dirent name, sorted them, then validated — so a
 * deadline that expired during validation left `entriesVisited` pointing past names
 * nothing had looked at, and continuation skipped them silently. Now each dirent is
 * fully processed before the position advances, and every cap is checked BEFORE the
 * entry is touched, so stopping never consumes it.
 *
 * `budget` is how many more skills the whole catalog may still accept, which is how the
 * overall `maxProjectSkills` ceiling is enforced mid-root rather than only between roots.
 */
export async function scanRoot(
  spec: RootSpec,
  deadlineAt: number,
  skipEntries = 0,
  budget = Number.POSITIVE_INFINITY,
): Promise<{ found: Array<{ skill: SkillInfo; priority: number }>; stop?: "maxEntriesPerRoot" | "deadline" | "budget"; consumed: number }> {
  const found: Array<{ skill: SkillInfo; priority: number }> = [];
  let consumed = skipEntries;
  let seen = 0;
  let processed = 0;
  let stop: "maxEntriesPerRoot" | "deadline" | "budget" | undefined;
  const handle = await fs.opendir(spec.path).catch(() => null);
  if (!handle) return { found, consumed };
  try {
    for await (const entry of handle) {
      seen += 1;
      if (seen <= skipEntries) {
        // A continuation is signed, but directory contents may have grown. Fast-forwarding
        // still obeys the same wall-clock guard and a hard lifetime offset cap.
        if (seen > SKILL_SCAN_LIMITS.maxResumeEntriesPerRoot) { stop = "maxEntriesPerRoot"; break; }
        if (Date.now() > deadlineAt) { stop = "deadline"; break; }
        continue;
      }
      // EVERY new dirent costs budget, accepted or not — and every stop check happens
      // before the entry is processed, so `consumed` never runs ahead of the work.
      if (processed >= SKILL_SCAN_LIMITS.maxEntriesPerRoot) { stop = "maxEntriesPerRoot"; break; }
      if (Date.now() > deadlineAt) { stop = "deadline"; break; }
      if (found.length >= budget) { stop = "budget"; break; }
      processed += 1;

      // Never follow a directory symlink into an attacker-controlled tree. For project
      // skills, containment/ownership/shape are established BEFORE SKILL.md is opened.
      if (entry.isDirectory()) {
        const dir = path.join(spec.path, entry.name);
        let trust = spec.trust;
        if (spec.project) {
          trust = await projectSkillTrust(dir, spec.project.path);
          if (trust !== "local") { consumed = seen; continue; }
        }
        const md = await readSkillFile(path.join(dir, SKILL_FILE));
        if (md !== null) {
          let provenance: SkillInfo["provenance"];
          if (spec.verifyClawHub) {
            const verified = await verifiedBundledSkill(dir, md);
            trust = verified.trust;
            provenance = verified.provenance;
          }
          found.push({
            priority: spec.priority,
            skill: {
              id: spec.project ? `${spec.project.id}/${entry.name}` : entry.name,
              name: entry.name,
              path: path.join(dir, SKILL_FILE),
              description: skillDescription(md),
              source: spec.source,
              trust,
              ...(spec.project ? { project: spec.project } : {}),
              ...(provenance ? { provenance } : {}),
            },
          });
        }
      }
      consumed = seen; // ONLY now — the entry is fully handled.
    }
  } catch {
    // A root that vanishes mid-walk yields what we already fully processed.
  }
  return { found, stop, consumed };
}
