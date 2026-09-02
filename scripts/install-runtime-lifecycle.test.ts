import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const LIBS = ["private-state.sh", "update-state.sh", "runtime-exclusion.sh", "update-gateway-runtimes.sh", "install-runtime-lifecycle.sh"];
const roots: string[] = [];

function copy(src: string, dst: string) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); fs.chmodSync(dst, 0o755); }
function envIdentity(file: string) { const st = fs.statSync(file); return { path: fs.realpathSync(file), dev: String(st.dev), ino: String(st.ino) }; }

function fixture(systemd = false, doService = 1, earlyLock = false) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mso-install-runtime-")); roots.push(base);
  const repo = path.join(base, "repo"), home = path.join(base, "home"), bin = path.join(base, "bin"), capture = path.join(base, "capture");
  fs.mkdirSync(home); fs.mkdirSync(bin); fs.mkdirSync(path.join(repo, "scripts/lib"), { recursive: true });
  for (const lib of LIBS) copy(path.join(ROOT, "scripts/lib", lib), path.join(repo, "scripts/lib", lib));
  const customEnv = path.join(base, "custom.env"); fs.writeFileSync(customEnv, "OS_SESSION_SECRET=fixture\n", { mode: 0o600 });
  fs.writeFileSync(path.join(repo, "scripts/mso-gateway"), `#!/bin/sh
printf '%s url=%s env=%s expected=%s\n' "$1" "\${MSO_GATEWAY_LOCAL_URL:-}" "\${MSO_GATEWAY_ENV:-}" "\${MSO_GATEWAY_EXPECT_ENV_IDENTITY:-}" >> ${JSON.stringify(capture)}
case "$1" in
  runtime-assert-update-safe) echo 'runtime: update-owned' ;;
  runtime-stop) printf '1\n' > "$MSO_GATEWAY_RECOVERY_MARKER"; chmod 600 "$MSO_GATEWAY_RECOVERY_MARKER"; echo 'runtime: stopped-owned' ;;
  local-start) echo 'runtime: healthy MSO at fixture' ;;
  *) exit 2 ;;
esac
`, { mode: 0o755 });
  const canonical = fs.realpathSync(repo), stateDir = path.join(home, ".mso/private/gateway/scope");
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  for (const dir of [path.join(home, ".mso"), path.join(home, ".mso/private"), path.join(home, ".mso/private/gateway")]) fs.chmodSync(dir, 0o700);
  fs.writeFileSync(path.join(stateDir, "state.json"), `${JSON.stringify({ root: canonical, localUrl: "http://127.0.0.1:4555", runtimeOwned: true, envFile: envIdentity(customEnv) })}\n`, { mode: 0o600 });
  const systemctl = path.join(bin, "systemctl");
  fs.writeFileSync(systemctl, `#!/bin/sh
printf 'systemctl %s\n' "$*" >> ${JSON.stringify(capture)}
case "$*" in
  'is-active --quiet mso.service') exit ${systemd ? 0 : 3} ;;
  'show -p WorkingDirectory --value mso.service') printf '%s\n' ${JSON.stringify(canonical)} ;;
esac
`, { mode: 0o755 });
  const updateBase = path.join(base, "update-state");
  const updateKey = crypto.createHash("sha256").update(canonical).digest("hex");
  const updateScope = path.join(updateBase, updateKey);
  fs.mkdirSync(updateScope, { recursive: true, mode: 0o700 });
  fs.chmodSync(updateBase, 0o700); fs.chmodSync(updateScope, 0o700);
  const earlyLockFile = path.join(updateScope, "transaction.lock");
  fs.writeFileSync(earlyLockFile, "", { mode: 0o600 });
  const runner = path.join(base, "runner.sh");
  fs.writeFileSync(runner, `#!/bin/bash
set -euo pipefail
DIR=${JSON.stringify(repo)}; PORT=4005; DO_SERVICE=${doService}; SERVICE=mso.service
export HOME=${JSON.stringify(home)} PATH=${JSON.stringify(`${bin}:${process.env.PATH}`)} MSO_UPDATE_STATE_DIR=${JSON.stringify(path.join(base, "update-state"))} MSO_RUNTIME_EXCLUSION_DIR=${JSON.stringify(path.join(base, "runtime-exclusion"))} MSO_UPDATE_LOCK_TIMEOUT_SECONDS=0.2
die(){ echo "installer: $*" >&2; exit 1; }
sudo_do(){ "$@"; }
systemd_ready(){ ${systemd ? "return 0" : "return 1"}; }
${earlyLock ? `exec {INSTALL_EARLY_UPDATE_LOCK_FD}<>${JSON.stringify(earlyLockFile)}
flock -x "$INSTALL_EARLY_UPDATE_LOCK_FD"
INSTALL_EARLY_UPDATE_LOCK_HELD=1
INSTALL_EARLY_UPDATE_LOCK_FILE=${JSON.stringify(earlyLockFile)}
INSTALL_EARLY_UPDATE_CANONICAL_ROOT=${JSON.stringify(canonical)}` : ""}
. "$DIR/scripts/lib/install-runtime-lifecycle.sh"
trap install_runtime_lifecycle_cleanup EXIT
install_runtime_lifecycle_begin
printf 'MUTATE\n' >> ${JSON.stringify(capture)}
install_runtime_lifecycle_finish
trap - EXIT
`, { mode: 0o755 });
  return { base, capture, customEnv, runner };
}

afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("installer runtime lifecycle", () => {
  it("adopts a transaction lock acquired before checkout instead of reacquiring it", () => {
    const f = fixture(false, 1, true);
    // This is a deadlock/correctness assertion, not a 5-second performance SLA.
    // Low-priority full-suite CI can legitimately delay the fixture shell; keep a
    // bounded timeout while leaving enough headroom to distinguish delay from lock recursion.
    const out = spawnSync(f.runner, [], { encoding: "utf8", timeout: 15_000 });
    expect(out.status).toBe(0);
    expect(out.error).toBeUndefined();
    expect(fs.readFileSync(f.capture, "utf8")).toContain("MUTATE");
  });

  it("quiesces and restores a no-systemd fallback around installer mutation with its custom env", () => {
    const f = fixture(false, 1); execFileSync(f.runner, [], { encoding: "utf8" });
    const calls = fs.readFileSync(f.capture, "utf8");
    expect(calls.indexOf("runtime-stop")).toBeLessThan(calls.indexOf("MUTATE"));
    expect(calls.lastIndexOf("local-start")).toBeGreaterThan(calls.indexOf("MUTATE"));
    expect(calls).toContain(`env=${fs.realpathSync(f.customEnv)}`);
  });

  it("refuses --no-service before mutation when this checkout already owns an active service", () => {
    const f = fixture(true, 0); const out = spawnSync(f.runner, [], { encoding: "utf8" });
    expect(out.status).not.toBe(0); expect(out.stderr).toContain("--no-service cannot rebuild its live .next tree");
    const calls = fs.existsSync(f.capture) ? fs.readFileSync(f.capture, "utf8") : "";
    expect(calls).not.toContain("MUTATE"); expect(calls).not.toContain("runtime-stop");
  });

  it("stops the owned service before mutation and restores fallbacks afterward", () => {
    const f = fixture(true, 1); execFileSync(f.runner, [], { encoding: "utf8" });
    const calls = fs.readFileSync(f.capture, "utf8");
    expect(calls.indexOf("systemctl stop mso.service")).toBeLessThan(calls.indexOf("MUTATE"));
    expect(calls.indexOf("runtime-stop")).toBeLessThan(calls.indexOf("MUTATE"));
    expect(calls.lastIndexOf("local-start")).toBeGreaterThan(calls.indexOf("MUTATE"));
  });
});
