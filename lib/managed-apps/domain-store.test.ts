import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagedDomainConfig } from "@/lib/contracts/managed-domains";
import { mutateManagedDomains, readManagedDomains, restoreManagedDomains, saveManagedDomainConfig, withManagedDomainOperation } from "./domain-store";

const config: ManagedDomainConfig = {
  publicOrigin: "https://mso.example.com", hostTemplate: "{id}.mso.example.com",
  localOrigin: "http://127.0.0.1:4005", zoneId: "a".repeat(32), zoneName: "example.com",
  accountId: "b".repeat(32), tunnelId: "12345678-1234-1234-1234-123456789abc",
  user: "owner", connection: "cloudflare-main", autoProvision: true,
};
let directory: string;
let file: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "mso-domain-store-"));
  file = path.join(directory, "domains.json");
  vi.stubEnv("OS_MANAGED_DOMAINS_STORE", file);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(directory, { recursive: true, force: true });
});

describe("persistent managed-domain state", () => {
  it("starts unconfigured and reloads the committed identity and configuration from disk", async () => {
    expect(await readManagedDomains()).toMatchObject({ version: 1, revision: 0, config: null, apps: {} });
    const saved = await saveManagedDomainConfig(config);
    expect(saved.revision).toBe(1);
    expect(await readManagedDomains()).toEqual(saved);
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual(saved);
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(file)).uid).toBe(process.getuid?.());
  });

  it("retains a valid previous snapshot and restores it after a corrupt write", async () => {
    const first = await saveManagedDomainConfig(config);
    await saveManagedDomainConfig({ ...config, autoProvision: false });
    expect(JSON.parse(await fs.readFile(`${file}.previous`, "utf8"))).toEqual(first);
    expect((await fs.stat(`${file}.previous`)).mode & 0o777).toBe(0o600);
    await fs.writeFile(file, "{interrupted-json", { mode: 0o600 });
    await expect(readManagedDomains()).rejects.toThrow();
    await expect(saveManagedDomainConfig(config)).rejects.toThrow();
    expect(await fs.readFile(file, "utf8")).toBe("{interrupted-json");
    const restored = await restoreManagedDomains();
    expect(restored).toEqual({ ...first, revision: first.revision + 1 });
    expect(await readManagedDomains()).toEqual(restored);
  });

  it("refuses malformed snapshots and never silently resets the store", async () => {
    await saveManagedDomainConfig(config);
    const invalid = { ...(await readManagedDomains()), version: 99 };
    const content = JSON.stringify(invalid);
    await fs.writeFile(file, content);
    await expect(mutateManagedDomains(state => { state.apps = {}; })).rejects.toThrow();
    expect(await fs.readFile(file, "utf8")).toBe(content);
    await expect(restoreManagedDomains()).rejects.toThrow(/no previous/);
  });

  it("does not rebind an existing deployment or overwrite a good snapshot on validation failure", async () => {
    await saveManagedDomainConfig(config);
    const before = await fs.readFile(file, "utf8");
    await expect(saveManagedDomainConfig({ ...config, tunnelId: "87654321-1234-1234-1234-123456789abc" })).rejects.toThrow(/different routing/);
    await expect(mutateManagedDomains(state => { state.revision = -2; })).rejects.toThrow();
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });

  it("keeps each application when concurrent callers update the same store", async () => {
    const initial = await saveManagedDomainConfig(config);
    await Promise.all(["9router", "hermes", "openclaw"].map(appId => mutateManagedDomains(state => {
      state.apps[appId] = { appId, hostname: `${appId}.mso.example.com`, phase: "pending", updatedAt: 10 };
    })));
    const state = await readManagedDomains();
    expect(Object.keys(state.apps).sort()).toEqual(["9router", "hermes", "openclaw"]);
    expect(state.revision).toBe(initial.revision + 3);
    expect(state.ownerId).toBe(initial.ownerId);
  });

  it("serializes provisioning operations and releases the lock after a failure", async () => {
    let active = 0;
    let maximum = 0;
    await Promise.all([1, 2, 3].map(() => withManagedDomainOperation(async () => {
      maximum = Math.max(maximum, ++active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
    })));
    expect(maximum).toBe(1);
    await expect(withManagedDomainOperation(async () => { throw new Error("provider failed"); })).rejects.toThrow("provider failed");
    await expect(withManagedDomainOperation(async () => "retry")).resolves.toBe("retry");
  });

  it("refuses readable-by-others state without repairing or replacing it", async () => {
    await saveManagedDomainConfig(config);
    await fs.chmod(file, 0o644);
    await expect(readManagedDomains()).rejects.toThrow(/unsafe/);
    await expect(saveManagedDomainConfig(config)).rejects.toThrow(/unsafe/);
    expect((await fs.stat(file)).mode & 0o777).toBe(0o644);
  });

  it("refuses a symlinked state file during reads, writes, and snapshot recovery", async () => {
    await saveManagedDomainConfig(config);
    await saveManagedDomainConfig({ ...config, autoProvision: false });
    const target = path.join(directory, "unrelated.txt");
    await fs.writeFile(target, "untouched", { mode: 0o600 });
    await fs.unlink(file);
    await fs.symlink(target, file);
    await expect(readManagedDomains()).rejects.toThrow();
    await expect(saveManagedDomainConfig(config)).rejects.toThrow();
    await expect(restoreManagedDomains()).rejects.toThrow(/unsafe/);
    expect(await fs.readFile(target, "utf8")).toBe("untouched");
    expect((await fs.lstat(file)).isSymbolicLink()).toBe(true);
  });

  it("rejects an unsafe parent instead of creating state there", async () => {
    await fs.chmod(directory, 0o777);
    await expect(saveManagedDomainConfig(config)).rejects.toThrow(/parent/);
    await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
