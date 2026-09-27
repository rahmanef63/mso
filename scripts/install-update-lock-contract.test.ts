import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("installer update transaction ordering", () => {
  it("acquires the checkout transaction lock before fetch/checkout mutation", () => {
    const core = fs.readFileSync(path.join(ROOT, "scripts/install-core.sh"), "utf8");
    const acquire = core.indexOf("\ninstall_early_update_lock_acquire\n");
    const fetch = core.indexOf('install_git_noninteractive git -C "$DIR" fetch --quiet origin "$REF"');
    const checkout = core.indexOf('git -C "$DIR" checkout --quiet FETCH_HEAD');
    expect(acquire).toBeGreaterThan(0);
    expect(fetch).toBeGreaterThan(acquire);
    expect(checkout).toBeGreaterThan(fetch);
  });

  it("hands the pre-checkout lock FD to the post-checkout lifecycle", () => {
    const helper = fs.readFileSync(path.join(ROOT, "scripts/lib/install-runtime-lifecycle.sh"), "utf8");
    expect(helper).toContain('UPDATE_LOCK_FD="$INSTALL_EARLY_UPDATE_LOCK_FD"');
    expect(helper).toContain('[ "$UPDATE_LOCK_HELD" = 1 ] || update_lock_acquire');
  });
  it("does not require the private-state helper from the pre-upgrade checkout", () => {
    const core = fs.readFileSync(path.join(ROOT, "scripts/install-core.sh"), "utf8");
    expect(core).not.toContain('$DIR/scripts/lib/private-state.sh');
    expect(core).toContain("install_private_state_dir()");
    expect(core).toContain("install_private_state_ensure_file()");
  });

  it("preserves unique commits on both the installer checkout and the Termux main branch", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mso-install-git-"));
    const git = (...args: string[]) => {
      const p = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
      expect(p.status, p.stderr).toBe(0);
      return p.stdout.trim();
    };
    const run = (definition: string, call: string) =>
      spawnSync("bash", ["-c", `die() { echo "$*" >&2; exit 1; }
${definition}
${call}`, "bash", dir], { encoding: "utf8" });
    try {
      git("init", "-q", "-b", "main");
      git("config", "user.email", "install-test@example.invalid");
      git("config", "user.name", "Install Test");
      fs.writeFileSync(path.join(dir, "state.txt"), "base\n");
      git("add", "state.txt"); git("commit", "-qm", "base");
      const base = git("rev-parse", "HEAD");

      git("checkout", "--detach", "-q", base);
      fs.writeFileSync(path.join(dir, "state.txt"), "target\n");
      git("commit", "-qam", "target");
      const target = git("rev-parse", "HEAD");
      git("checkout", "-q", "main");
      fs.writeFileSync(path.join(dir, "state.txt"), "local only\n");
      git("commit", "-qam", "local only");
      const local = git("rev-parse", "HEAD");
      git("fetch", "-q", ".", target);

      const core = fs.readFileSync(path.join(ROOT, "scripts/install-core.sh"), "utf8");
      const coreGuard = core.split("\n").find((line) => line.includes('git -C "$DIR" merge-base --is-ancestor HEAD FETCH_HEAD || die'));
      expect(coreGuard).toBeDefined();
      const refused = run("", `DIR="$1"; ${coreGuard}`);
      expect(refused.status).not.toBe(0);
      expect(refused.stderr).toContain("commits not present");
      expect(git("rev-parse", "main")).toBe(local);
      git("checkout", "--detach", "-q", base);
      const accepted = run("", `DIR="$1"; ${coreGuard}`);
      expect(accepted.status, accepted.stderr).toBe(0);

      const termux = fs.readFileSync(path.join(ROOT, "scripts/install-termux.sh"), "utf8");
      const branchGuard = termux.match(/  reconcile_main_branch\(\) \{[\s\S]*?\n  \}/)?.[0];
      expect(branchGuard).toBeDefined();
      const rejectedBranch = run(branchGuard!, 'reconcile_main_branch "$1"');
      expect(rejectedBranch.status).not.toBe(0);
      expect(rejectedBranch.stderr).toContain("Local main has commits");
      expect(git("rev-parse", "main")).toBe(local);
      expect(git("rev-parse", "HEAD")).toBe(base);

      git("checkout", "--detach", "-q", local);
      fs.writeFileSync(path.join(dir, "state.txt"), "descendant\n");
      git("commit", "-qam", "descendant");
      const descendant = git("rev-parse", "HEAD");
      const switched = run(branchGuard!, 'reconcile_main_branch "$1"');
      expect(switched.status, switched.stderr).toBe(0);
      expect(git("symbolic-ref", "--short", "HEAD")).toBe("main");
      expect(git("rev-parse", "main")).toBe(descendant);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

});
