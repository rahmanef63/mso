import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { catalogSkillsDetailed } from "./catalog";
import { SKILL_SCAN_LIMITS } from "./catalog-types";
import { projectRefFor } from "./project-skills";

const temps: string[] = [];
async function temp() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mso-skill-cont-"));
  temps.push(dir);
  return dir;
}
afterEach(async () => { await Promise.all(temps.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

const body = (name: string) => `---\nname: ${name}\ndescription: ${name} desc\n---\n\n# ${name}\n`;

// These two continuation tests intentionally create 300+ real filesystem entries.
// The production scanner still enforces maxScanMs=4s; this timeout only prevents
// coverage/loaded-CI overhead from turning correct cursor behavior into a 5s Vitest flake.
const LARGE_FS_TEST_TIMEOUT_MS = 15_000;

async function skillsIn(root: string, count: number, prefix: string) {
  await mkdir(root, { recursive: true });
  await Promise.all(Array.from({ length: count }, async (_, i) => {
    const dir = path.join(root, `${prefix}${String(i).padStart(4, "0")}`);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "SKILL.md"), body(`${prefix}${i}`));
  }));
}

/** Follow the cursor until the catalog reports itself complete. */
async function drain(opts: { appDir: string; homeDir: string; projects: ReturnType<typeof projectRefFor>[] }) {
  const ids = new Set<string>();
  let cursor: string | undefined;
  for (let i = 0; i < 40; i += 1) {
    const page = await catalogSkillsDetailed({ ...opts, cursor });
    for (const s of page.skills) ids.add(s.id);
    if (!page.scan.truncated || !page.scan.continuation?.cursor) break;
    if (page.scan.continuation.cursor === cursor) break; // no forward progress
    cursor = page.scan.continuation.cursor;
  }
  return ids;
}

describe("maxProjectSkills continuation returns the remainder of a partially consumed root", () => {
  it("drains 150 + 160 project skills across pages without losing the last 10", async () => {
    const workspace = await temp();
    const one = path.join(workspace, "one");
    const two = path.join(workspace, "two");
    await skillsIn(path.join(one, ".claude/skills"), 150, "a");
    await skillsIn(path.join(two, ".claude/skills"), 160, "b");
    const projects = [projectRefFor(one, workspace), projectRefFor(two, workspace)];
    const opts = { appDir: await temp(), homeDir: await temp(), projects };

    const first = await catalogSkillsDetailed(opts);
    expect(first.skills.filter((s) => s.project).length).toBe(SKILL_SCAN_LIMITS.maxProjectSkills);
    expect(first.scan.truncationReasons).toContain("maxProjectSkills");
    expect(first.scan.continuation!.pendingProjects).toBeGreaterThan(0);

    const all = await drain(opts);
    // 310 project skills in total, none dropped.
    expect([...all].filter((id) => id.includes("/")).length).toBe(310);
  }, LARGE_FS_TEST_TIMEOUT_MS);

  it("records the exact interrupted root rather than marking it complete", async () => {
    const workspace = await temp();
    const one = path.join(workspace, "one");
    await skillsIn(path.join(one, ".claude/skills"), SKILL_SCAN_LIMITS.maxProjectSkills + 20, "c");
    const projects = [projectRefFor(one, workspace)];
    const opts = { appDir: await temp(), homeDir: await temp(), projects };

    const first = await catalogSkillsDetailed(opts);
    const resume = first.scan.continuation!.cursors[0];
    expect(resume.root).toBe(path.join(one, ".claude/skills"));
    expect(resume.entriesConsumed).toBeGreaterThan(0);
    expect(first.scan.continuation!.pendingRoots).toContain(resume.root);

    const all = await drain(opts);
    expect([...all].filter((id) => id.includes("/")).length).toBe(SKILL_SCAN_LIMITS.maxProjectSkills + 20);
  }, LARGE_FS_TEST_TIMEOUT_MS);
});

describe("a deadline never advances the cursor past an unprocessed entry", () => {
  it("keeps every skill reachable when the deadline expires immediately", async () => {
    const app = await temp();
    await skillsIn(path.join(app, "claude-skills"), 3, "d");
    const opts = { appDir: app, homeDir: await temp(), projects: [] };

    // maxScanMs is a constant, so the honest way to force the deadline branch is a clock
    // that is already past it on the first check.
    const realNow = Date.now;
    let calls = 0;
    Date.now = () => (calls++ === 0 ? realNow() : realNow() + SKILL_SCAN_LIMITS.maxScanMs + 1_000);
    let first;
    try {
      first = await catalogSkillsDetailed(opts);
    } finally {
      Date.now = realNow;
    }
    expect(first.scan.truncated).toBe(true);
    expect(first.scan.truncationReasons).toContain("deadline");
    // Whatever it could not process must still be reachable on resume.
    const resumed = await catalogSkillsDetailed({ ...opts, cursor: first.scan.continuation!.cursor });
    const ids = new Set([...first.skills, ...resumed.skills].map((s) => s.id));
    expect([...ids].filter((id) => id.startsWith("d"))).toHaveLength(3);
  });
});

describe("a complete catalog build reports no continuation", () => {
  it("stays truncated=false", async () => {
    const app = await temp();
    await skillsIn(path.join(app, "claude-skills"), 2, "e");
    const { scan } = await catalogSkillsDetailed({ appDir: app, homeDir: await temp(), projects: [] });
    expect(scan).toMatchObject({ truncated: false, truncationReasons: [] });
    expect(scan.continuation).toBeUndefined();
  });
});

describe("continuation cursor integrity", () => {
  it("rejects a forged offset instead of fast-forwarding the directory walk", async () => {
    const app = await temp();
    await skillsIn(path.join(app, "claude-skills"), 3, "f");
    const forged = Buffer.from(JSON.stringify({
      doneRoots: [], projectOffset: 0,
      resume: { root: path.join(app, "claude-skills"), entriesConsumed: 10_000_000 },
    })).toString("base64url");
    const page = await catalogSkillsDetailed({ appDir: app, homeDir: await temp(), projects: [], cursor: forged });
    expect(page.skills.map((s) => s.id).filter((id) => id.startsWith("f"))).toHaveLength(3);
  });
});
