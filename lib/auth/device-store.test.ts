import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// STORE_PATH is read at module load from OS_DEVICE_STORE, so each case points it at
// a fresh temp file and re-imports the module.
let dir: string;
let store: string;

async function load() {
  vi.resetModules();
  vi.stubEnv("OS_DEVICE_STORE", store);
  return import("./device-store");
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "mso-devstore-"));
  store = path.join(dir, "auth-devices.json");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(dir, { recursive: true, force: true });
});

const DEV = "a".repeat(32);
const OTHER = "b".repeat(32);

describe("device-store — an unreadable file must never look like an empty one", () => {
  it("treats a MISSING file as an empty store (legit first run)", async () => {
    const { listDevices } = await load();
    await expect(listDevices()).resolves.toEqual({ approved: {}, pending: {} });
  });

  it("THROWS on corrupt JSON instead of reporting an empty store", async () => {
    await fs.writeFile(store, "{ this is not json");
    const { listDevices } = await load();
    await expect(listDevices()).rejects.toThrow();
  });

  // The regression this file exists for. read() feeds a read-modify-write, and
  // recordPending writes unconditionally — so while read() swallowed every error,
  // one unparseable byte plus a single login attempt from an unapproved device
  // silently replaced the whole allowlist with {}, locking the owner out. That path
  // is reachable from the internet by anyone holding the password.
  it("does not WIPE approved devices when the file is corrupt", async () => {
    await fs.writeFile(store, "{ corrupt");
    const { recordPending } = await load();

    await expect(recordPending(OTHER, "attacker", "203.0.113.1")).rejects.toThrow();

    // The corrupt bytes must still be there — NOT overwritten with an empty store.
    expect(await fs.readFile(store, "utf8")).toBe("{ corrupt");
  });

  it("still records a pending device normally when the file is readable", async () => {
    const { approveDevice, recordPending, listDevices, isApproved } = await load();
    await approveDevice(DEV, "my laptop");
    await recordPending(OTHER, "new phone", "203.0.113.2");

    const s = await listDevices();
    expect(Object.keys(s.approved)).toEqual([DEV]); // survived the second write
    expect(s.approved[DEV].role).toBe("owner");
    expect(s.pending[OTHER].ip).toBe("203.0.113.2");
    await expect(isApproved(DEV)).resolves.toBe(true);
    await expect(isApproved(OTHER)).resolves.toBe(false);
  });

  it("keeps a device revoked when login touches race the kill switch", async () => {
    const { approveDevice, revokeDevice, touchApproved, isApproved } = await load();
    await approveDevice(DEV, "my laptop");
    await approveDevice(OTHER, "recovery owner");
    await Promise.all([
      ...Array.from({ length: 16 }, () => touchApproved(DEV)),
      revokeDevice(DEV),
    ]);
    await expect(isApproved(DEV)).resolves.toBe(false);
  });

  it("writes the store 0600 inside a 0700 dir", async () => {
    const { approveDevice } = await load();
    await approveDevice(DEV, "my laptop");
    expect((await fs.stat(store)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(path.dirname(store))).mode & 0o777).toBe(0o700);
  });
});

describe("device-store — delegated roles", () => {
  it("treats a pre-role approved entry as owner for backward compatibility", async () => {
    await fs.writeFile(store, JSON.stringify({
      approved: { [DEV]: { label: "legacy laptop", approvedAt: 1 } },
      pending: {},
    }));
    const { getApprovedDevice, listDevices } = await load();
    await expect(getApprovedDevice(DEV)).resolves.toMatchObject({ role: "owner" });
    expect((await listDevices()).approved[DEV].role).toBe("owner");
  });

  it("approves a least-privilege viewer and changes its role live", async () => {
    const { approveDevice, getApprovedDevice, setDeviceRole } = await load();
    await approveDevice(DEV, "guest phone", "viewer");
    await expect(getApprovedDevice(DEV)).resolves.toMatchObject({ role: "viewer" });
    await setDeviceRole(DEV, "operator");
    await expect(getApprovedDevice(DEV)).resolves.toMatchObject({ role: "operator" });
  });

  it("refuses approval as a role-change bypass for an existing device", async () => {
    const { approveDevice, getApprovedDevice } = await load();
    await approveDevice(DEV, "owner laptop", "owner");
    await expect(approveDevice(DEV, "same laptop", "viewer")).rejects.toThrow("already approved");
    await expect(getApprovedDevice(DEV)).resolves.toMatchObject({ role: "owner", label: "owner laptop" });
  });

  it("never lets the web role API remove the last owner", async () => {
    const { approveDevice, revokeDevice, setDeviceRole } = await load();
    await approveDevice(DEV, "only owner", "owner");
    await expect(setDeviceRole(DEV, "viewer")).rejects.toThrow("at least one owner");
    await expect(revokeDevice(DEV)).rejects.toThrow("at least one owner");
  });

  it("allows owner demotion after another owner exists", async () => {
    const { approveDevice, getApprovedDevice, setDeviceRole } = await load();
    await approveDevice(DEV, "owner one", "owner");
    await approveDevice(OTHER, "owner two", "owner");
    await setDeviceRole(DEV, "viewer");
    await expect(getApprovedDevice(DEV)).resolves.toMatchObject({ role: "viewer" });
  });
});
