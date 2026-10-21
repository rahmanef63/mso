import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const UPDATE = path.join(ROOT, "scripts/mso-update");
const LIBS = ["private-state.sh", "update-state.sh", "runtime-exclusion.sh", "update-gateway-runtimes.sh", "update-git-authority.sh", "update-remote-authority.sh"];
const roots: string[] = [];

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/**
 * Fixture: `main` is one commit PAST the release tag v0.2.0, and origin/main has
 * moved one commit further with no tag. So:
 *   stable → HEAD is already the tag's commit → "up to date" (NOT main's tip)
 *   main   → one commit available
 */
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mso-update-stable-")); roots.push(root);
  const repo = path.join(root, "repo"), remote = path.join(root, "remote.git"), home = path.join(root, "home");
  fs.mkdirSync(path.join(repo, "scripts/lib"), { recursive: true }); fs.mkdirSync(path.join(repo, "bin")); fs.mkdirSync(home);
  for (const lib of LIBS) fs.copyFileSync(path.join(ROOT, "scripts/lib", lib), path.join(repo, "scripts/lib", lib));
  fs.copyFileSync(path.join(ROOT, "scripts/self-update.sh"), path.join(repo, "scripts/self-update.sh"));
  fs.chmodSync(path.join(repo, "scripts/self-update.sh"), 0o755);
  fs.writeFileSync(path.join(repo, "bin/mso"), '#!/bin/sh\nVERSION="1.0.0"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(repo, "scripts/mso-gateway"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  git(repo, "init", "-q", "-b", "main"); git(repo, "config", "user.name", "MSO Test"); git(repo, "config", "user.email", "mso@example.invalid");
  git(repo, "add", "."); git(repo, "commit", "-q", "-m", "release 1.0.0");
  git(repo, "tag", "-a", "v0.2.0", "-m", "release");
  git(root, "init", "--bare", "-q", remote); git(repo, "remote", "add", "origin", remote); git(repo, "push", "-q", "-u", "origin", "main", "--tags");
  // A commit on top of the tag, already in the checkout, plus one more only on origin.
  fs.writeFileSync(path.join(repo, "after-tag.txt"), "1\n"); git(repo, "add", "."); git(repo, "commit", "-q", "-m", "after the tag");
  git(repo, "push", "-q", "origin", "main");
  fs.writeFileSync(path.join(repo, "on-origin.txt"), "2\n"); git(repo, "add", "."); git(repo, "commit", "-q", "-m", "only on origin");
  git(repo, "push", "-q", "origin", "main");
  git(repo, "reset", "-q", "--hard", "HEAD~1");
  fs.mkdirSync(path.join(home, ".mso"), { recursive: true });
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, MSO_UPDATE_ROOT: repo,
    MSO_UPDATE_STATE_DIR: path.join(root, "update-state"), MSO_UPDATE_NOTICE_DIR: path.join(root, "notice"),
    PATH: `${path.join(root, "bin")}:${process.env.PATH}` };
  fs.mkdirSync(path.join(root, "bin"));
  fs.writeFileSync(path.join(root, "bin", "systemctl"), "#!/bin/sh\nexit 3\n", { mode: 0o755 });
  return { repo, home, env, tagCommit: git(repo, "rev-parse", "v0.2.0") };
}

function setChannel(home: string, channel: "stable" | "main") {
  fs.writeFileSync(path.join(home, ".mso/prefs.json"), JSON.stringify({ updates: { auto: false, channel } }), { mode: 0o600 });
}

afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("mso update channel selection", () => {
  it("keeps the stable channel honest: a checkout past the newest tag is 'up to date', not main's tip", () => {
    const f = fixture();
    setChannel(f.home, "stable");
    const out = execFileSync(UPDATE, ["status"], { env: f.env, encoding: "utf8" });
    expect(out).toContain("channel: stable");
    expect(out).toContain("release v0.2.0");
    // Either exact wording is fine; what matters is that no release commit is offered.
    expect(out).toMatch(/is up to date|source is current/);
    expect(out).not.toContain("update available");
    // The commit that exists only on origin/main must NOT be offered as a release.
    expect(out).not.toContain("only on origin");
  });

  it("offers the rolling commit on the main channel", () => {
    const f = fixture();
    setChannel(f.home, "main");
    const out = execFileSync(UPDATE, ["status"], { env: f.env, encoding: "utf8" });
    expect(out).toContain("channel: main");
    expect(out).toContain("update available");
    expect(out).toContain("only on origin");
    expect(git(f.repo, "rev-parse", "HEAD")).not.toBe(git(f.repo, "rev-parse", "origin/main"));
  });

  it("says out loud when stable has no tag to follow at all", () => {
    const f = fixture();
    setChannel(f.home, "stable");
    for (const tag of ["v0.2.0"]) git(f.repo, "tag", "-d", tag);
    git(f.repo, "push", "-q", "origin", "--delete", "v0.2.0");
    const out = execFileSync(UPDATE, ["status"], { env: f.env, encoding: "utf8" });
    expect(out).toContain("no release tag exists yet");
  });

  it("refuses to fast-forward when HEAD is not an ancestor of the release tag", () => {
    const f = fixture();
    setChannel(f.home, "stable");
    // Rewrite main so the tag commit is no longer reachable from HEAD.
    git(f.repo, "checkout", "-q", "--orphan", "rewritten");
    fs.writeFileSync(path.join(f.repo, "other.txt"), "x\n"); git(f.repo, "add", "."); git(f.repo, "commit", "-q", "-m", "unrelated");
    git(f.repo, "branch", "-M", "main");
    const before = git(f.repo, "rev-parse", "HEAD");
    const out = spawnSync(path.join(f.repo, "scripts/self-update.sh"), ["--channel=stable"], {
      env: { ...f.env, MSO_UPDATE_LOG: path.join(f.repo, "log.txt") }, encoding: "utf8",
    });
    expect(out.status).not.toBe(0);
    expect(fs.existsSync(path.join(f.repo, "log.txt"))).toBe(true);
    expect(fs.readFileSync(path.join(f.repo, "log.txt"), "utf8")).toMatch(/reconcile first|diverged/);
    expect(git(f.repo, "rev-parse", "HEAD")).toBe(before);
  });
});
