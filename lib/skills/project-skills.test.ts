import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { catalogSkills } from "./catalog";
import { PROJECT_SKILL_DIRS, projectRefFor, projectSkillTrust } from "./project-skills";

const temps: string[] = [];
async function temp() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mso-project-skills-"));
  temps.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(temps.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function skill(root: string, name: string, description: string) {
  const dir = path.join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`);
  return dir;
}

/** Catalog with an explicit project list, so the box's real checkouts never leak in.
 *  Refs are built the way the catalog builds them, so ids are never hand-rolled. */
const catalog = (app: string, home: string, dirs: string[]) =>
  catalogSkills({ appDir: app, homeDir: home, projects: dirs.map((dir) => projectRefFor(dir, path.dirname(dir))) });

/** The root-qualified id the catalog assigns `<project>/<skill>`. Computed, never
 *  typed by hand — the whole point is that it depends on the container path. */
const idFor = (dir: string, skillName: string) => `${projectRefFor(dir, path.dirname(dir)).id}/${skillName}`;

describe("per-project skill discovery", () => {
  it("catalogs skills from every supported project root, in every project", async () => {
    const app = await temp();
    const home = await temp();
    const workspace = await temp();
    const one = path.join(workspace, "one");
    const two = path.join(workspace, "two");
    await skill(path.join(one, ".claude/skills"), "ship", "project one ship");
    await skill(path.join(two, ".codex/skills"), "audit", "project two audit");

    const rows = await catalog(app, home, [one, two]);
    expect(rows.map((r) => `${r.id}:${r.trust}`).sort()).toEqual(
      [`${idFor(one, "ship")}:local`, `${idFor(two, "audit")}:local`].sort());
    expect(rows[0]).toMatchObject({ name: "ship", source: "project", project: { name: "one", path: one } });
  });

  it("keeps two projects' same-named skills as distinct catalog ids", async () => {
    const app = await temp();
    const home = await temp();
    const workspace = await temp();
    const one = path.join(workspace, "one");
    const two = path.join(workspace, "two");
    await skill(path.join(one, ".claude/skills"), "deploy", "one deploy");
    await skill(path.join(two, ".claude/skills"), "deploy", "two deploy");

    const rows = await catalog(app, home, [one, two]);
    expect(rows.map((r) => r.id).sort()).toEqual([idFor(one, "deploy"), idFor(two, "deploy")].sort());
    expect(rows.map((r) => r.description).sort()).toEqual(["one deploy", "two deploy"]);
  });

  it("never lets a project skill shadow an operator or official skill of the same name", async () => {
    const app = await temp();
    const home = await temp();
    const workspace = await temp();
    const proj = path.join(workspace, "one");
    await skill(path.join(app, "claude-skills"), "mso", "official");
    await skill(path.join(home, ".mso/skills"), "ops", "operator");
    await skill(path.join(proj, ".claude/skills"), "mso", "project impostor");
    await skill(path.join(proj, ".claude/skills"), "ops", "project impostor");

    const rows = await catalog(app, home, [proj]);
    expect(rows.find((r) => r.id === "mso")).toMatchObject({ source: "mso", trust: "official", description: "official" });
    expect(rows.find((r) => r.id === "ops")).toMatchObject({ source: "operator", trust: "local", description: "operator" });
    // The project copies remain visible, but only under their own namespaced ids.
    expect(rows.map((r) => r.id).sort()).toEqual(["mso", "ops", idFor(proj, "mso"), idFor(proj, "ops")].sort());
  });

  it("ranks the explicit .mso/skills root above the agent-tool roots within one project", async () => {
    const app = await temp();
    const home = await temp();
    const workspace = await temp();
    const proj = path.join(workspace, "one");
    await skill(path.join(proj, ".claude/skills"), "release", "claude copy");
    await skill(path.join(proj, ".mso/skills"), "release", "explicit mso copy");

    const rows = await catalog(app, home, [proj]);
    expect(rows).toEqual([expect.objectContaining({ id: idFor(proj, "release"), description: "explicit mso copy" })]);
  });

  it("lists every documented project skill root", () => {
    expect([...PROJECT_SKILL_DIRS]).toEqual([".mso/skills", ".claude/skills", ".hermes/skills", ".agents/skills", ".codex/skills"]);
  });
});

describe("project skill trust is earned, not assumed", () => {
  it("refuses a skill directory that realpaths outside its project", async () => {
    const workspace = await temp();
    const outside = await temp();
    const proj = path.join(workspace, "one");
    await mkdir(path.join(proj, ".claude"), { recursive: true });
    const evil = await skill(outside, "escape", "outside the project");
    await symlink(outside, path.join(proj, ".claude/skills"));

    await expect(projectSkillTrust(evil, proj)).resolves.toBe("untrusted");
    const rows = await catalog(await temp(), await temp(), [proj]);
    expect(rows).toEqual([]);
  });

  it("refuses a SKILL.md that is a symlink rather than a regular file", async () => {
    const workspace = await temp();
    const proj = path.join(workspace, "one");
    const dir = path.join(proj, ".claude/skills/linked");
    await mkdir(dir, { recursive: true });
    const real = path.join(proj, "real.md");
    await writeFile(real, "---\nname: linked\ndescription: linked\n---\n");
    await symlink(real, path.join(dir, "SKILL.md"));

    await expect(projectSkillTrust(dir, proj)).resolves.toBe("untrusted");
  });

  it("trusts a contained, owner-owned, regular-file skill", async () => {
    const workspace = await temp();
    const proj = path.join(workspace, "one");
    const dir = await skill(path.join(proj, ".hermes/skills"), "patrol", "hermes patrol");
    await expect(projectSkillTrust(dir, proj)).resolves.toBe("local");
  });

  it("keeps the generic HOME agent roots untrusted even though project roots are promoted", async () => {
    const app = await temp();
    const home = await temp();
    await skill(path.join(home, ".claude/skills"), "wander", "discovered in home");
    const rows = await catalog(app, home, []);
    expect(rows).toEqual([expect.objectContaining({ id: "wander", source: "claude", trust: "untrusted" })]);
  });
});
