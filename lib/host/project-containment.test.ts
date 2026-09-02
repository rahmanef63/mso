import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

// The fail-closed half of project discovery: what must NOT be enumerated, and what
// must be reported when the scan does not cover everything. Positive multi-root
// behaviour lives in project-roots.test.ts.
const base = await fs.mkdtemp(path.join(os.tmpdir(), "mso-contain-"));
const previous = process.env.OS_FS_READ_ROOTS;

const {
  authorizedRoots, listProjectDirs, projectContainers, projectRoots, PROJECT_LIMITS,
} = await import("./project-roots");
const { listProjects } = await import("./project-list");

const setRoots = (...roots: string[]) => { process.env.OS_FS_READ_ROOTS = roots.join(":"); };

afterAll(async () => {
  if (previous === undefined) delete process.env.OS_FS_READ_ROOTS;
  else process.env.OS_FS_READ_ROOTS = previous;
  await fs.rm(base, { recursive: true, force: true });
});
beforeEach(() => { vi.restoreAllMocks(); });

describe("a symlinked projects/ container cannot escape the read roots", () => {
  it("refuses <root>/projects when it is a symlink pointing OUTSIDE every authorized root", async () => {
    const safe = path.join(base, "esc-safe");
    const outside = path.join(base, "esc-outside");
    await fs.mkdir(path.join(outside, "loot"), { recursive: true });
    await fs.mkdir(safe, { recursive: true });
    await fs.symlink(outside, path.join(safe, "projects"));
    setRoots(safe);

    const containers = await projectContainers();
    expect(containers.map((c) => c.path)).toEqual([await fs.realpath(safe)]);
    const { dirs } = await listProjectDirs();
    expect(dirs.map((d) => path.basename(d.dir))).not.toContain("loot");
  });

  it("refuses a symlinked projects/ EVEN WHEN its target is inside an authorized root", async () => {
    // A symlink is not a container, full stop. Accepting it because "the target is
    // fine right now" is a TOCTOU bet: the link can be repointed between the check
    // and the walk, and nothing re-validates.
    const safe = path.join(base, "in-safe");
    await fs.mkdir(path.join(safe, "real-projects", "inner"), { recursive: true });
    await fs.symlink(path.join(safe, "real-projects"), path.join(safe, "projects"));
    setRoots(safe);

    const containers = await projectContainers();
    expect(containers.map((c) => c.path)).toEqual([await fs.realpath(safe)]);
    expect(containers.some((c) => c.derived)).toBe(false);
  });

  it("accepts a real projects/ directory as a derived container", async () => {
    const safe = path.join(base, "real-derived");
    await fs.mkdir(path.join(safe, "projects", "inner"), { recursive: true });
    setRoots(safe);

    const containers = await projectContainers();
    expect(containers.map((c) => c.derived)).toEqual([false, true]);
    const { dirs } = await listProjectDirs();
    expect(dirs.map((d) => path.basename(d.dir))).toEqual(["inner"]);
  });
});

describe("project entries are never followed through a symlink", () => {
  it("skips a symlinked project entry whose target is outside the container", async () => {
    const root = path.join(base, "entry-root");
    const outside = path.join(base, "entry-outside");
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, "package.json"), JSON.stringify({ name: "sneaky" }));
    await fs.mkdir(path.join(root, "honest"), { recursive: true });
    await fs.symlink(outside, path.join(root, "linked"));
    setRoots(root);

    const { projects } = await listProjects();
    expect(projects.map((p) => p.name)).toEqual(["honest"]);
  });

  it("skips hidden directories", async () => {
    const root = path.join(base, "hidden-root");
    await fs.mkdir(path.join(root, ".secret"), { recursive: true });
    await fs.mkdir(path.join(root, "shown"), { recursive: true });
    setRoots(root);
    const { projects } = await listProjects();
    expect(projects.map((p) => p.name)).toEqual(["shown"]);
  });

  it("skips a project directory not owned by the uid MSO runs as", async () => {
    const root = path.join(base, "uid-root");
    await fs.mkdir(path.join(root, "theirs"), { recursive: true });
    setRoots(root);
    await expect(listProjects().then((r) => r.projects.map((p) => p.name))).resolves.toEqual(["theirs"]);

    // Same tree, different apparent owner: ownership is checked BEFORE any metadata
    // read, so a directory another user controls never reaches packageMeta.
    const real = process.getuid!();
    vi.spyOn(process, "getuid").mockReturnValue(real + 4242);
    const { projects, scan } = await listProjects();
    expect(projects).toEqual([]);
    expect(scan.skippedProjects).toBeGreaterThan(0);
  });
});

