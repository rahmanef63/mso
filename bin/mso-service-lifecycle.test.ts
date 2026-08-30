import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

const CLI = path.join(process.cwd(), "bin/mso");
const roots: string[] = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mso-service-cli-")); roots.push(root);
  const bin = path.join(root, "bin"), capture = path.join(root, "capture"), home = path.join(root, "home");
  fs.mkdirSync(bin); fs.mkdirSync(home);
  const manager = path.join(bin, "manager");
  fs.writeFileSync(manager, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${capture}"\ncase "$*" in\n  'show -p WorkingDirectory --value mso.service') printf '%s\\n' "${process.cwd()}" ;;\n  'is-active --quiet mso.service') exit 0 ;;\nesac\n`, { mode: 0o755 });
  const helper = path.join(root, "service-update");
  fs.writeFileSync(helper, `#!/bin/sh\nprintf 'helper %s\\n' "$*" >> "${capture}"\n`, { mode: 0o755 });
  const exclusion = path.join(root, "runtime-exclusion");
  const env = { ...process.env, HOME: home, MSO_ENV: "/dev/null", MSO_GATEWAY_LOCAL_URL: "http://127.0.0.1:4005",
    MSO_SYSTEMCTL_BIN: manager, MSO_SERVICE_UPDATE_BIN: helper, MSO_RUNTIME_EXCLUSION_DIR: exclusion };
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
    const f = fixture(), lock = lockPath(f.exclusion);
    const holder = spawn("flock", ["-x", lock, "-c", "sleep 0.8"], { stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 80));
    const out = spawnSync(CLI, ["service", verb], {
      env: { ...f.env, MSO_RUNTIME_EXCLUSION_TIMEOUT_SECONDS: "0.1" }, encoding: "utf8",
    });
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain("offline update/deploy is mutating this checkout");
    await new Promise<void>((resolve) => holder.once("close", () => resolve()));
  });

  it("routes deploy through the outer service-update lifecycle", () => {
    const f = fixture();
    const out = execFileSync(CLI, ["deploy"], { env: f.env, encoding: "utf8" });
    expect(out).toContain("deployed");
    expect(fs.readFileSync(f.capture, "utf8")).toContain("helper --rebuild-only");
  });

  it("refuses lifecycle actions from a checkout that does not own the service", () => {
    const f = fixture(), other = path.join(f.root, "other"); fs.mkdirSync(other);
    const manager = path.join(f.root, "wrong-manager");
    fs.writeFileSync(manager, `#!/bin/sh\ncase "$*" in 'show -p WorkingDirectory --value mso.service') printf '%s\\n' "${other}" ;; esac\n`, { mode: 0o755 });
    const out = spawnSync(CLI, ["service", "start"], { env: { ...f.env, MSO_SYSTEMCTL_BIN: manager }, encoding: "utf8" });
    expect(out.status).not.toBe(0); expect(out.stderr).toContain("mso.service belongs to");
  });
});
