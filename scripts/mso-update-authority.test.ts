import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const UPDATE = path.join(ROOT, "scripts/mso-update");
const roots: string[] = [];

function copy(src: string, dst: string) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst); fs.chmodSync(dst, 0o755);
}
function git(cwd: string, ...args: string[]) { return execFileSync("git", args, { cwd, encoding: "utf8" }).trim(); }

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mso-update-authority-")); roots.push(base);
  const repo = path.join(base, "repo"), remote = path.join(base, "remote.git"), fakebin = path.join(base, "bin"), capture = path.join(base, "capture");
  fs.mkdirSync(path.join(repo, "scripts/lib"), { recursive: true }); fs.mkdirSync(path.join(repo, "bin")); fs.mkdirSync(fakebin);
  for (const rel of ["scripts/lib/private-state.sh", "scripts/lib/update-state.sh", "scripts/lib/runtime-exclusion.sh", "scripts/lib/update-gateway-runtimes.sh", "scripts/lib/update-git-authority.sh", "scripts/self-update.sh"]) copy(path.join(ROOT, rel), path.join(repo, rel));
  fs.writeFileSync(path.join(repo, "bin/mso"), '#!/bin/sh\nVERSION="1.0.0"\n', { mode: 0o755 });
  git(repo, "init", "-q", "-b", "main"); git(repo, "config", "user.name", "MSO Test"); git(repo, "config", "user.email", "mso@example.invalid");
  git(repo, "add", "."); git(repo, "commit", "-q", "-m", "remote base");
  git(base, "init", "--bare", "-q", remote); git(repo, "remote", "add", "origin", remote); git(repo, "push", "-q", "-u", "origin", "main");
  fs.writeFileSync(path.join(repo, "local-only.txt"), "not pushed\n"); git(repo, "add", "."); git(repo, "commit", "-q", "-m", "local only");
  fs.writeFileSync(path.join(fakebin, "systemctl"), "#!/bin/sh\nexit 3\n", { mode: 0o755 });
  fs.writeFileSync(path.join(fakebin, "bun"), `#!/bin/sh\nprintf 'bun %s\\n' "$*" >> ${JSON.stringify(capture)}\n`, { mode: 0o755 });
  const env = { ...process.env, HOME: path.join(base, "home"), PATH: `${fakebin}:${process.env.PATH}`, MSO_UPDATE_ROOT: repo,
    MSO_UPDATE_STATE_DIR: path.join(base, "update-state"), MSO_RUNTIME_EXCLUSION_DIR: path.join(base, "runtime-exclusion"), MSO_UPDATE_NOTICE_DIR: path.join(base, "notice") };
  fs.mkdirSync(env.HOME, { recursive: true });
  return { base, repo, capture, env };
}

afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("origin/main deployment authority", () => {
  it("reports local-ahead main instead of calling it up to date", () => {
    const f = fixture(); const out = execFileSync(UPDATE, ["status"], { env: f.env, encoding: "utf8" });
    expect(out).toContain("ahead of origin/main by 1 commit"); expect(out).toContain("refusing to deploy unpushed code");
    expect(out).not.toContain("is up to date");
  });

  it("normal offline update refuses local-only commits before install/build", () => {
    const f = fixture(); const before = git(f.repo, "rev-parse", "HEAD");
    const out = spawnSync(UPDATE, [], { env: f.env, encoding: "utf8" });
    expect(out.status).not.toBe(0); expect(out.stderr).toContain("ahead of origin/main");
    expect(git(f.repo, "rev-parse", "HEAD")).toBe(before);
    expect(fs.existsSync(f.capture) ? fs.readFileSync(f.capture, "utf8") : "").not.toContain("bun");
  });

  it("active-service inner normal update enforces the same remote authority", () => {
    const f = fixture(), log = path.join(f.base, "self-update.log");
    const out = spawnSync(path.join(f.repo, "scripts/self-update.sh"), [], { env: { ...f.env, MSO_UPDATE_LOG: log }, encoding: "utf8" });
    expect(out.status).not.toBe(0);
    expect(fs.readFileSync(log, "utf8")).toContain("ahead of origin/main");
    expect(fs.existsSync(f.capture) ? fs.readFileSync(f.capture, "utf8") : "").not.toContain("bun");
  });
});
