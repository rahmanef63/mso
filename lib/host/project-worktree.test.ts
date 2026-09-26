import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discardPreparedProjectWorktree, discardWorkflowWorktreeIfUnchanged, linkedWorkflowWorktreeCanonicalPath, prepareProjectWorktree } from "./project-worktree";

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repoFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "mso-workspace-test-")); roots.push(root);
  const repo = path.join(root, "project"), worktrees = path.join(root, "worktrees");
  mkdirSync(repo); writeFileSync(path.join(repo, "README.md"), "fixture\n");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main"); git("config", "user.name", "MSO Test"); git("config", "user.email", "test@example.invalid");
  git("add", "."); git("commit", "-qm", "initial");
  vi.stubEnv("MSO_AGENT_WORKTREE_ROOT", worktrees);
  return { root, repo, worktrees, git };
}

describe("task-owned project worktrees", () => {
  it("creates a clean linked worktree at the exact canonical commit", async () => {
    const { repo } = repoFixture();
    const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
    const result = await prepareProjectWorktree(repo);
    expect(result).toMatchObject({ canonicalPath: repo, baseCommit: base, created: true });
    expect(result.workspacePath).not.toBe(repo);
    expect(result.branch).toMatch(/^agent\/project-[a-f0-9]{12}$/);
    expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: result.workspacePath, encoding: "utf8" }).trim()).toBe(base);
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: result.workspacePath, encoding: "utf8" }).trim()).toBe("");
  });

  it("fails closed instead of stashing or hiding another owner's dirty canonical work", async () => {
    const { repo, git } = repoFixture();
    writeFileSync(path.join(repo, "README.md"), "someone else's work\n");
    await expect(prepareProjectWorktree(repo)).rejects.toThrow(/uncommitted work/i);
    expect(git("status", "--porcelain")).toContain("README.md");
    expect(git("stash", "list")).toBe("");
  });

  it("reuses an already-linked worktree rather than nesting another worktree", async () => {
    const { repo } = repoFixture();
    const first = await prepareProjectWorktree(repo);
    const second = await prepareProjectWorktree(first.workspacePath);
    expect(second).toMatchObject({ workspacePath: first.workspacePath, baseCommit: first.baseCommit, created: false });
  });

  it("maps only an MSO-owned linked worktree back to its canonical checkout", async () => {
    const { repo } = repoFixture();
    const workspace = await prepareProjectWorktree(repo);
    await expect(linkedWorkflowWorktreeCanonicalPath(workspace.workspacePath)).resolves.toBe(repo);
    await expect(linkedWorkflowWorktreeCanonicalPath(repo)).resolves.toBeNull();
  });

  it("rolls back only a still-clean fresh worktree and preserves changed work", async () => {
    const { repo } = repoFixture();
    const clean = await prepareProjectWorktree(repo);
    await expect(discardPreparedProjectWorktree(clean)).resolves.toBe(true);
    await expect(fs.lstat(clean.workspacePath)).rejects.toMatchObject({ code: "ENOENT" });

    const changed = await prepareProjectWorktree(repo);
    await fs.writeFile(path.join(changed.workspacePath, "README.md"), "unique work\n");
    await expect(discardPreparedProjectWorktree(changed)).resolves.toBe(false);
    expect(await fs.readFile(path.join(changed.workspacePath, "README.md"), "utf8")).toBe("unique work\n");
  });

  it("can clean an unchanged workflow workspace from persisted path/base evidence", async () => {
    const { repo } = repoFixture();
    const workspace = await prepareProjectWorktree(repo);
    await expect(discardWorkflowWorktreeIfUnchanged({
      canonicalPath: repo, workspacePath: workspace.workspacePath, baseCommit: workspace.baseCommit,
    })).resolves.toBe(true);
    await expect(fs.lstat(workspace.workspacePath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
