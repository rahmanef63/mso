// The preflight decides whether a user's own MSO edits survive an update. These
// tests run REAL git in a throwaway repository: merge-tree's conflict output is the
// whole contract here, and a mock would only prove the mock.
import { execFile } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { preflightUpdateConflicts, updateConflictPrompt, type UpdateConflictReport } from "./update-conflict";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function gitIn(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, encoding: "utf8" }, (error, stdout, stderr) => {
      const code = typeof (error as { code?: number } | null)?.code === "number" ? (error as { code: number }).code : error ? 1 : 0;
      resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}

async function git(repo: string, ...args: string[]): Promise<string> {
  const ran = await gitIn(repo, args);
  if (ran.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${ran.stderr}`);
  return ran.stdout.trim();
}

/** base commit, then an `incoming` branch that rewrites base.txt and adds new.txt. */
async function repoFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "mso-update-conflict-"));
  chmodSync(root, 0o700);
  roots.push(root);
  const repo = path.join(root, "repo");
  mkdirSync(repo, { recursive: true });
  await git(repo, "init", "-q", "-b", "main");
  await git(repo, "config", "user.name", "MSO Test");
  await git(repo, "config", "user.email", "test@example.invalid");
  writeFileSync(path.join(repo, "base.txt"), "base\n");
  writeFileSync(path.join(repo, "notes.txt"), "notes\n");
  await git(repo, "add", ".");
  await git(repo, "commit", "-qm", "base");
  const base = await git(repo, "rev-parse", "HEAD");

  await git(repo, "checkout", "-q", "-b", "incoming");
  writeFileSync(path.join(repo, "base.txt"), "incoming base\n");
  writeFileSync(path.join(repo, "new.txt"), "incoming new\n");
  await git(repo, "add", ".");
  await git(repo, "commit", "-qm", "incoming change");
  const incoming = await git(repo, "rev-parse", "HEAD");
  await git(repo, "checkout", "-q", "main");
  return { root, repo, base, incoming, preflight: () => preflightUpdateConflicts({ targetRef: incoming, runner: (args) => gitIn(repo, args) }) };
}

describe("preflightUpdateConflicts", () => {
  it("reports a clean checkout as safe with nothing carried or conflicted", async () => {
    const { preflight } = await repoFixture();
    const report = await preflight();
    expect(report).toMatchObject({ conflicted: [], carried: [], overlap: [], safe: true });
  });

  it("keeps a dirty checkout safe when its files do not overlap the incoming ones", async () => {
    const { repo, preflight } = await repoFixture();
    writeFileSync(path.join(repo, "notes.txt"), "my notes\n");
    writeFileSync(path.join(repo, "mine.txt"), "my private tweak\n");
    const report = await preflight();
    expect(report.safe).toBe(true);
    expect(report.conflicted).toEqual([]);
    expect(report.carried.sort()).toEqual(["mine.txt", "notes.txt"]);
    expect(report.overlap).toEqual([]);
  });

  it("refuses to call an update safe when a dirty file overlaps an incoming path", async () => {
    const { repo, preflight } = await repoFixture();
    writeFileSync(path.join(repo, "base.txt"), "my conflicting edit\n");
    const report = await preflight();
    expect(report.safe).toBe(false);
    expect(report.overlap).toEqual(["base.txt"]);
    expect(report.carried).toEqual(["base.txt"]);
  });

  it("names the exact file git cannot merge when local commits conflict with the target", async () => {
    const { repo, incoming, preflight } = await repoFixture();
    writeFileSync(path.join(repo, "base.txt"), "my committed edit\n");
    await git(repo, "commit", "-qam", "my local commit");
    const report = await preflight();
    expect(report.safe).toBe(false);
    expect(report.conflicted).toEqual(["base.txt"]);
    expect(report.carried).toEqual(["base.txt"]);
    expect(report.overlap).toEqual(["base.txt"]);
    // The target still moves to the same commit; nothing above resolved it.
    expect(await git(repo, "rev-parse", incoming)).toBe(incoming);
  });

  it("never mutates the worktree or HEAD", async () => {
    const { repo, preflight } = await repoFixture();
    writeFileSync(path.join(repo, "base.txt"), "local edit\n");
    writeFileSync(path.join(repo, "untracked.txt"), "untracked\n");
    const headBefore = await git(repo, "rev-parse", "HEAD");
    const statusBefore = await git(repo, "status", "--porcelain");
    const filesBefore = await git(repo, "ls-files");
    const stashBefore = await git(repo, "stash", "list");

    await preflight();

    expect(await git(repo, "rev-parse", "HEAD")).toBe(headBefore);
    expect(await git(repo, "status", "--porcelain")).toBe(statusBefore);
    expect(await git(repo, "ls-files")).toBe(filesBefore);
    expect(await git(repo, "stash", "list")).toBe(stashBefore);
  });

  it("fails closed when the target ref does not exist", async () => {
    const { repo } = await repoFixture();
    const report = await preflightUpdateConflicts({ targetRef: "no-such-ref", runner: (args) => gitIn(repo, args) });
    expect(report.safe).toBe(false);
    expect(report.detail.length).toBeGreaterThan(0);
  });

  it("redacts credentials that git echoes back in its stderr", async () => {
    const report = await preflightUpdateConflicts({
      targetRef: "origin/main",
      runner: async () => ({ code: 128, stdout: "", stderr: "fatal: could not read token=ghp_abcdefghijklmnopqrstuvwxyz123456" }),
    });
    expect(report.safe).toBe(false);
    expect(report.detail).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz123456");
    expect(report.detail).toContain("[redacted]");
  });
});

describe("updateConflictPrompt", () => {
  const report: UpdateConflictReport = {
    conflicted: ["app/layout.tsx", "lib/host/self-update.ts"],
    carried: ["app/layout.tsx", "config/local.json"],
    overlap: ["app/layout.tsx"],
    safe: false,
    detail: "CONFLICT (content): Merge conflict in app/layout.tsx",
  };

  it("pastes every path verbatim and refuses destructive shortcuts", () => {
    const prompt = updateConflictPrompt(report, { target: "v0.9.0", current: "e25c00d7" });
    for (const file of [...report.conflicted, ...report.carried, ...report.overlap]) {
      expect(prompt).toContain(file);
    }
    expect(prompt).toContain("v0.9.0");
    expect(prompt).toContain("e25c00d7");
    expect(prompt).toContain("git push --force");
    expect(prompt).toContain("git reset --hard");
    expect(prompt).toContain("~/.mso");
    expect(prompt).toContain("report back");
    // Plain text for a chat box, not a rendered fence.
    expect(prompt).not.toContain("```");
  });

  it("says plainly when carry-over is the only thing to do", () => {
    const safe = updateConflictPrompt(
      { conflicted: [], carried: ["mine.txt"], overlap: [], safe: true, detail: "no merge conflicts" },
      { target: "origin/main", current: "abc1234" },
    );
    expect(safe).toContain("only carry-over and overlap apply");
    expect(safe).toContain("mine.txt");
    expect(safe).toContain("Update safe to apply as-is: yes");
  });
});
