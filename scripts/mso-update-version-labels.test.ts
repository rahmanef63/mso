import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = path.join(process.cwd(), "scripts/mso-update");
const roots: string[] = [];
function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mso-update-labels-")); roots.push(root);
  const repo = path.join(root, "repo"), remote = path.join(root, "remote.git"), fakeBin = path.join(root, "bin");
  fs.mkdirSync(path.join(repo, "scripts/lib"), { recursive: true }); fs.mkdirSync(path.join(repo, "bin")); fs.mkdirSync(fakeBin);
  for (const name of ["private-state.sh", "update-state.sh", "runtime-exclusion.sh", "update-gateway-runtimes.sh", "update-git-authority.sh"]) {
    fs.copyFileSync(path.join(process.cwd(), "scripts/lib", name), path.join(repo, "scripts/lib", name));
  }
  fs.writeFileSync(path.join(repo, "bin/mso"), '#!/bin/sh\nVERSION="1.3.0"\n', { mode: 0o755 });
  git(repo, "init", "-q", "-b", "main"); git(repo, "config", "user.name", "MSO Test");
  git(repo, "config", "user.email", "mso@example.invalid"); git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "initial"); const old = git(repo, "rev-parse", "HEAD");
  git(root, "init", "--bare", "-q", remote); git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-q", "-u", "origin", "main"); fs.writeFileSync(path.join(repo, "README.md"), "commit-only update\n");
  git(repo, "add", "README.md"); git(repo, "commit", "-q", "-m", "commit-only update");
  git(repo, "push", "-q", "origin", "main"); git(repo, "reset", "--hard", "-q", old);
  fs.writeFileSync(path.join(fakeBin, "systemctl"), "#!/bin/sh\nexit 3\n", { mode: 0o755 });
  return { env: { ...process.env, HOME: path.join(root, "home"), PATH: `${fakeBin}:${process.env.PATH}`,
    MSO_UPDATE_ROOT: repo, MSO_UPDATE_NOTICE_DIR: path.join(root, "notice"),
    MSO_UPDATE_STATE_DIR: path.join(root, "update-state"), MSO_RUNTIME_EXCLUSION_DIR: path.join(root, "runtime-exclusion") } };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("mso update version labels", () => {
  it("describes commit-only updates without a same-version arrow", () => {
    const f = fixture(); const out = execFileSync(SCRIPT, ["status"], { env: f.env, encoding: "utf8" });
    expect(out).toContain("update available: 1 new commit on mso CLI 1.3.0");
    expect(out).not.toContain("1.3.0 -> 1.3.0");
    const notice = spawnSync(SCRIPT, ["notice"], { env: f.env, encoding: "utf8" });
    expect(notice.stderr).toContain("MSO update available: 1 new commit on CLI 1.3.0");
    expect(notice.stderr).not.toContain("1.3.0 -> 1.3.0");
  });
});
