import { afterEach, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { createConfiguredTenantRuntime } from "./configured-runtime";
import { tenantAccess } from "./authority";
import { tenantFile } from "./persistence-file";
import { alice, fixture } from "./persistence-test-fixtures";
import type { TenantPublicMemoryPort } from "./types";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function setup() {
  const f = await fixture(); cleanups.push(f.cleanup);
  let enabled = true, selectedRoot = f.root;
  const b = (await f.store.registry.resolve(alice))!;
  const token = { expiresAt: alice.expiresAt, tenantBinding: { version: 1, issuer: alice.issuer, subject: alice.subject,
    tenantId: b.tenantId, principalId: b.principalId, mappingRevision: b.mappingRevision } };
  const runtime = await createConfiguredTenantRuntime({ storageRoot: f.root, enabled: () => enabled,
    selectedRoot: () => selectedRoot, verifyAccessToken: async raw => raw === "fixture" ? token : null });
  const context = (await runtime.authenticateBearer("fixture"))!, access = await tenantAccess(context);
  return { ...f, runtime, access, disable: () => { enabled = false; }, changeRoot: () => { selectedRoot = f.root + "-other"; } };
}
it("does not open or create tenant storage when disabled", async () => {
  const open = vi.spyOn(fs, "open");
  await expect(createConfiguredTenantRuntime({ storageRoot: "/not-a-configured-tenant-root", enabled: () => false,
    selectedRoot: () => undefined, verifyAccessToken: async () => null })).rejects.toThrow();
  expect(open).not.toHaveBeenCalled();
});
it.each(["disable", "changeRoot"] as const)("denies a queued mutation after %s", async change => {
  const f = await setup(), file = await tenantFile(f.root);
  let release!: () => void, entered!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; }), held = new Promise<void>(resolve => { entered = resolve; });
  const holding = file.transaction(async () => { entered(); await wait; });
  await held;
  const pending = (f.access.storage as TenantPublicMemoryPort).operateMemory({ identity: f.access.identity, binding: f.access.binding },
    "agent_memory_remember", { document: "MEMORY.md", key: "blocked", value: "not committed" });
  const refused = expect(pending).rejects.toThrow("configuration changed");
  await new Promise(resolve => setTimeout(resolve, 25));
  f[change](); release(); await holding; await refused;
  expect(await f.store.administration.status()).toEqual({ revision: 2, auditEntries: 2 });
});
it("checks configuration again immediately before publishing staged bytes", async () => {
  const f = await setup(), open = fs.open.bind(fs);
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args);
    if (String(args[0]).endsWith(".tmp")) {
      const sync = handle.sync.bind(handle);
      handle.sync = async () => { await sync(); f.disable(); };
    }
    return handle;
  });
  await expect((f.access.storage as TenantPublicMemoryPort).operateMemory({ identity: f.access.identity, binding: f.access.binding },
    "agent_memory_remember", { document: "MEMORY.md", key: "blocked", value: "not committed" })).rejects.toThrow("configuration changed");
  vi.restoreAllMocks();
  expect(await f.store.administration.status()).toEqual({ revision: 2, auditEntries: 2 });
});
it("rejects root replacement while a request waits for the old lock", async () => {
  const f = await setup(), file = await tenantFile(f.root);
  let release!: () => void, entered!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; }), held = new Promise<void>(resolve => { entered = resolve; });
  const holding = file.transaction(async () => { entered(); await wait; });
  await held;
  const pending = (f.access.storage as TenantPublicMemoryPort).operateMemory({ identity: f.access.identity, binding: f.access.binding },
    "agent_memory_remember", { document: "MEMORY.md", key: "blocked", value: "not committed" });
  const refused = expect(pending).rejects.toThrow("invalid tenant root");
  await new Promise(resolve => setTimeout(resolve, 25));
  await fs.rename(f.root, f.root + "-old"); await fs.mkdir(f.root, { mode: 0o700 });
  cleanups.push(() => fs.rm(f.root + "-old", { recursive: true, force: true }));
  release(); await holding; await refused;
  expect(await fs.readdir(f.root)).toEqual([]);
  expect(JSON.parse(await fs.readFile(f.root + "-old/state.json", "utf8")).revision).toBe(2);
});
