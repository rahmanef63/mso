import { afterAll, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

// CONTINUATION MUST BE LOSSLESS. A truncated scan that cannot be resumed to completion is
// data loss wearing a label, and every one of these cases previously returned zero rows
// on the second call while insisting there was more.
const base = await fs.mkdtemp(path.join(os.tmpdir(), "mso-cont-"));
const previous = process.env.OS_FS_READ_ROOTS;
const { listProjects } = await import("./project-list");
const { PROJECT_LIMITS } = await import("./project-roots");
const setRoots = (...roots: string[]) => { process.env.OS_FS_READ_ROOTS = roots.join(":"); };

afterAll(async () => {
  if (previous === undefined) delete process.env.OS_FS_READ_ROOTS;
  else process.env.OS_FS_READ_ROOTS = previous;
  await fs.rm(base, { recursive: true, force: true });
});

/**
 * Drain everything. There are deliberately TWO paginations and a caller has to use both:
 * `hasMore`/`nextOffset` walks the rows of ONE scan, `scan.continuation.cursor` resumes
 * the scan itself past a cap. Conflating them is how you conclude data is missing when
 * it is merely on the next page.
 */
async function drain(cursor?: string) {
  const seen = new Set<string>();
  for (let scan = 0; scan < 40; scan += 1) {
    let page = await listProjects({ limit: PROJECT_LIMITS.maxPageSize, cursor });
    for (const p of page.projects) seen.add(p.path);
    while (page.hasMore) {
      page = await listProjects({ limit: PROJECT_LIMITS.maxPageSize, offset: page.nextOffset, cursor });
      for (const p of page.projects) seen.add(p.path);
    }
    if (!page.scan.truncated || !page.scan.continuation?.cursor) break;
    if (page.scan.continuation.cursor === cursor) break; // no forward progress
    cursor = page.scan.continuation.cursor;
  }
  return seen;
}

describe("maxRoots continuation advances past the capped prefix", () => {
  it("reaches projects in the 13th configured root", async () => {
    const roots: string[] = [];
    for (let i = 0; i <= PROJECT_LIMITS.maxRoots; i += 1) {
      const dir = path.join(base, `mr-${String(i).padStart(2, "0")}`);
      await fs.mkdir(path.join(dir, `p${i}`), { recursive: true });
      roots.push(dir);
    }
    setRoots(...roots);

    const first = await listProjects({ limit: PROJECT_LIMITS.maxPageSize });
    expect(first.scan.truncated).toBe(true);
    expect(first.scan.truncationReasons).toContain("maxRoots");

    const all = await drain();
    // The last root's project must be reachable, not merely reported as pending.
    expect([...all].some((p) => p.endsWith(`mr-${PROJECT_LIMITS.maxRoots}/p${PROJECT_LIMITS.maxRoots}`))).toBe(true);
    expect(all.size).toBe(PROJECT_LIMITS.maxRoots + 1);
  });
});

describe("maxProjects continuation keeps the exact raw dirent position", () => {
  it("returns the remaining projects instead of zero", async () => {
    // Two roots of 250 each: the cap trips mid-way through the SECOND root, which is
    // exactly where a cursor derived from a global accepted-count went wrong.
    const a = path.join(base, "mp-a");
    const b = path.join(base, "mp-b");
    const per = 250;
    await Promise.all([a, b].flatMap((root) =>
      Array.from({ length: per }, (_, i) => fs.mkdir(path.join(root, `p${String(i).padStart(4, "0")}`), { recursive: true }))));
    setRoots(a, b);

    const first = await listProjects({ limit: PROJECT_LIMITS.maxPageSize });
    expect(first.scan.truncated).toBe(true);
    expect(first.scan.truncationReasons).toContain("maxProjects");

    const all = await drain();
    expect(all.size).toBe(per * 2);
  });
});

describe("maxEntriesPerRoot continuation resumes at the exact position", () => {
  it("returns every project across repeated pages", async () => {
    const root = path.join(base, "me-root");
    const count = PROJECT_LIMITS.maxEntriesPerRoot + 37;
    await Promise.all(Array.from({ length: count }, (_, i) =>
      fs.mkdir(path.join(root, `p${String(i).padStart(4, "0")}`), { recursive: true })));
    setRoots(root);

    const first = await listProjects({ limit: PROJECT_LIMITS.maxPageSize });
    expect(first.scan.truncated).toBe(true);
    const all = await drain();
    expect(all.size).toBe(count);
  });

  it("never re-reports a project already returned by an earlier page", async () => {
    const root = path.join(base, "me-dup");
    const count = PROJECT_LIMITS.maxEntriesPerRoot + 5;
    await Promise.all(Array.from({ length: count }, (_, i) =>
      fs.mkdir(path.join(root, `p${String(i).padStart(4, "0")}`), { recursive: true })));
    setRoots(root);

    // One full scan (both its pages), then the resumed scan: no row may appear twice.
    const firstA = await listProjects({ limit: PROJECT_LIMITS.maxPageSize });
    const firstB = await listProjects({ limit: PROJECT_LIMITS.maxPageSize, offset: firstA.nextOffset });
    const firstPaths = new Set([...firstA.projects, ...firstB.projects].map((p) => p.path));
    expect(firstPaths.size).toBe(PROJECT_LIMITS.maxEntriesPerRoot);

    const second = await listProjects({ limit: PROJECT_LIMITS.maxPageSize, cursor: firstA.scan.continuation!.cursor });
    expect(second.projects.every((p) => !firstPaths.has(p.path))).toBe(true);
    expect(firstPaths.size + second.projects.length).toBe(count);
  });
});

describe("a complete scan still reports no continuation", () => {
  it("stays truncated=false with the cursor absent", async () => {
    const root = path.join(base, "small");
    await fs.mkdir(path.join(root, "one"), { recursive: true });
    setRoots(root);
    const { scan, projects } = await listProjects();
    expect(scan.truncated).toBe(false);
    expect(scan.continuation).toBeUndefined();
    expect(projects.map((p) => p.name)).toEqual(["one"]);
  });
});
