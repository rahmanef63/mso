import { afterAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { promises as fs } from "fs";
import os from "os";
import path from "path";

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
await fs.writeFile(path.join(widgetA, ".mcp.json"), JSON.stringify({ mcpServers: { local: { command: "ignored-secret-free-fixture" } } }));
await fs.mkdir(path.join(widgetA, ".mso"), { recursive: true });
await fs.writeFile(path.join(widgetA, ".mso/functions.json"), JSON.stringify({
  version: 1,
  functions: [{
    name: "widget_status", description: "Read widget status.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    command: [process.execPath, "-e", "process.stdout.write('ok')"],
  }],
}));
await skill(path.join(widgetB, ".claude/skills"), "widget-deploy", "Ship the widget service from root B.");
// A project whose skills ROOT escapes via symlink. The hardened scanner rejects the
// root before opening any metadata, so the outside tree is not cataloged at all.
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

type SkillRow = { id: string; trust: string; instructionsReadable: boolean; project?: { id: string; name: string } };
type Scan = { truncated: boolean; truncationReasons: string[] };

afterAll(async () => {
  if (previous === undefined) delete process.env.OS_FS_READ_ROOTS;
  else process.env.OS_FS_READ_ROOTS = previous;
  await fs.rm(base, { recursive: true, force: true });
});

describe("projects_list", () => {
  it("is a read tool with a read-only annotation", () => {
    expect(tool("projects_list").scope).toBe("read");
    expect(tool("projects_list").annotations?.readOnlyHint).toBe(true);
  });

  it("enumerates every project across BOTH containers, keeping same-named ones distinct", async () => {
    const result = await run("projects_list") as {
      total: number; scan: Scan; projects: Array<{ id: string; name: string; rootId: string; packageName?: string; capabilities?: Record<string, unknown> }>;
    };
    expect(result.projects.map((p) => p.name)).toEqual(["gadget", "widget", "widget"]);
    expect(new Set(result.projects.map((p) => p.id)).size).toBe(3);
    expect(result.total).toBe(3);
    const optedIn = result.projects.find((p) => p.packageName === "widget");
    expect(optedIn).toBeDefined();
    expect(optedIn?.capabilities).toMatchObject({ mcp: { config: ".mcp.json" }, functions: { valid: true, count: 1 } });
  });

  it("reports a truthful scan report on a complete enumeration", async () => {
    const { scan } = await run("projects_list") as { scan: Scan & { scannedRoots: string[] } };
    expect(scan).toMatchObject({ truncated: false, truncationReasons: [] });
    expect(scan.scannedRoots.length).toBeGreaterThanOrEqual(2);
  });

  it("filters and paginates", async () => {
    const result = await run("projects_list", { query: "wid", limit: 1 }) as { total: number; limit: number; projects: Array<{ name: string }> };
    expect(result).toMatchObject({ total: 2, limit: 1 });
    expect(result.projects.map((p) => p.name)).toEqual(["widget"]);
  });
});

describe("project_capabilities", () => {
  it("returns only public capability metadata for one exact project", async () => {
    const result = await run("project_capabilities", { project: await projectId(widgetA) }) as {
      capabilities: { mcp?: { config: string }; functions?: { valid: boolean; tools?: Array<{ name: string }> } };
    };
    expect(result.capabilities.mcp).toEqual({ config: ".mcp.json" });
    expect(result.capabilities.functions).toMatchObject({ valid: true, tools: [{ name: "widget_status" }] });
    expect(JSON.stringify(result)).not.toContain(process.execPath);
  });
});

describe("skills_list spans global and project roots", () => {
  it("returns official repo skills AND per-project skills in one catalog", async () => {
    const { skills, scan } = await run("skills_list", { limit: 200 }) as { skills: SkillRow[]; scan: Scan };
    const ids = skills.map((s) => s.id);
    const deployA = await skillId(widgetA, "widget-deploy");
    expect(ids).toContain("mso"); // official, from this repo's claude-skills/
    expect(ids).toContain(deployA);
    expect(skills.find((s) => s.id === deployA)).toMatchObject({
      trust: "local", instructionsReadable: true, project: { name: "widget" },
    });
    expect(scan).toHaveProperty("truncated");
  });

  it("keeps BOTH same-named projects' skills visible under distinct ids", async () => {
    const { skills } = await run("skills_list", { limit: 200 }) as { skills: SkillRow[] };
    const a = await skillId(widgetA, "widget-deploy");
    const b = await skillId(widgetB, "widget-deploy");
    expect(a).not.toBe(b);
    expect(skills.map((s) => s.id)).toEqual(expect.arrayContaining([a, b]));
  });

  it("does not traverse a project skill root that escapes through a symlink", async () => {
    const { skills } = await run("skills_list", { limit: 200 }) as { skills: SkillRow[] };
    const wild = await skillId(gadget, "gadget-wild");
    expect(skills.map((s) => s.id)).not.toContain(wild);
  });

  it("DROPS a skill whose SKILL.md is a symlink — nofollow means it is not a skill", async () => {
    const { skills } = await run("skills_list", { limit: 200 }) as { skills: SkillRow[] };
    const borrowed = await skillId(widgetA, "borrowed");
    expect(skills.map((s) => s.id)).not.toContain(borrowed);
  });

  it("reports resumable continuation only when the scan was truncated", async () => {
    const { scan } = await run("skills_list", { limit: 200 }) as {
      scan: Scan & { continuation?: { cursor: string } };
    };
    expect(scan.truncated).toBe(false);
    expect(scan.continuation).toBeUndefined();
  });

  it("filters by an exact projectId", async () => {
    const only = await run("skills_list", { project: await projectId(widgetA) }) as { skills: SkillRow[]; ambiguousProjects?: unknown };
    expect(only.skills.map((s) => s.id)).toEqual([await skillId(widgetA, "widget-deploy")]);
    expect(only.ambiguousProjects).toBeUndefined();
  });

  it("keeps a bare ambiguous project name inclusive, and says which ids it could mean", async () => {
    const both = await run("skills_list", { project: "widget" }) as {
      skills: SkillRow[]; ambiguousProjects?: Array<{ projectId: string; name: string }>;
    };
    expect(both.skills).toHaveLength(2);
    expect(both.ambiguousProjects).toHaveLength(2);
    expect(both.ambiguousProjects!.map((p) => p.projectId).sort())
      .toEqual([await projectId(widgetA), await projectId(widgetB)].sort());
  });

  it("filters by trust", async () => {
    const official = await run("skills_list", { trust: "official", limit: 200 }) as { skills: SkillRow[] };
    expect(official.skills.every((s) => s.trust === "official")).toBe(true);
    expect(official.skills.some((s) => s.project)).toBe(false);
  });
});
