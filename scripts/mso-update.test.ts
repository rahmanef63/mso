import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = path.join(process.cwd(), "scripts/mso-update");
const PRIVATE = path.join(process.cwd(), "scripts/lib/private-state.sh");
const UPDATE_STATE = path.join(process.cwd(), "scripts/lib/update-state.sh");
const RUNTIME_EXCLUSION = path.join(process.cwd(), "scripts/lib/runtime-exclusion.sh");
const UPDATE_GATEWAYS = path.join(process.cwd(), "scripts/lib/update-gateway-runtimes.sh");
const SERVICE_UPDATE = path.join(process.cwd(), "scripts/mso-service-update");
const roots: string[] = [];
function git(cwd: string, ...args: string[]) { return execFileSync("git", args, { cwd, encoding: "utf8" }).trim(); }
function fixture(options: { failInstallOnce?: boolean; activeService?: "same" | "other"; installDelayMs?: number; serviceBuild?: "old" | "newer" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mso-update-")); roots.push(root);
  const repo = path.join(root, "repo"), remote = path.join(root, "remote.git"), bin = path.join(root, "bin"), capture = path.join(root, "capture");
  fs.mkdirSync(path.join(repo, "scripts/lib"), { recursive: true }); fs.mkdirSync(path.join(repo, "bin")); fs.mkdirSync(bin);
  fs.copyFileSync(PRIVATE, path.join(repo, "scripts/lib/private-state.sh"));
  fs.copyFileSync(UPDATE_STATE, path.join(repo, "scripts/lib/update-state.sh"));
  fs.copyFileSync(RUNTIME_EXCLUSION, path.join(repo, "scripts/lib/runtime-exclusion.sh"));
  fs.copyFileSync(UPDATE_GATEWAYS, path.join(repo, "scripts/lib/update-gateway-runtimes.sh"));
  fs.copyFileSync(path.join(process.cwd(), "scripts/lib/update-git-authority.sh"), path.join(repo, "scripts/lib/update-git-authority.sh"));
  fs.copyFileSync(SERVICE_UPDATE, path.join(repo, "scripts/mso-service-update")); fs.chmodSync(path.join(repo, "scripts/mso-service-update"), 0o755);
  fs.writeFileSync(path.join(repo, "scripts/self-update.sh"), `#!/bin/sh\nprintf 'self-update %s\\n' "$*" >> "${capture}"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(repo, "scripts/verify-build.sh"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  fs.writeFileSync(path.join(repo, "scripts/mso-gateway"), `#!/bin/sh
printf 'gateway %s %s\\n' "$*" "\${MSO_GATEWAY_LOCAL_URL:-}" >> "${capture}"
case "$1" in
  runtime-assert-update-safe)
    if [ "\${MSO_TEST_UNOWNED_RUNTIME:-0}" = 1 ]; then
      echo 'mso gateway: a loopback MSO runtime is active but is not gateway-owned; stop it before an offline update' >&2
      exit 31
    fi
    echo 'runtime: update-safe' ;;
  runtime-stop)
    [ -n "\${MSO_GATEWAY_RECOVERY_MARKER:-}" ] || exit 9
    mkdir -p "$(dirname "\$MSO_GATEWAY_RECOVERY_MARKER")"
    chmod 700 "$(dirname "\$MSO_GATEWAY_RECOVERY_MARKER")"
    printf '1\\n' > "\$MSO_GATEWAY_RECOVERY_MARKER"; chmod 600 "\$MSO_GATEWAY_RECOVERY_MARKER"
    echo 'runtime: stopped-owned' ;;
  local-start) echo 'runtime: healthy MSO at fixture' ;;
  *) exit 2 ;;
esac
`, { mode: 0o755 });
  fs.writeFileSync(path.join(repo, "bin/mso"), '#!/bin/sh\nVERSION="1.3.0"\n', { mode: 0o755 });
  fs.mkdirSync(path.join(repo, "node_modules/next/dist/bin"), { recursive: true });
  fs.writeFileSync(path.join(repo, "node_modules/next/dist/bin/next"), "fixture\n");
  git(repo, "init", "-q", "-b", "main"); git(repo, "config", "user.name", "MSO Test"); git(repo, "config", "user.email", "mso@example.invalid");
  git(repo, "add", "."); git(repo, "commit", "-q", "-m", "initial"); const old = git(repo, "rev-parse", "HEAD");
  git(root, "init", "--bare", "-q", remote); git(repo, "remote", "add", "origin", remote); git(repo, "push", "-q", "-u", "origin", "main");
  fs.writeFileSync(path.join(repo, "bin/mso"), '#!/bin/sh\nVERSION="1.4.0"\n', { mode: 0o755 });
  git(repo, "add", "bin/mso");
  git(repo, "commit", "-q", "-m", "new cli"); const newer = git(repo, "rev-parse", "HEAD"); git(repo, "push", "-q", "origin", "main");
  git(repo, "reset", "--hard", "-q", old);
  const serviceRoot = options.activeService === "same" ? repo : options.activeService === "other" ? path.join(root, "other-service") : "";
  if (serviceRoot && serviceRoot !== repo) fs.mkdirSync(serviceRoot, { recursive: true });
  fs.writeFileSync(path.join(bin, "systemctl"), `#!/bin/sh
