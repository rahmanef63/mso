import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { TenantCommitUncertain } from "./persistence-file";
import { writeTenantMemory } from "./memory-write";
import { readTenantMemory } from "./storage";
import { fixture } from "./persistence-test-fixtures";

const cleanups: Array<() => Promise<void>> = [];
async function setup() { const f = await fixture(); cleanups.push(f.cleanup); return f; }
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0)) await cleanup(); });
describe("atomic tenant data and audit commits", () => {
  it("leaves old state intact when rename fails", async () => {
    const f = await setup();
    vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("synthetic rename failure"));
    await expect(writeTenantMemory(f.contextA, "MEMORY.md", "must-not-commit", 2, 0)).rejects.toThrow("synthetic");
    vi.restoreAllMocks();
    expect((await f.store.administration.status()).revision).toBe(2);
    expect((await readTenantMemory(f.contextA)).memory).toBe("");
    expect((await fs.readdir(f.root)).sort()).toEqual(["state.json"]);
  });
  it("leaves old state intact when temporary file fsync fails", async () => {
    const f = await setup();
    const open = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (String(args[0]).endsWith(".tmp")) handle.sync = async () => { throw new Error("synthetic temp sync failure"); };
      return handle;
    });
    await expect(writeTenantMemory(f.contextA, "MEMORY.md", "must-not-commit", 2, 0)).rejects.toThrow("synthetic");
    vi.restoreAllMocks();
    expect((await f.store.administration.status()).revision).toBe(2);
    expect((await fs.readdir(f.root)).sort()).toEqual(["state.json"]);
  });
  it("reports an uncertain commit after rename if directory fsync fails, with reconcilable operation ID", async () => {
    const f = await setup();
    const open = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (String(args[0]) === f.root) handle.sync = async () => { throw new Error("synthetic directory sync failure"); };
      return handle;
    });
    let error: unknown;
    try { await writeTenantMemory(f.contextA, "MEMORY.md", "possibly-committed", 2, 0); } catch (e) { error = e; }
    vi.restoreAllMocks();
    expect(error).toBeInstanceOf(TenantCommitUncertain);
    const event = await f.store.administration.operationStatus((error as TenantCommitUncertain).operationId);
    expect(event).toMatchObject({ action: "memory.written", revision: 3 });
    expect((await readTenantMemory(f.contextA)).memory).toBe("possibly-committed");
    await expect(writeTenantMemory(f.contextA, "MEMORY.md", "blind-retry", 2, 0)).rejects.toThrow("revision conflict");
  });
  it("preserves committed outcome when lock cleanup fails", async () => {
    const f = await setup();
    const unlink = fs.unlink.bind(fs);
    let error: unknown;
    vi.spyOn(fs, "unlink").mockImplementation(async target => {
      if (String(target).endsWith("/state.lock")) throw new Error("synthetic unlock failure");
      await unlink(target);
    });
    try { await f.store.administration.setBinding({ issuer: "fixture", subject: "third" },
      { tenantId: "third", principalId: "third", enabled: true, tenantEnabled: true }, 2); } catch (e) { error = e; }
    vi.restoreAllMocks();
    expect(error).toBeInstanceOf(TenantCommitUncertain);
    await fs.unlink(f.root + "/state.lock"); // Exact synthetic lock from the injected failure.
    expect(await f.store.administration.operationStatus((error as TenantCommitUncertain).operationId)).toMatchObject({ revision: 3 });
  });
});