describe("truncation is reported truthfully, never as a silent slice", () => {
  it("reports truncated + a maxRoots reason when more roots are configured than scanned", async () => {
    const many: string[] = [];
    for (let i = 0; i < PROJECT_LIMITS.maxRoots + 1; i += 1) {
      const dir = path.join(base, `many-${String(i).padStart(2, "0")}`);
      await fs.mkdir(dir, { recursive: true });
      many.push(dir);
    }
    setRoots(...many);

    const roots = await authorizedRoots();
    expect(roots.length).toBe(PROJECT_LIMITS.maxRoots);
    const { scan } = await listProjects();
    expect(scan.truncated).toBe(true);
    expect(scan.truncationReasons).toContain("maxRoots");
    expect(scan.skippedRoots.length).toBeGreaterThan(0);
  });

  it("reports truncated + maxEntriesPerRoot when one container has more entries than the cap", async () => {
    const root = path.join(base, "wide-root");
    await fs.mkdir(root, { recursive: true });
    await Promise.all(
      Array.from({ length: PROJECT_LIMITS.maxEntriesPerRoot + 1 }, (_, i) =>
        fs.mkdir(path.join(root, `p${String(i).padStart(4, "0")}`), { recursive: true })),
    );
    setRoots(root);

    const { scan, total } = await listProjects();
    expect(scan.truncated).toBe(true);
    expect(scan.truncationReasons.some((r) => r.startsWith("maxEntriesPerRoot"))).toBe(true);
    expect(total).toBeLessThanOrEqual(PROJECT_LIMITS.maxEntriesPerRoot);
  });

  it("reports truncated=false and no reasons when the whole tree fit", async () => {
    const root = path.join(base, "small-root");
    await fs.mkdir(path.join(root, "one"), { recursive: true });
    setRoots(root);
    const { scan } = await listProjects();
    expect(scan).toMatchObject({ truncated: false, truncationReasons: [] });
    expect(scan.scannedRoots).toHaveLength(1);
  });
});

describe("project ids are globally unique across roots", () => {
  it("keeps two same-named projects in different roots as distinct rows and ids", async () => {
    const a = path.join(base, "dup-a");
    const b = path.join(base, "dup-b");
    await fs.mkdir(path.join(a, "widget"), { recursive: true });
    await fs.mkdir(path.join(b, "widget"), { recursive: true });
    setRoots(a, b);

    const { projects } = await listProjects();
    expect(projects.map((p) => p.name)).toEqual(["widget", "widget"]);
    const ids = projects.map((p) => p.id);
    expect(new Set(ids).size).toBe(2);
    expect(new Set(projects.map((p) => p.rootId)).size).toBe(2);
    for (const p of projects) expect(p.id).toBe(`${p.rootId}/${p.name}`);
  });

  it("gives the derived projects/ container its own root id, so ~/x and ~/projects/x differ", async () => {
    const root = path.join(base, "nested-dup");
    await fs.mkdir(path.join(root, "widget"), { recursive: true });
    await fs.mkdir(path.join(root, "projects", "widget"), { recursive: true });
    setRoots(root);

    const { projects } = await listProjects();
    expect(projects).toHaveLength(2);
    expect(new Set(projects.map((p) => p.id)).size).toBe(2);
  });

  it("uses a stable short hash of the canonical container path", async () => {
    const root = path.join(base, "stable-id");
    await fs.mkdir(path.join(root, "one"), { recursive: true });
    setRoots(root);
    const first = await listProjects();
    const second = await listProjects();
    expect(first.projects[0].id).toBe(second.projects[0].id);
    // 128 bits, not 32. An 8-hex id had a REAL collision in this fixture space.
    expect(first.projects[0].rootId).toMatch(/^[a-f0-9]{32}$/);
  });

  it("still exposes plain container paths through projectRoots()", async () => {
    const root = path.join(base, "compat-root");
    await fs.mkdir(path.join(root, "one"), { recursive: true });
    setRoots(root);
    await expect(projectRoots()).resolves.toEqual([await fs.realpath(root)]);
  });
});
