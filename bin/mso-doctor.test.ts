import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CLI = path.join(__dirname, "mso");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mso-doctor-"));
  const bin = path.join(root, "bin");
  const envFile = path.join(root, ".env.local");
  const store = path.join(root, "devices.json");
  const devFile = path.join(root, "cli.device.id");
  const device = "d".repeat(32);
  fs.mkdirSync(bin, { mode: 0o700 });
  fs.writeFileSync(devFile, device, { mode: 0o600 });
  fs.writeFileSync(envFile, "OS_LOGIN_PASSWORD=fixture-password\nOS_SESSION_SECRET=fixture-session-secret-long-enough\n", { mode: 0o600 });
  fs.writeFileSync(store, JSON.stringify({ approved: {}, pending: { [device]: { label: "mso cli", firstSeen: 1, lastSeen: 1, ip: "127.0.0.1", attempts: 1 } } }));
  fs.writeFileSync(path.join(bin, "curl"), `#!/bin/sh
case "$*" in
  *api/auth/login*) body='{"success":true}' ;;
  *api/auth/me*) body='{"authenticated":true,"role":"owner"}' ;;
  *) body='{"status":"ok","service":"mso"}' ;;
esac
case "$*" in *'-w '*) printf '%s\n200' "$body" ;; *) printf '%s' "$body" ;; esac
`, { mode: 0o700 });
  fs.writeFileSync(path.join(bin, "systemctl"), `#!/bin/sh
case "$*" in
  *'show -p WorkingDirectory --value mso.service'*) printf '%s\n' '${path.dirname(CLI)}' ;;
  *'show -p Environment --value mso.service'*) printf 'PORT=4005\n' ;;
  *) exit 0 ;;
esac
`, { mode: 0o700 });
  const env = { ...process.env, HOME: root, PATH: `${bin}:${process.env.PATH}`, MSO_ENV: envFile,
    OS_DEVICE_STORE: store, MSO_DEVICE_FILE: devFile, MSO_SYSTEMCTL_BIN: path.join(bin, "systemctl"),
    NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE: "", OS_SESSION_COOKIE_DOMAIN: "", OS_PUBLIC_ORIGIN: "" };
  return { root, store, device, env };
}

describe("mso doctor", () => {
  it("explains that plain HTTP on a server IP cannot keep a browser session", () => {
    const fx = fixture();
    try {
      const result = spawnSync(CLI, ["--base", "http://192.0.2.10:4005", "doctor"], { encoding: "utf8", env: fx.env });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("FAIL  login transport");
      expect(result.stdout).toContain("browser login requires HTTPS or a loopback URL");
      expect(result.stdout).toContain("http://localhost");
    } finally { fs.rmSync(fx.root, { recursive: true, force: true }); }
  });

  it("--fix promotes this host's pending CLI device and refreshes its session without changing TLS/network state", () => {
    const fx = fixture();
    try {
      const result = spawnSync(CLI, ["--base", "http://127.0.0.1:4005", "doctor", "--fix"], { encoding: "utf8", env: fx.env });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("mso doctor --fix");
      expect(result.stdout).toContain("FIXED local CLI device approved");
      expect(result.stdout).toContain("FIXED session refreshed");
      expect(result.stdout).toContain("never changes DNS, TLS certificates, firewall rules, public exposure, or credentials");
      const parsed = JSON.parse(fs.readFileSync(fx.store, "utf8"));
      expect(parsed.approved[fx.device]).toMatchObject({ label: "mso cli", role: "owner" });
      expect(parsed.pending[fx.device]).toBeUndefined();
    } finally { fs.rmSync(fx.root, { recursive: true, force: true }); }
  });
});
