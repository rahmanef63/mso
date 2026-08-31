import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = path.join(process.cwd(), "scripts/mso-update");
const LIBS = ["private-state.sh", "update-state.sh", "runtime-exclusion.sh", "update-gateway-runtimes.sh", "update-git-authority.sh"];
const roots: string[] = [];

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mso-update-service-status-")); roots.push(root);
  const repo = path.join(root, "repo"), remote = path.join(root, "remote.git"), bin = path.join(root, "bin");
  fs.mkdirSync(path.join(repo, "scripts/lib"), { recursive: true }); fs.mkdirSync(path.join(repo, "bin")); fs.mkdirSync(bin);
  for (const lib of LIBS) fs.copyFileSync(path.join(process.cwd(), "scripts/lib", lib), path.join(repo, "scripts/lib", lib));
  fs.writeFileSync(path.join(repo, "bin/mso"), '#!/bin/sh\nVERSION="1.3.0"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(repo, "scripts/mso-gateway"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  git(repo, "init", "-q", "-b", "main"); git(repo, "config", "user.name", "MSO Test"); git(repo, "config", "user.email", "mso@example.invalid");
  git(repo, "add", "."); git(repo, "commit", "-q", "-m", "old build"); const old = git(repo, "rev-parse", "HEAD");
  git(root, "init", "--bare", "-q", remote); git(repo, "remote", "add", "origin", remote); git(repo, "push", "-q", "-u", "origin", "main");
  fs.writeFileSync(path.join(repo, "bin/mso"), '#!/bin/sh\nVERSION="1.4.0"\n', { mode: 0o755 });
  git(repo, "add", "bin/mso"); git(repo, "commit", "-q", "-m", "new build"); const current = git(repo, "rev-parse", "HEAD"); git(repo, "push", "-q", "origin", "main");
  fs.writeFileSync(path.join(bin, "systemctl"), `#!/bin/sh
if [ "$1" = is-active ]; then exit 0; fi
if [ "$1" = show ]; then
  case "$3" in
    WorkingDirectory) printf '%s\n' ${JSON.stringify(repo)} ;;
    Environment) printf '%s\n' 'PORT=4555' ;;
  esac
  exit 0
fi
exit 3
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "curl"), `#!/bin/sh
case "$*" in
  *127.0.0.1:4555/api/health*) printf '{"status":"ok","service":"mso","buildSha":"%s"}\n' "\${MSO_TEST_BUILD_SHA:-}" ;;
  *) exit 97 ;;
esac
`, { mode: 0o755 });
  const env = { ...process.env, HOME: path.join(root, "home"), PATH: `${bin}:${process.env.PATH}`, MSO_UPDATE_ROOT: repo,
    MSO_UPDATE_STATE_DIR: path.join(root, "update-state"), MSO_UPDATE_NOTICE_DIR: path.join(root, "notice") };
  return { repo, old, current, env };
}

afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("mso update active-service build identity", () => {
  it("reports pending rebuild when source is current but the service runs an older build", () => {
    const f = fixture(); const oldShort = git(f.repo, "rev-parse", "--short", f.old);
    const out = execFileSync(SCRIPT, ["status"], { env: { ...f.env, MSO_TEST_BUILD_SHA: oldShort }, encoding: "utf8" });
    expect(out).toContain("deployment verification/rebuild is pending");
    expect(out).toContain(`still running ${oldShort}`);
    expect(out).not.toContain("is up to date");
  });

  it("reports up to date only when the active service build matches source HEAD", () => {
    const f = fixture(); const currentShort = git(f.repo, "rev-parse", "--short", f.current);
    const out = execFileSync(SCRIPT, ["status"], { env: { ...f.env, MSO_TEST_BUILD_SHA: currentShort }, encoding: "utf8" });
    expect(out).toContain(`is up to date (${currentShort})`);
    expect(out).not.toContain("deployment verification/rebuild is pending");
  });

  it("fails safe when an active service cannot prove its running build identity", () => {
    const f = fixture(); const out = execFileSync(SCRIPT, ["status"], { env: f.env, encoding: "utf8" });
    expect(out).toContain("active service build identity is unavailable");
    expect(out).toContain("deployment verification/rebuild is pending");
    expect(out).not.toContain("is up to date");
  });

  it("prints an interactive rebuild notice when the running service build is stale", () => {
    const f = fixture(); const oldShort = git(f.repo, "rev-parse", "--short", f.old);
    const out = spawnSync(SCRIPT, ["notice"], { env: { ...f.env, MSO_TEST_BUILD_SHA: oldShort }, encoding: "utf8" });
    expect(out.status).toBe(0); expect(out.stdout).toBe("");
    expect(out.stderr).toContain(`source ${git(f.repo, "rev-parse", "--short", f.current)}, running ${oldShort}`);
    expect(out.stderr).toContain("mso update --rebuild");
  });
});