if [ "$1" = is-active ]; then [ -n "${serviceRoot}" ] && exit 0; exit 3; fi
if [ "$1" = show ]; then printf '%s\n' "${serviceRoot}"; exit 0; fi
if [ "$1" = --user ]; then exit 1; fi
exit 3
`, { mode: 0o755 });
  if (options.serviceBuild) {
    const build = options.serviceBuild === "newer" ? newer.slice(0, 7) : old.slice(0, 7);
    fs.writeFileSync(path.join(bin, "curl"), `#!/bin/sh\nprintf '%s\n' '{"status":"ok","service":"mso","buildSha":"${build}"}'\n`, { mode: 0o755 });
  }
  const failOnce = path.join(root, "fail-install-once");
  fs.writeFileSync(path.join(bin, "bun"), `#!/bin/sh
printf 'bun %s\\n' "$*" >> "${capture}"
if [ "${options.installDelayMs ?? 0}" -gt 0 ] && [ "$1" = install ]; then sleep ${Math.max(0, (options.installDelayMs ?? 0) / 1000)}; fi
if [ "${options.failInstallOnce ? "1" : "0"}" = 1 ] && [ "$1" = install ] && [ ! -f "${failOnce}" ]; then touch "${failOnce}"; exit 23; fi
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "node"), `#!/bin/sh\nprintf 'node %s\\n' "$*" >> "${capture}"\n`, { mode: 0o755 });
  const home = path.join(root, "home");
  const gatewayScope = path.join(home, ".mso/private/gateway/default-scope");
  fs.mkdirSync(gatewayScope, { recursive: true, mode: 0o700 }); fs.chmodSync(path.join(home, ".mso"), 0o700);
  fs.chmodSync(path.join(home, ".mso/private"), 0o700); fs.chmodSync(path.join(home, ".mso/private/gateway"), 0o700);
  fs.writeFileSync(path.join(gatewayScope, "state.json"), JSON.stringify({ root: fs.realpathSync(repo), localUrl: "http://127.0.0.1:4555", runtimeOwned: true, envFile: { path: "/dev/null", dev: null, ino: null } }) + "\n", { mode: 0o600 });
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, MSO_UPDATE_ROOT: repo,
    MSO_UPDATE_NOTICE_DIR: path.join(root, "notice"), MSO_UPDATE_STATE_DIR: path.join(root, "update-state"),
    MSO_RUNTIME_EXCLUSION_DIR: path.join(root, "runtime-exclusion"), MSO_UPDATE_LOCAL_URL: "http://127.0.0.1:4555" };
  return { root, repo, remote, old, newer, capture, env, home };
}
function receipts(base: string) {
  if (!fs.existsSync(base)) return [] as Array<{ path: string; root: string; sha: string }>;
  return fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).flatMap((e) => {
    const file = path.join(base, e.name, "deployed.json");
    if (!fs.existsSync(file)) return [];
    return [{ path: file, ...JSON.parse(fs.readFileSync(file, "utf8")) as { root: string; sha: string } }];
  });
}

