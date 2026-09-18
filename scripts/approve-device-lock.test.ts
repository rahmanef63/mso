import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = path.join(process.cwd(), "scripts/approve-device.js");

describe("approve-device cross-process lock protocol", () => {
  it("publishes the primary lock only while holding the shared recovery gate", () => {
    const source = readFileSync(path.join(process.cwd(), "scripts/lib/device-cli-lock.js"), "utf8");
    const acquire = source.slice(source.indexOf("function acquireLock()"), source.indexOf("return { acquireLock"));
    const gate = acquire.indexOf("openExclusive(RECOVERY");
    const primary = acquire.indexOf("openExclusive(LOCK");
    expect(gate).toBeGreaterThanOrEqual(0);
    expect(primary).toBeGreaterThan(gate);
    expect(acquire).toContain("return openExclusive(LOCK, token)");
    expect(source).not.toContain("function recoverAbandonedLock");
  });

  it("preserves the durable session epoch across CLI approve, role and revoke writes", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "mso-approve-policy-"));
    const store = path.join(root, "devices.json");
    const owner = "a".repeat(32), device = "b".repeat(32);
    const policy = { scope: "host", epoch: "epoch-1234567890abcdef", changedAt: 1 };
    writeFileSync(store, JSON.stringify({
      approved: { [owner]: { label: "owner", approvedAt: 1, role: "owner" } },
      pending: { [device]: { label: "phone", firstSeen: 1, lastSeen: 1, ip: "127.0.0.1", attempts: 1 } },
      sessionPolicy: policy,
    }));
    const run = (args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], {
      env: { ...process.env, OS_DEVICE_STORE: store, MSO_SYSTEMCTL_BIN: "/bin/true" }, encoding: "utf8",
    });
    const savedPolicy = () => JSON.parse(readFileSync(store, "utf8")).sessionPolicy;
    try {
      expect(run([device, "phone", "--role", "viewer"]).status).toBe(0);
      expect(savedPolicy()).toEqual(policy);
      expect(run(["--set-role", device, "operator"]).status).toBe(0);
      expect(savedPolicy()).toEqual(policy);
      expect(run(["--revoke", device]).status).toBe(0);
      expect(savedPolicy()).toEqual(policy);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses approval as a role-change bypass for an existing device", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "mso-approve-role-"));
    const store = path.join(root, "devices.json");
    const device = "e".repeat(32);
    const run = (args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], {
      env: { ...process.env, OS_DEVICE_STORE: store }, encoding: "utf8",
    });
    try {
      expect(run([device, "owner laptop", "--role", "owner"]).status).toBe(0);
      const same = run([device, "same laptop", "--role", "owner"]);
      expect(same.status).toBe(0);
      expect(same.stdout).toContain("already approved");
      const second = run([device, "same laptop", "--role", "viewer"]);
      expect(second.status).not.toBe(0);
      expect(second.stderr).toContain("already approved");
      const parsed = JSON.parse(readFileSync(store, "utf8"));
      expect(parsed.approved[device]).toMatchObject({ label: "owner laptop", role: "owner" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
