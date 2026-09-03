import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectProjectConvex, projectGitDiff, projectGitEdits, projectGitSnapshot, readProjectKnowledge } from "./project-experience";

const root = await mkdtemp(path.join(os.tmpdir(), "mso-project-exp-"));
const project = path.join(root, "app");

beforeAll(async () => {
  await mkdir(project, { recursive: true });
  await writeFile(path.join(project, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0", dependencies: { convex: "1.0.0" } }));
  await mkdir(path.join(project, "convex"));
  execFileSync("git", ["init", "-b", "main"], { cwd: project });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: project });
  execFileSync("git", ["config", "user.name", "MSO Test"], { cwd: project });
  await writeFile(path.join(project, "a.txt"), "one\n");
  execFileSync("git", ["add", "."], { cwd: project });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: project });
  await writeFile(path.join(project, "a.txt"), "one\ntwo\n");
  execFileSync("git", ["add", "a.txt"], { cwd: project });
  execFileSync("git", ["commit", "-m", "second"], { cwd: project });
  await writeFile(path.join(project, "a.txt"), "one\ntwo\nworking\n");
});

afterAll(async () => rm(root, { recursive: true, force: true }));

describe("project experience host helpers", () => {
  it("returns bounded Git snapshot, history and working-tree diff", async () => {
    const snapshot = await projectGitSnapshot(project);
    expect(snapshot).toMatchObject({ available: true, clean: false });
    expect(snapshot.branch).toContain("main");
    expect(snapshot.changes).toContain(" M a.txt");

    const edits = await projectGitEdits(project, { limit: 1 });
    expect(edits.edits).toHaveLength(1);
    expect(edits.edits[0].subject).toBe("second");
    expect(edits.pagination.hasMore).toBe(true);
    const page2 = await projectGitEdits(project, { limit: 5, cursor: edits.pagination.nextCursor });
    expect(page2.edits.some((row) => row.subject === "initial")).toBe(true);

    const diff = await projectGitDiff(project);
    expect(diff.summary).toMatchObject({ files: 1, additions: 1, deletions: 0 });
    expect(diff.unifiedDiff).toContain("+working");
  });

  it("keeps project knowledge bounded and refuses symlinks", async () => {
    await mkdir(path.join(project, ".mso"), { recursive: true });
    await writeFile(path.join(project, ".mso", "KNOWLEDGE.md"), "# Project knowledge\nUse Convex.\n");
    const knowledge = await readProjectKnowledge(project);
    expect(knowledge).toMatchObject({ exists: true, path: ".mso/KNOWLEDGE.md" });
    expect(knowledge.sha256).toMatch(/^[a-f0-9]{64}$/);

    const target = path.join(root, "outside.md");
    await writeFile(target, "outside");
    await rm(path.join(project, ".mso", "KNOWLEDGE.md"));
    await symlink(target, path.join(project, ".mso", "KNOWLEDGE.md"));
    await expect(readProjectKnowledge(project)).rejects.toThrow(/regular non-symlink/i);
  });

  it("detects Convex without returning deployment values", async () => {
    await writeFile(path.join(project, ".env.local"), "CONVEX_SELF_HOSTED_URL=https://secret.example\n");
    const detected = await detectProjectConvex(project);
    expect(detected).toMatchObject({ detected: true, dependency: true, convexDirectory: true, configured: true, mode: "self-hosted" });
    expect(JSON.stringify(detected)).not.toContain("secret.example");
  });
});
