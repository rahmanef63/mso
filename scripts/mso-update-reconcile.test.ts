import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, "scripts/mso-update");
const roots: string[] = [];

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function copy(repo: string, rel: string) {
  const dst = path.join(repo, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(ROOT, rel), dst);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mso-update-reconcile-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const remote = path.join(root, "remote.git");
  const bin = path.join(root, "bin");
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  for (const rel of [
    "scripts/mso-update",
    "scripts/lib/private-state.sh",
    "scripts/lib/update-state.sh",
    "scripts/lib/runtime-exclusion.sh",
    "scripts/lib/update-gateway-runtimes.sh",
    "scripts/lib/update-git-authority.sh",
  ]) copy(repo, rel);
  fs.mkdirSync(path.join(repo, "bin"), { recursive: true });
  fs.writeFileSync(path.join(repo, "bin/mso"), '#!/bin/sh\nVERSION="test"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(repo, "scripts/mso-gateway"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "MSO Test");
  git(repo, "config", "user.email", "mso@example.invalid");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "base");
  const base = git(repo, "rev-parse", "HEAD");
  execFileSync("git", ["init", "-q", "--bare", remote]);
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-q", "-u", "origin", "main");

  fs.writeFileSync(path.join(repo, "remote.txt"), "remote\n");
  git(repo, "add", "remote.txt");
  git(repo, "commit", "-qm", "remote update");
  const remoteHead = git(repo, "rev-parse", "HEAD");
  git(repo, "push", "-q", "origin", "main");
  git(repo, "reset", "--hard", "-q", base);

  const env = {
    ...process.env,
    HOME: path.join(root, "home"),
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    MSO_UPDATE_ROOT: repo,
    MSO_UPDATE_STATE_DIR: path.join(root, "update-state"),
    MSO_RUNTIME_EXCLUSION_DIR: path.join(root, "runtime-exclusion"),
  };
  return { repo, bin, remoteHead, env };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("mso update container recovery", () => {
  it("silences systemctl bus errors when systemd is not PID 1", () => {
    const f = fixture();
    fs.writeFileSync(path.join(f.bin, "systemctl"), `#!/bin/sh
printf '%s\n' "System has not been booted with systemd as init system (PID 1). Can't operate." >&2
printf '%s\n' 'Failed to connect to system scope bus via local transport: Host is down' >&2
exit 3
`, { mode: 0o755 });
    git(f.repo, "reset", "--hard", "-q", f.remoteHead);
    const out = spawnSync(SCRIPT, ["status"], { env: f.env, encoding: "utf8" });
    expect(out.status).toBe(0);
    expect(out.stderr).toBe("");
    expect(out.stdout).toMatch(/up to date|deployment verification\/restart is pending/);
  });

  it("preserves a diverged local HEAD on a rescue branch before syncing main", () => {
    const f = fixture();
    fs.writeFileSync(path.join(f.repo, "local.txt"), "local\n");
    git(f.repo, "add", "local.txt");
    git(f.repo, "commit", "-qm", "local update");
    const localHead = git(f.repo, "rev-parse", "HEAD");
    const out = execFileSync(SCRIPT, ["reconcile"], { env: f.env, encoding: "utf8" });
    expect(git(f.repo, "rev-parse", "HEAD")).toBe(f.remoteHead);
    const rescue = out.match(/on (rescue\/mso-update-[0-9TZ]+)\n/)?.[1];
    expect(rescue).toBeTruthy();
    expect(git(f.repo, "rev-parse", rescue!)).toBe(localHead);
  });
});
