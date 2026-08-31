import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

const CLI = path.join(process.cwd(), "bin/mso");
const VERSION = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")).version as string;
const roots: string[] = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mso-service-cli-")); roots.push(root);
  const bin = path.join(root, "bin"), capture = path.join(root, "capture"), home = path.join(root, "home");
  fs.mkdirSync(bin); fs.mkdirSync(home);
  const curl = path.join(bin, "curl");
  fs.writeFileSync(curl, `#!/bin/sh\nprintf 'curl %s\\n' "$*" >> "${capture}"\n[ \"\${MSO_TEST_HEALTH_FAIL:-0}\" = 1 ] && exit 7\nprintf '%s\\n' '{\"status\":\"ok\",\"service\":\"mso\",\"buildId\":\"fixture\",\"buildSha\":\"abcdef1\",\"runtimeInstanceId\":null,\"version\":\"${VERSION}\"}'\n`, { mode: 0o755 });
  const manager = path.join(bin, "manager");
  fs.writeFileSync(manager, `#!/bin/sh\nprintf 'manager %s\\n' "$*" >> "${capture}"\ncase "$*" in\n  'show -p WorkingDirectory --value mso.service') printf '%s\\n' "${process.cwd()}" ;;\n  'show -p Environment --value mso.service') printf 'PORT=4005\\n' ;;\n  'is-active --quiet mso.service') [ "\${MSO_TEST_SERVICE_ACTIVE:-1}" = 1 ] && exit 0; exit 3 ;;\n  'start mso.service'|'restart mso.service') [ "\${MSO_TEST_MANAGER_FAIL:-0}" = 1 ] && exit 23; exit 0 ;;\nesac\n`, { mode: 0o755 });
  const helper = path.join(root, "service-update");
  fs.writeFileSync(helper, `#!/bin/sh\nprintf 'helper %s\\n' "$*" >> "${capture}"\n`, { mode: 0o755 });
  const gateway = path.join(root, "gateway");
  fs.writeFileSync(gateway, `#!/bin/sh\nprintf 'gateway %s marker=%s local=%s\\n' "$*" "\${MSO_GATEWAY_RECOVERY_MARKER:-}" "\${MSO_GATEWAY_LOCAL_URL:-}" >> "${capture}"\ncase "$1" in\n  runtime-assert-update-safe) [ "\${MSO_TEST_FALLBACK:-0}" = 1 ] && echo 'runtime: update-owned' || echo 'runtime: update-safe' ;;\n  runtime-stop) [ -n "\${MSO_GATEWAY_RECOVERY_MARKER:-}" ] || exit 9; printf '1\\n' > "\$MSO_GATEWAY_RECOVERY_MARKER"; chmod 600 "\$MSO_GATEWAY_RECOVERY_MARKER"; echo 'runtime: stopped-owned' ;;\n  local-start) echo 'runtime: healthy MSO at fixture' ;;\n  *) exit 2 ;;\nesac\n`, { mode: 0o755 });
  const exclusion = path.join(root, "runtime-exclusion");
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, MSO_ENV: "/dev/null", MSO_GATEWAY_LOCAL_URL: "http://127.0.0.1:4005",
    MSO_SYSTEMCTL_BIN: manager, MSO_CURL_BIN: curl, MSO_SERVICE_UPDATE_BIN: helper, MSO_GATEWAY_BIN: gateway, MSO_RUNTIME_EXCLUSION_DIR: exclusion, MSO_SERVICE_HANDOFF_DIR: path.join(root, "handoff") };
  return { root, capture, env, exclusion };
}

function lockPath(base: string) {
  const canonical = fs.realpathSync(process.cwd());
  const key = crypto.createHash("sha256").update(canonical).digest("hex");
  const dir = path.join(base, key); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(base, 0o700); fs.chmodSync(dir, 0o700);
  const lock = path.join(dir, "runtime.lock"); fs.writeFileSync(lock, "", { mode: 0o600 });
  return lock;
}

afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("mso service/deploy runtime exclusion", () => {
  it.each(["start", "restart"])("refuses service %s while an offline build owns the checkout", async (verb) => {
    const f = fixture(), lock = lockPath(f.exclusion), held = path.join(f.root, "lock-held");
    // Keep the lock holder alive on stdin rather than sleeping for a fixed interval.
    // Under a busy parallel test run, the old 800 ms sleep could expire after the
    // ready marker was observed but before spawnSync reached the CLI, creating a
    // false success. Closing stdin below releases the lock deterministically.
    const holder = spawn("flock", ["-x", lock, "-c", 'touch "$MSO_TEST_LOCK_HELD"; cat >/dev/null'], {
      env: { ...process.env, MSO_TEST_LOCK_HELD: held },
      stdio: ["pipe", "ignore", "ignore"],
    });
    try {
      for (let i = 0; i < 100 && !fs.existsSync(held); i++) await new Promise((r) => setTimeout(r, 20));
      expect(fs.existsSync(held)).toBe(true);
      const out = spawnSync(CLI, ["service", verb], {
        env: { ...f.env, MSO_RUNTIME_EXCLUSION_TIMEOUT_SECONDS: "0.1" }, encoding: "utf8",
      });
      expect(out.status).not.toBe(0);
      expect(out.stderr).toContain("offline update/deploy is mutating this checkout");
    } finally {
      holder.stdin?.end();
      if (holder.exitCode === null) await new Promise<void>((resolve) => holder.once("close", () => resolve()));
    }
  });

  it("routes deploy through the outer service-update lifecycle", () => {
    const f = fixture();
    const out = execFileSync(CLI, ["deploy"], { env: f.env, encoding: "utf8" });
    expect(out).toContain("deployed");
    expect(fs.readFileSync(f.capture, "utf8")).toContain("helper --rebuild-only");
  });

  it.each(["start", "restart"])("hands off a gateway-owned fallback before inactive service %s", (verb) => {
    const f = fixture();
    const out = spawnSync(CLI, ["service", verb], { env: { ...f.env, MSO_TEST_SERVICE_ACTIVE: "0", MSO_TEST_FALLBACK: "1" }, encoding: "utf8" });
    expect(out.status).toBe(0);
    const calls = fs.readFileSync(f.capture, "utf8");
    expect(calls.indexOf("gateway runtime-stop")).toBeGreaterThan(-1);
    expect(calls.indexOf(`manager ${verb} mso.service`)).toBeGreaterThan(calls.indexOf("gateway runtime-stop"));
    expect(calls).toContain("local=http://127.0.0.1:4005");
    expect(calls).not.toContain("gateway local-start");
  });

  it("restores the gateway fallback if service start fails after handoff", () => {
    const f = fixture();
    const out = spawnSync(CLI, ["service", "start"], { env: { ...f.env, MSO_TEST_SERVICE_ACTIVE: "0", MSO_TEST_FALLBACK: "1", MSO_TEST_MANAGER_FAIL: "1" }, encoding: "utf8" });
    expect(out.status).not.toBe(0);
    const calls = fs.readFileSync(f.capture, "utf8");
    expect(calls).toContain("gateway runtime-stop");
    expect(calls).toContain("manager start mso.service");
    expect(calls).toContain("gateway local-start");
  });

  it("restores the gateway fallback when Type=simple start returns before MSO becomes healthy", () => {
    const f = fixture();
    const out = spawnSync(CLI, ["service", "start"], { env: { ...f.env, MSO_TEST_SERVICE_ACTIVE: "0", MSO_TEST_FALLBACK: "1", MSO_TEST_HEALTH_FAIL: "1", MSO_SERVICE_READY_ATTEMPTS: "1" }, encoding: "utf8" });
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain("/api/health did not become ready");
    const calls = fs.readFileSync(f.capture, "utf8");
    expect(calls).toContain("manager start mso.service");
    expect(calls).toContain("manager stop mso.service");
    expect(calls).toContain("curl --noproxy * -fsS --connect-timeout 1 --max-time 2 http://127.0.0.1:4005/api/health");
    expect(calls).toContain("gateway local-start");
  });

  it("refuses lifecycle actions from a checkout that does not own the service", () => {
    const f = fixture(), other = path.join(f.root, "other"); fs.mkdirSync(other);
    const manager = path.join(f.root, "wrong-manager");
    fs.writeFileSync(manager, `#!/bin/sh\ncase "$*" in 'show -p WorkingDirectory --value mso.service') printf '%s\\n' "${other}" ;; esac\n`, { mode: 0o755 });
    const out = spawnSync(CLI, ["service", "start"], { env: { ...f.env, MSO_SYSTEMCTL_BIN: manager }, encoding: "utf8" });
    expect(out.status).not.toBe(0); expect(out.stderr).toContain("mso.service belongs to");
  });
});
