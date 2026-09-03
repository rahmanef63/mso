import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(os.tmpdir(), "mso-project-tools-"));
const project = path.join(root, "widget");
const previousRead = process.env.OS_FS_READ_ROOTS;
const previousWrite = process.env.OS_FS_WRITE_ROOTS;
process.env.OS_FS_READ_ROOTS = root;
process.env.OS_FS_WRITE_ROOTS = root;

beforeAll(async () => {
  await mkdir(project, { recursive: true });
  await writeFile(path.join(project, "package.json"), JSON.stringify({ name: "widget", version: "2.0.0" }));
  execFileSync("git", ["init", "-b", "main"], { cwd: project });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: project });
  execFileSync("git", ["config", "user.name", "MSO Test"], { cwd: project });
  await writeFile(path.join(project, "index.ts"), "export const one = 1;\n");
  execFileSync("git", ["add", "."], { cwd: project });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: project });
  await writeFile(path.join(project, "index.ts"), "export const one = 1;\nexport const two = 2;\n");
});

afterAll(async () => {
  if (previousRead === undefined) delete process.env.OS_FS_READ_ROOTS; else process.env.OS_FS_READ_ROOTS = previousRead;
  if (previousWrite === undefined) delete process.env.OS_FS_WRITE_ROOTS; else process.env.OS_FS_WRITE_ROOTS = previousWrite;
  await rm(root, { recursive: true, force: true });
});

const { PROJECT_EXPERIENCE_TOOLS } = await import("./tools-project-experience");
const tool = (name: string) => {
  const found = PROJECT_EXPERIENCE_TOOLS.find((row) => row.name === name);
  if (!found) throw new Error(`missing ${name}`);
  return found;
};

describe("Lovable-inspired MSO project surfaces", () => {
  it("project_get returns a canonical safe snapshot and project_diff keeps raw diff out of widget structured content", async () => {
    const got = await tool("project_get").run({ project }, { scope: "read" }) as Record<string, unknown>;
    expect(got).toMatchObject({ project: { name: "widget" }, package: { name: "widget", version: "2.0.0" }, database: { detected: false } });
    expect(JSON.stringify(got)).not.toContain("authorization");

    const diff = await tool("project_diff").run({ project }, { scope: "read" }) as Record<string, unknown>;
    expect((diff.summary as { additions: number }).additions).toBe(1);
    const structured = tool("project_diff").toStructuredContent?.(diff);
    expect(structured).not.toHaveProperty("unifiedDiff");
    expect((diff.unifiedDiff as string)).toContain("+export const two = 2;");
  });

  it("project knowledge uses read-before-write CAS semantics", async () => {
    const set = tool("project_knowledge_set");
    await set.run({ project, content: "# Widget\nAlways verify.\n" }, { scope: "write" });
    const current = await tool("project_knowledge_get").run({ project }, { scope: "read" }) as { content: string; sha256?: string };
    expect(current.content).toContain("Always verify");
    expect(current.sha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(set.run({ project, content: "stale", expected_sha256: "0".repeat(64) }, { scope: "write" })).rejects.toThrow(/changed|sha/i);
    await set.run({ project, content: "# Widget\nUpdated.\n", expected_sha256: current.sha256 }, { scope: "write" });
  });

  it("keeps Convex schemas dynamic behind database tools", () => {
    expect(tool("project_database_status").scope).toBe("exec");
    expect(tool("project_database_tools").scope).toBe("exec");
    expect(tool("project_database_call").scope).toBe("exec");
    expect(tool("project_database_query").scope).toBe("exec");
  });
});
