import { afterAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
vi.mock("server-only", () => ({}));

// Same fixture as tools-discovery.test.ts (see its header). This half covers
// skills_read: exact ids, ambiguity refusal, and fail-closed symlink roots.
//
// TWO configured containers, each holding a project called `widget`. That duplicate is
// the point: it is exactly the case that used to collapse into one row, hiding a whole
// project's skills from every client. OS_FS_READ_ROOTS is pointed at both so the project
// half of the catalog is deterministic; the GLOBAL half still comes from the real repo
// (`claude-skills/`), which is what these tools are supposed to merge, so assertions
// check containment rather than exact equality.
const base = await fs.mkdtemp(path.join(os.tmpdir(), "mso-discovery-"));
const rootA = path.join(base, "root-a");
const rootB = path.join(base, "root-b");
const widgetA = path.join(rootA, "widget");
const widgetB = path.join(rootB, "widget");
const gadget = path.join(rootA, "gadget");

async function skill(dir: string, name: string, description: string, body = "step one\n") {
  const target = path.join(dir, name);
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n${body}`);
}

await skill(path.join(widgetA, ".claude/skills"), "widget-deploy", "Ship the widget service from root A.");
await fs.writeFile(path.join(widgetA, "package.json"), JSON.stringify({ name: "widget", version: "0.1.0" }));
await skill(path.join(widgetB, ".claude/skills"), "widget-deploy", "Ship the widget service from root B.");
// A project whose skills ROOT escapes via symlink. The scanner rejects the root before
// opening any metadata, so it is not a readable or discoverable skill.
const escaped = path.join(base, "escaped-skills");
await skill(escaped, "gadget-wild", "Unverified, outside its project.");
await fs.mkdir(path.join(gadget, ".codex"), { recursive: true });
await fs.symlink(escaped, path.join(gadget, ".codex/skills"));

// A project skill whose SKILL.md is itself a SYMLINK to another real SKILL.md. This is
// not "untrusted", it is not a skill at all: the reader is nofollow at that component.
await fs.mkdir(path.join(widgetA, ".mso/skills/borrowed"), { recursive: true });
await fs.symlink(
  path.join(widgetA, ".claude/skills/widget-deploy/SKILL.md"),
  path.join(widgetA, ".mso/skills/borrowed/SKILL.md"),
);

const previous = process.env.OS_FS_READ_ROOTS;
process.env.OS_FS_READ_ROOTS = `${rootA}:${rootB}`;
const { DISCOVERY_TOOLS } = await import("./tools-discovery");
const { projectRefFor } = await import("@/lib/skills/project-skills");

/** Ids are COMPUTED the way the catalog computes them — never typed by hand, because
 *  the whole fix is that they depend on which configured root the project came from. */
const projectId = async (dir: string) => projectRefFor(dir, await fs.realpath(path.dirname(dir))).id;
const skillId = async (dir: string, name: string) => `${await projectId(dir)}/${name}`;

const tool = (name: string) => {
  const found = DISCOVERY_TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`missing ${name}`);
  return found;
};
const run = (name: string, args: Record<string, unknown> = {}) => tool(name).run(args, { scope: "read" as const });


afterAll(async () => {
  if (previous === undefined) delete process.env.OS_FS_READ_ROOTS;
  else process.env.OS_FS_READ_ROOTS = previous;
  await fs.rm(base, { recursive: true, force: true });
});

describe("skills_read reads the exact catalog id only", () => {
  it("returns instructions for a trusted project skill", async () => {
    const result = await run("skills_read", { name: await skillId(widgetA, "widget-deploy") }) as
      { content: string; project: { name: string }; trust: string };
    expect(result.trust).toBe("local");
    expect(result.project.name).toBe("widget");
    expect(result.content).toContain("# widget-deploy");
    expect(result.content).toContain("root A");
  });

  it("returns instructions for an official global skill", async () => {
    const result = await run("skills_read", { name: "mso" }) as { content: string; trust: string };
    expect(result.trust).toBe("official");
    expect(result.content.length).toBeGreaterThan(0);
  });

  it("refuses an exact id whose project skill root escapes through a symlink", async () => {
    await expect(run("skills_read", { name: await skillId(gadget, "gadget-wild") }))
      .rejects.toThrow(/unknown skill id/);
  });

  it("REFUSES an ambiguous bare name and lists the exact ids", async () => {
    // Two projects called `widget`, each shipping `widget-deploy`. Guessing here would
    // hand the model another project's instructions under the name it asked for.
    await expect(run("skills_read", { name: "widget-deploy" })).rejects.toThrow(/ambiguous across projects/);
    await expect(run("skills_read", { name: "widget/widget-deploy" })).rejects.toThrow(/ambiguous across projects/);
    await expect(run("skills_read", { name: "widget-deploy" })).rejects.toThrow(await projectId(widgetA));
  });

  it("does not resolve a bare name from a rejected symlink root", async () => {
    await expect(run("skills_read", { name: "gadget-wild" })).rejects.toThrow(/unknown skill id/);
  });

  it("refuses an unknown id rather than guessing", async () => {
    await expect(run("skills_read", { name: "does-not-exist" })).rejects.toThrow(/skills_list/);
  });
});
