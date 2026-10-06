import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { createTenantAuthority } from "./authority";
import { readTenantMemory } from "./storage";
import { writeTenantMemory } from "./memory-write";
import { openTenantPersistence } from "./persistence";
import { alice, bob, bindingA, bindingB, fixture } from "./persistence-test-fixtures";

const cleanups: Array<() => Promise<void>> = [];
async function setup() { const f = await fixture(); cleanups.push(f.cleanup); return f; }
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
describe("durable tenant registry and memory", () => {
  it("persists registry, memory and scoped audit across independent instances", async () => {
    const f = await setup();
    const result = await writeTenantMemory(f.contextA, "MEMORY.md", "synthetic alice", 2, 0);
    expect(result.revision).toBe(3);
    const reopened = await openTenantPersistence({ root: f.root });
    const context = await createTenantAuthority(reopened.registry, reopened.storage).authenticate(alice);
    expect((await readTenantMemory(context)).memory).toBe("synthetic alice");
    expect((await readTenantMemory(f.contextB)).memory).toBe("");
    const binding = await reopened.registry.resolve(alice);
    const events = await reopened.audit.read(binding!);
    expect(events.map(e => e.action)).toEqual(["binding.changed", "memory.written"]);
    expect(JSON.stringify(events)).not.toContain("synthetic alice");
    expect(JSON.stringify(events)).not.toContain("fixture");
  });
  it("separates equal keys for two tenants and enforces document/store CAS", async () => {
    const f = await setup();
    await writeTenantMemory(f.contextA, "USER.md", "A", 2, 0);
    await expect(writeTenantMemory(f.contextB, "USER.md", "B", 2, 0)).rejects.toThrow("revision conflict");
    await writeTenantMemory(f.contextB, "USER.md", "B", 3, 0);
    await expect(writeTenantMemory(f.contextA, "USER.md", "overwrite", 4, 0)).rejects.toThrow("version conflict");
    expect((await readTenantMemory(f.contextA)).user).toBe("A");
    expect((await readTenantMemory(f.contextB)).user).toBe("B");
    expect((await f.store.administration.status()).revision).toBe(4);
  });
  it("revocation first denies writes; re-enable never revives the old context", async () => {
    const f = await setup();
    await f.store.administration.setBinding(alice, { ...bindingA, enabled: false }, 2);
    await expect(writeTenantMemory(f.contextA, "MEMORY.md", "denied", 3, 0)).rejects.toThrow();
    await f.store.administration.setBinding(alice, bindingA, 3);
    await expect(readTenantMemory(f.contextA)).rejects.toThrow();
    const next = await f.authority.authenticate(alice);
    expect((await readTenantMemory(next)).memory).toBe("");
    expect((await f.store.administration.status()).revision).toBe(4);
  });
  it("writes ordered before revocation remain committed without later access", async () => {
    const f = await setup();
    await writeTenantMemory(f.contextA, "MEMORY.md", "committed first", 2, 0);
    await f.store.administration.setBinding(alice, { ...bindingA, enabled: false }, 3);
    await expect(readTenantMemory(f.contextA)).rejects.toThrow();
    const state = JSON.parse(await fs.readFile(f.root + "/state.json", "utf8"));
    expect(state.memory[0].value).toBe("committed first");
    expect(state.audit.map((e: { action: string }) => e.action)).toEqual([
      "binding.changed", "binding.changed", "memory.written", "binding.changed",
    ]);
  });
  it("rejects direct stale grants and expired grants inside the transaction", async () => {
    const f = await setup();
    const old = (await f.store.registry.resolve(alice))!;
    await f.store.administration.setBinding(alice, { ...bindingA, enabled: false }, 2);
    await expect(f.store.storage.writeMemory({ identity: alice, binding: old }, "MEMORY.md", "bad", 3, 0)).rejects.toThrow();
    const live = (await f.store.registry.resolve(bob))!;
    await expect(f.store.storage.writeMemory({ identity: { ...bob, expiresAt: 1 }, binding: live },
      "MEMORY.md", "bad", 3, 0)).rejects.toThrow();
    expect((await f.store.administration.status()).revision).toBe(3);
  });
  it("does not expose other collections, paths or fabricated generations", async () => {
    const f = await setup();
    const base = { tenantId: "tenant-a", principalId: "person-a", mappingRevision: 1, collection: "memory" as const, key: "MEMORY.md" };
    for (const changed of [{ mappingRevision: 2 }, { principalId: "person-b" }, { key: "../owner" }, { collection: "jobs" }]) {
      await expect(f.store.storage.read({ ...base, ...changed } as typeof base)).rejects.toThrow();
    }
    await expect(f.authority.authenticate({ ...alice, subject: "unknown" })).rejects.toThrow();
  });
  it("rejects ambiguous principals and keeps failed mutations out of state", async () => {
    const f = await setup();
    await expect(f.store.administration.setBinding(bob, bindingA, 2)).rejects.toThrow("already bound");
    expect((await f.store.administration.status()).revision).toBe(2);
    expect(await f.store.registry.resolve(bob)).toMatchObject(bindingB);
  });
  it("invalidates all same-tenant bindings on tenant disable and re-enable", async () => {
    const f = await setup();
    const other = { ...bob, subject: "alice-peer" };
    await f.store.administration.setBinding(other, { ...bindingA, principalId: "peer" }, 2);
    const context = await f.authority.authenticate(other);
    await f.store.administration.setBinding(alice, { ...bindingA, tenantEnabled: false }, 3);
    await expect(readTenantMemory(context)).rejects.toThrow();
    await f.store.administration.setBinding(alice, bindingA, 4);
    await expect(readTenantMemory(context)).rejects.toThrow();
    const live = (await f.store.registry.resolve(other))!;
    expect(live.mappingRevision).toBe(5);
    const audit = await f.store.audit.read(live);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ scope: "tenant" });
    expect(audit[0]).not.toHaveProperty("principalId");
    expect(JSON.stringify(audit)).not.toContain("person-a");
  });
});
