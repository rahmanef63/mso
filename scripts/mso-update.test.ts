import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = path.join(process.cwd(), "scripts/mso-update");
const PRIVATE = path.join(process.cwd(), "scripts/lib/private-state.sh");
const roots: string[] = [];

function git(cwd: string, ...args: string[]) { return execFileSync("git", args, { cwd, encoding: "utf8" }).trim(); }
function fixture(options: { failInstallOnce?: boolean; activeService?: "same" | "other" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mso-update-")); roots.push(root);
  const repo = path.join(root, "repo"), remote = path.join(root, "remote.git"), bin = path.join(root, "bin"), capture = path.join(root, "capture");
  fs.mkdirSync(path.join(repo, "scripts/lib"), { recursive: true }); fs.mkdirSync(path.join(repo, "bin")); fs.mkdirSync(bin);
  fs.copyFileSync(PRIVATE, path.join(repo, "scripts/lib/private-state.sh"));
  fs.writeFileSync(path.join(repo, "scripts/verify-build.sh"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  fs.writeFileSync(path.join(repo, "scripts/mso-gateway"), `#!/bin/sh
printf 'gateway %s\\n' "$*" >> "${capture}"
case "$1" in runtime-stop) echo 'runtime: stopped-owned' ;; local-start) echo 'runtime: healthy MSO at fixture' ;; *) exit 2 ;; esac
`, { mode: 0o755 });
  fs.writeFileSync(path.join(repo, "bin/mso"), '#!/bin/sh\nVERSION="1.3.0"\n', { mode: 0o755 });
  fs.mkdirSync(path.join(repo, "node_modules/next/dist/bin"), { recursive: true });
  fs.writeFileSync(path.join(repo, "node_modules/next/dist/bin/next"), "fixture\n");
  git(repo, "init", "-q", "-b", "main"); git(repo, "config", "user.name", "MSO Test"); git(repo, "config", "user.email", "mso@example.invalid");
  git(repo, "add", "."); git(repo, "commit", "-q", "-m", "initial"); const old = git(repo, "rev-parse", "HEAD");
  git(root, "init", "--bare", "-q", remote); git(repo, "remote", "add", "origin", remote); git(repo, "push", "-q", "-u", "origin", "main");
  fs.writeFileSync(path.join(repo, "bin/mso"), '#!/bin/sh\nVERSION="1.4.0"\n', { mode: 0o755 });
  git(repo, "add", "bin/mso"); git(repo, "commit", "-q", "-m", "new cli"); const newer = git(repo, "rev-parse", "HEAD"); git(repo, "push", "-q", "origin", "main");
  git(repo, "reset", "--hard", "-q", old);
  const serviceRoot = options.activeService === "same" ? repo : options.activeService === "other" ? path.join(root, "other-service") : "";
  if (serviceRoot && serviceRoot !== repo) fs.mkdirSync(serviceRoot, { recursive: true });
  fs.writeFileSync(path.join(bin, "systemctl"), `#!/bin/sh
if [ "$1" = is-active ]; then [ -n "${serviceRoot}" ] && exit 0; exit 3; fi
if [ "$1" = show ]; then printf '%s\n' "${serviceRoot}"; exit 0; fi
if [ "$1" = --user ]; then exit 1; fi
exit 3
`, { mode: 0o755 });
  const failOnce = path.join(root, "fail-install-once");
  fs.writeFileSync(path.join(bin, "bun"), `#!/bin/sh
printf 'bun %s\\n' "$*" >> "${capture}"
if [ "${options.failInstallOnce ? "1" : "0"}" = 1 ] && [ "$1" = install ] && [ ! -f "${failOnce}" ]; then touch "${failOnce}"; exit 23; fi
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "node"), `#!/bin/sh\nprintf 'node %s\\n' "$*" >> "${capture}"\n`, { mode: 0o755 });
  const env = { ...process.env, HOME: path.join(root, "home"), PATH: `${bin}:${process.env.PATH}`, MSO_UPDATE_ROOT: repo,
    MSO_UPDATE_NOTICE_DIR: path.join(root, "notice"), MSO_UPDATE_STATE_DIR: path.join(root, "update-state"),
    MSO_UPDATE_LOCAL_URL: "http://127.0.0.1:4555" };
  return { root, repo, old, newer, capture, env };
}

afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("mso update without a running web API", () => {
  it("reports the incoming CLI version directly from origin/main", () => {
    const f = fixture(); const out = execFileSync(SCRIPT, ["status"], { env: f.env, encoding: "utf8" });
    expect(out).toContain("update available: mso 1.3.0 -> 1.4.0 (1 commit)");
    expect(out).toContain("run: mso update"); expect(git(f.repo, "rev-parse", "HEAD")).toBe(f.old);
  });

  it("updates, verifies and builds offline when no mso.service is active", () => {
    const f = fixture(); const out = execFileSync(SCRIPT, [], { env: f.env, encoding: "utf8" });
    expect(out).toContain("No system service was active; run: mso web");
    expect(git(f.repo, "rev-parse", "HEAD")).toBe(f.newer);
    const calls = fs.readFileSync(f.capture, "utf8"); expect(calls).toContain("bun install");
    expect(calls).toContain("node node_modules/next/dist/bin/next build");
    expect(calls).toContain("gateway runtime-stop");
    expect(calls).toContain("gateway local-start");
    const status = execFileSync(SCRIPT, ["status"], { env: f.env, encoding: "utf8" });
    expect(status).toContain("is up to date");
    expect(status).not.toContain("deployment verification/restart is pending");
  });

  it("refuses update handoff when the active mso.service belongs to another checkout", () => {
    const f = fixture({ activeService: "other" });
    const out = require("node:child_process").spawnSync(SCRIPT, [], { env: f.env, encoding: "utf8" });
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain("active mso.service belongs to");
    expect(out.stderr).toContain("not this checkout");
    expect(fs.existsSync(f.capture)).toBe(false);
  });

  it("retries an incomplete offline deployment even after HEAD already reached origin/main", () => {
    const f = fixture({ failInstallOnce: true });
    const first = require("node:child_process").spawnSync(SCRIPT, [], { env: f.env, encoding: "utf8" });
    expect(first.status).not.toBe(0);
    expect(first.stderr).toContain("dependency install failed");
    expect(git(f.repo, "rev-parse", "HEAD")).toBe(f.newer);

    const second = execFileSync(SCRIPT, [], { env: f.env, encoding: "utf8" });
    expect(second).toContain("No system service was active");
    const calls = fs.readFileSync(f.capture, "utf8");
    expect(calls.match(/bun install/g)?.length).toBe(2);
    expect(calls).toContain("gateway local-start");
    const receipt = fs.readFileSync(path.join(f.root, "update-state", "deployed-sha"), "utf8").trim();
    expect(receipt).toBe(f.newer);
  });

  it("prints an update notice from cached Git state without touching the web API", () => {
    const f = fixture();
    const result = execFileSync(SCRIPT, ["notice"], { env: f.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(result).toBe("");
    const status = execFileSync(SCRIPT, ["status"], { env: f.env, encoding: "utf8" });
    expect(status).toContain("1.3.0 -> 1.4.0");
  });
});
