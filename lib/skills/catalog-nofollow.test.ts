import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { catalogSkills, catalogSkillsDetailed, readSkillFile } from "./catalog";
import { SKILL_SCAN_LIMITS } from "./catalog-types";
import { projectRefFor } from "./project-skills";

const temps: string[] = [];
async function temp() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mso-nofollow-"));
  temps.push(dir);
  return dir;
}
afterEach(async () => { await Promise.all(temps.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

const body = (name: string) => `---\nname: ${name}\ndescription: ${name} desc\n---\n\n# ${name}\n`;

async function skill(root: string, name: string) {
  const dir = path.join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SKILL.md"), body(name));
  return dir;
}

describe("readSkillFile is nofollow at the SKILL.md itself", () => {
  it("reads a regular SKILL.md", async () => {
    const root = await temp();
    const dir = await skill(root, "real");
    await expect(readSkillFile(path.join(dir, "SKILL.md"))).resolves.toContain("# real");
  });

  it("refuses a SKILL.md that is a symlink to ANOTHER SKILL.md", async () => {
    // This is the case the previous implementation accepted: it realpath'd first, saw a
    // basename of SKILL.md, and opened the TARGET with O_NOFOLLOW — so the nofollow
    // promise was enforced against a path the caller never supplied.
    const root = await temp();
    const donor = await skill(root, "donor");
    const dir = path.join(root, "borrower");
    await mkdir(dir, { recursive: true });
    await symlink(path.join(donor, "SKILL.md"), path.join(dir, "SKILL.md"));
    await expect(readSkillFile(path.join(dir, "SKILL.md"))).resolves.toBeNull();
  });

  it("refuses a SKILL.md symlinked to an unrelated file", async () => {
    const root = await temp();
    const secret = path.join(root, "config");
    await writeFile(secret, "secret");
    const dir = path.join(root, "sneaky");
    await mkdir(dir, { recursive: true });
    await symlink(secret, path.join(dir, "SKILL.md"));
    await expect(readSkillFile(path.join(dir, "SKILL.md"))).resolves.toBeNull();
  });

  it("refuses a path whose final component is not named SKILL.md", async () => {
    const root = await temp();
    const other = path.join(root, "NOTES.md");
    await writeFile(other, "x");
    await expect(readSkillFile(other)).resolves.toBeNull();
  });

  it("drops a symlinked SKILL.md from the catalog entirely", async () => {
    const app = await temp();
    const root = path.join(app, "claude-skills");
    await skill(root, "honest");
    const donor = await skill(root, "donor");
    const linked = path.join(root, "linked");
    await mkdir(linked, { recursive: true });
    await symlink(path.join(donor, "SKILL.md"), path.join(linked, "SKILL.md"));

    const rows = await catalogSkills({ appDir: app, homeDir: await temp(), projects: [] });
    expect(rows.map((r) => r.id).sort()).toEqual(["donor", "honest"]);
  });
});

describe("skill root walks are bounded by DIRENTS, not by accepted entries", () => {
  it("stops after the entry cap even when every entry is a regular file", async () => {
    // A root full of rejected entries used to cost one iteration each with no budget
    // consumed, so the advertised cap bounded nothing.
    const app = await temp();
    const root = path.join(app, "claude-skills");
    await mkdir(root, { recursive: true });
    await Promise.all(
      Array.from({ length: SKILL_SCAN_LIMITS.maxEntriesPerRoot + 25 }, (_, i) =>
        writeFile(path.join(root, `junk-${String(i).padStart(4, "0")}.txt`), "x")),
    );
    const { scan } = await catalogSkillsDetailed({ appDir: app, homeDir: await temp(), projects: [] });
    expect(scan.truncated).toBe(true);
    expect(scan.truncationReasons.some((r) => r.startsWith("maxEntriesPerRoot"))).toBe(true);
  });
});

describe("the overall project-skill cap is enforced inside the loop", () => {
  it("never exceeds maxProjectSkills, even when one root would overshoot it", async () => {
    const workspace = await temp();
    // Each project ships more skills than the remaining budget, so a per-root check
    // alone would let the total sail past the cap.
    const perProject = 40;
    const projectCount = Math.ceil((SKILL_SCAN_LIMITS.maxProjectSkills + 60) / perProject);
    const projects = [];
    for (let p = 0; p < projectCount; p += 1) {
      const dir = path.join(workspace, `proj-${String(p).padStart(3, "0")}`);
      const root = path.join(dir, ".claude/skills");
      await mkdir(root, { recursive: true });
      await Promise.all(Array.from({ length: perProject }, (_, i) =>
        mkdir(path.join(root, `s${String(i).padStart(3, "0")}`), { recursive: true })
          .then(() => writeFile(path.join(root, `s${String(i).padStart(3, "0")}`, "SKILL.md"), body("s")))));
      projects.push(projectRefFor(dir, workspace));
    }

    // This test targets the deterministic project-skill CAP, not the independent
    // wall-clock deadline. Freeze the clock while cataloguing so low-priority CI
    // cannot turn a maxProjectSkills assertion into a scheduler-speed assertion.
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now());
    try {
      const { skills, scan } = await catalogSkillsDetailed({ appDir: await temp(), homeDir: await temp(), projects });
      const projectSkills = skills.filter((s) => s.project);
      expect(projectSkills.length).toBeLessThanOrEqual(SKILL_SCAN_LIMITS.maxProjectSkills);
      expect(scan.truncated).toBe(true);
      expect(scan.truncationReasons).toContain("maxProjectSkills");
    } finally {
      clock.mockRestore();
    }
  });
});

describe("skill scans expose resumable continuation for every cap", () => {
  it("emits a continuation cursor and pending roots when a cap is hit", async () => {
    const app = await temp();
    const root = path.join(app, "claude-skills");
    await mkdir(root, { recursive: true });
    await Promise.all(
      Array.from({ length: SKILL_SCAN_LIMITS.maxEntriesPerRoot + 10 }, (_, i) =>
        skill(root, `s${String(i).padStart(4, "0")}`)),
    );
    const first = await catalogSkillsDetailed({ appDir: app, homeDir: await temp(), projects: [] });
    expect(first.scan.truncated).toBe(true);
    expect(first.scan.continuation).toBeDefined();
    expect(first.scan.continuation!.cursor).toBeTruthy();
    expect(first.scan.continuation!.cursors.some((c) => c.root === root)).toBe(true);

    const second = await catalogSkillsDetailed({
      appDir: app, homeDir: await temp(), projects: [], cursor: first.scan.continuation!.cursor,
    });
    // The resumed page returns the entries the first one could not reach.
    expect(second.skills.length).toBeGreaterThan(0);
    const firstIds = new Set(first.skills.map((s) => s.id));
    expect(second.skills.some((s) => !firstIds.has(s.id))).toBe(true);
  });

  it("omits continuation entirely when nothing was truncated", async () => {
    const app = await temp();
    await skill(path.join(app, "claude-skills"), "one");
    const { scan } = await catalogSkillsDetailed({ appDir: app, homeDir: await temp(), projects: [] });
    expect(scan.truncated).toBe(false);
    expect(scan.continuation).toBeUndefined();
  });
});

describe("root ids survive a real 8-hex collision", () => {
  it("keeps both colliding roots' same-named projects visible", async () => {
    // /tmp/mso-root-50323 and /tmp/mso-root-125549 both hash to 51e156ef at 8 hex —
    // a collision found by an actual probe, not a hypothetical.
    const a = projectRefFor("/tmp/mso-root-50323/widget", "/tmp/mso-root-50323");
    const b = projectRefFor("/tmp/mso-root-125549/widget", "/tmp/mso-root-125549");
    expect(a.rootId.slice(0, 8)).toBe(b.rootId.slice(0, 8));
    expect(a.rootId).not.toBe(b.rootId);
    expect(a.id).not.toBe(b.id);
    expect(a.rootId).toMatch(/^[a-f0-9]{32}$/);
  });
});
