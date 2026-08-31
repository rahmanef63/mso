import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = path.join(process.cwd(), "scripts/approve-device.js");

describe("approve-device cross-process lock protocol", () => {
  it("publishes the primary lock only while holding the shared recovery gate", () => {
    const source = readFileSync(SCRIPT, "utf8");
    const acquire = source.slice(source.indexOf("function acquireLock()"), source.indexOf("function withMutation"));
    const gate = acquire.indexOf("openExclusive(RECOVERY");
    const primary = acquire.indexOf("openExclusive(LOCK");
    expect(gate).toBeGreaterThanOrEqual(0);
    expect(primary).toBeGreaterThan(gate);
    expect(acquire).toContain("return openExclusive(LOCK, token)");
    expect(source).not.toContain("function recoverAbandonedLock");
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