function runAsync(env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(SCRIPT, [], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (v) => stdout += v); child.stderr.on("data", (v) => stderr += v);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("mso update without a running web API", () => {
  it("reports the incoming CLI version directly from origin/main", () => {
    const f = fixture(); const out = execFileSync(SCRIPT, ["status"], { env: f.env, encoding: "utf8" });
    expect(out).toContain("update available: mso CLI 1.3.0 -> 1.4.0 (1 commit)");
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

  it("refuses an offline build before dependency or .next mutation when the selected origin is unowned", () => {
    const f = fixture();
    fs.rmSync(path.join(f.home, ".mso/private/gateway"), { recursive: true, force: true });
    const out = spawnSync(SCRIPT, [], { env: { ...f.env, MSO_TEST_UNOWNED_RUNTIME: "1" }, encoding: "utf8" });
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain("selected loopback runtime is active but not safely update-owned");
    const calls = fs.existsSync(f.capture) ? fs.readFileSync(f.capture, "utf8") : "";
    expect(calls).toContain("runtime-assert-update-safe");
    expect(calls).not.toContain("bun install");
    expect(calls).not.toContain("node node_modules/next/dist/bin/next build");
  });


  it("does not launch a redundant service rebuild when source and runtime already match", () => {
    const f = fixture({ activeService: "same", serviceBuild: "newer" });
    git(f.repo, "reset", "--hard", "-q", f.newer);
    const out = execFileSync(SCRIPT, [], { env: f.env, encoding: "utf8" });
    expect(out).toContain("is already up to date");
    expect(out).toContain("no rebuild needed");
    expect(fs.existsSync(f.capture)).toBe(false);
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
    const rs = receipts(path.join(f.root, "update-state"));
    expect(rs).toHaveLength(1);
    expect(rs[0].root).toBe(fs.realpathSync(f.repo));
    expect(rs[0].sha).toBe(f.newer);
  });

  it("scopes deployment receipts to the canonical checkout, even at the same commit", () => {
    const f = fixture();
    execFileSync(SCRIPT, [], { env: f.env, encoding: "utf8" });
    const repoB = path.join(f.root, "repo-b");
    execFileSync("git", ["clone", "-q", "--branch", "main", f.remote, repoB]);
    const envB = { ...f.env, MSO_UPDATE_ROOT: repoB };
    const before = fs.readFileSync(f.capture, "utf8");
    const out = execFileSync(SCRIPT, [], { env: envB, encoding: "utf8" });
    expect(out).toContain("No system service was active");
    const after = fs.readFileSync(f.capture, "utf8");
    expect((after.match(/bun install/g) ?? []).length).toBe((before.match(/bun install/g) ?? []).length + 1);
    const rs = receipts(path.join(f.root, "update-state"));
    expect(rs).toHaveLength(2);
    expect(new Set(rs.map((r) => r.root))).toEqual(new Set([fs.realpathSync(f.repo), fs.realpathSync(repoB)]));
    expect(rs.every((r) => r.sha === f.newer)).toBe(true);
  });

  it("serializes the complete offline update so a concurrent caller cannot rebuild under a restored runtime", async () => {
    const f = fixture({ installDelayMs: 700 });
    const first = runAsync(f.env);
    for (let i = 0; i < 100; i++) {
      if (fs.existsSync(f.capture) && fs.readFileSync(f.capture, "utf8").includes("bun install")) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const second = runAsync(f.env);
    const [a, b] = await Promise.all([first, second]);
    expect(a.code).toBe(0); expect(b.code).toBe(0);
    const calls = fs.readFileSync(f.capture, "utf8");
    expect((calls.match(/bun install/g) ?? [])).toHaveLength(1);
    expect((calls.match(/node node_modules\/next\/dist\/bin\/next build/g) ?? [])).toHaveLength(1);
    expect((calls.match(/gateway runtime-stop/g) ?? [])).toHaveLength(1);
    expect((calls.match(/gateway local-start/g) ?? [])).toHaveLength(1);
    expect([a.stdout, b.stdout].join("\n")).toContain("offline deployment receipt matches");
  });

  it("holds the checkout-wide runtime exclusion exclusively through the mutable build phase", async () => {
    const f = fixture({ installDelayMs: 900 });
    const exclusionBase = path.join(f.root, "runtime-exclusion");
    const env = { ...f.env, MSO_RUNTIME_EXCLUSION_DIR: exclusionBase };
    const update = runAsync(env);
    for (let i = 0; i < 120; i++) {
      if (fs.existsSync(f.capture) && fs.readFileSync(f.capture, "utf8").includes("bun install")) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const key = require("node:crypto").createHash("sha256").update(fs.realpathSync(f.repo)).digest("hex");
    const lock = path.join(exclusionBase, key, "runtime.lock");
    expect(fs.existsSync(lock)).toBe(true);
    const during = spawnSync("flock", ["-s", "-n", lock, "-c", "true"], { encoding: "utf8" });
    expect(during.status).not.toBe(0);
    const result = await update; expect(result.code).toBe(0);
    const after = spawnSync("flock", ["-s", "-n", lock, "-c", "true"], { encoding: "utf8" });
    expect(after.status).toBe(0);
  });

  it("prints an update notice from cached Git state without touching the web API", () => {
    const f = fixture();
    const result = execFileSync(SCRIPT, ["notice"], { env: f.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(result).toBe("");
    const status = execFileSync(SCRIPT, ["status"], { env: f.env, encoding: "utf8" });
    expect(status).toContain("1.3.0 -> 1.4.0");
  });
});
