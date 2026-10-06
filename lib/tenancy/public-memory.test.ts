import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { createTenantAuthority } from "./authority";
import { invokeTenantMemory } from "./public-memory";
import { openTenantPersistence } from "./persistence";
import { alice, bindingA, fixture } from "./persistence-test-fixtures";
import type { TenantContext } from "./authority";
const cleanups: Array<() => Promise<void>> = [];
async function setup() { const f = await fixture(); cleanups.push(f.cleanup); return f; }
afterEach(async () => { for (const clean of cleanups.splice(0)) await clean(); });
const remember = (context: TenantContext, key: string, value: string, extra = {}) =>
  invokeTenantMemory(context, "agent_memory_remember", { document: "MEMORY.md", key, value, ...extra });
const read = (context: TenantContext) => invokeTenantMemory(context, "agent_memory_read", {}) as Promise<{ memory: string; user: string }>;
const search = (context: TenantContext, extra = {}) =>
  invokeTenantMemory(context, "agent_memory_search", extra) as Promise<{ total: number; records: Array<{ record: { key: string; value: string; retractedAt?: string }; conflicts: unknown[] }> }>;
describe("public tenant memory with durable typed claims", () => {
  it("separates identical keys across tenants and never logs keys or values", async () => {
    const f = await setup();
    await Promise.all([remember(f.contextA, "private-key-A", "private-value-A"), remember(f.contextB, "private-key-A", "private-value-B")]);
    expect((await read(f.contextA)).memory).toContain("private-value-A");
    expect((await read(f.contextA)).memory).not.toContain("private-value-B");
    expect((await read(f.contextB)).memory).toContain("private-value-B");
    const state = JSON.parse(await fs.readFile(f.root + "/state.json", "utf8"));
    expect(state.audit.filter((e: { tool?: string }) => e.tool)).toHaveLength(2);
    const audit = JSON.stringify(state.audit);
    for (const secret of ["private-key-A", "private-value-A", "private-value-B", "fixture", "alice"]) expect(audit).not.toContain(secret);
    expect(audit).toContain("agent_memory_remember");
    expect(await f.store.administration.status()).toEqual({ revision: 4, auditEntries: 4 });
  });
  it("keeps same-tenant principals separate and serializes concurrent keyed writes", async () => {
    const f = await setup(), peer = { ...alice, subject: "peer" };
    await f.store.administration.setBinding(peer, { ...bindingA, principalId: "peer" }, 2);
    const context = await f.authority.authenticate(peer);
    await Promise.all(Array.from({ length: 10 }, (_, i) => remember(i % 2 ? context : f.contextA, "key-" + i, "value-" + i)));
    expect((await search(f.contextA)).total).toBe(5);
    expect((await search(context)).total).toBe(5);
    expect((await read(f.contextA)).memory).not.toContain("value-1");
    expect((await read(context)).memory).not.toContain("value-0");
  });
  it("preserves claim conflicts, replacement, typed metadata and reopen behavior", async () => {
    const f = await setup();
    await remember(f.contextA, "Region", "A", { kind: "semantic", confidence: 0.9, sensitivity: "private" });
    await remember(f.contextA, "Region", "B", { mode: "claim", confidence: 0.8 });
    expect((await search(f.contextA, { query: "Region" })).records[0].conflicts).toHaveLength(1);
    await remember(f.contextA, "Region", "C");
    expect((await read(f.contextA)).memory).toContain("C");
    expect((await search(f.contextA, { include_history: true })).total).toBe(3);
    const reopened = await openTenantPersistence({ root: f.root });
    const context = await createTenantAuthority(reopened.registry, reopened.storage).authenticate(alice);
    expect((await search(context, { include_history: true })).total).toBe(3);
  });
  it("does not reinterpret multiline headings as new keys, and forget retains history", async () => {
    const f = await setup();
    await remember(f.contextA, "safe", "first\n## manufactured\nsecond");
    expect((await search(f.contextA)).records.map(r => r.record.key)).toEqual(["safe"]);
    await invokeTenantMemory(f.contextA, "agent_memory_forget", { document: "MEMORY.md", key: "manufactured" });
    expect((await search(f.contextA)).total).toBe(1);
    await invokeTenantMemory(f.contextA, "agent_memory_forget", { document: "MEMORY.md", key: "safe" });
    expect((await read(f.contextA)).memory).toBe("");
    expect((await search(f.contextA, { include_history: true })).records[0].record.retractedAt).toBeDefined();
  });
  it("preserves temporal validity and rejects malformed intervals without mutation", async () => {
    const f = await setup();
    await remember(f.contextA, "future", "scheduled", { valid_from: "2030-01-01T00:00:00Z", valid_until: "2032-01-01T00:00:00Z" });
    expect((await search(f.contextA, { at: "2029-01-01T00:00:00Z" })).total).toBe(0);
    expect((await search(f.contextA, { at: "2031-01-01T00:00:00Z" })).total).toBe(1);
    expect((await search(f.contextA, { at: "2033-01-01T00:00:00Z" })).total).toBe(0);
    const before = await f.store.administration.status();
    await expect(remember(f.contextA, "bad", "bad", { valid_from: "2032-01-01", valid_until: "2030-01-01" })).rejects.toThrow();
    expect(await f.store.administration.status()).toEqual(before);
  });
  it.each([{ tenantId: "tenant-b" }, { path: "/owner" }, { user: "bob" }, { workflow_id: "foreign" },
    { document: "CLAIMS.v1" }, { key: "bad\u0000key" }, { confidence: "1" }, { mode: "other" },
    { sensitivity: null }, { value: "" }, { value: "x".repeat(8193) }])("rejects malformed/routing arguments %j", async extra => {
    const f = await setup(), before = await f.store.administration.status();
    await expect(remember(f.contextA, "safe", "safe", extra)).rejects.toThrow();
    expect(await f.store.administration.status()).toEqual(before);
  });
  it("revalidates revocation inside the mutation transaction", async () => {
    const f = await setup();
    const storage = { ...f.store.storage, operateMemory: async (...args: Parameters<typeof f.store.storage.operateMemory>) => {
      await f.store.administration.setBinding(alice, { ...bindingA, enabled: false }, 2);
      return f.store.storage.operateMemory(...args);
    } };
    const context = await createTenantAuthority(f.store.registry, storage).authenticate(alice);
    await expect(remember(context, "denied", "never stored")).rejects.toThrow();
    const state = JSON.parse(await fs.readFile(f.root + "/state.json", "utf8"));
    expect(state.memory).toEqual([]); expect(state.audit).toHaveLength(3);
  });
  it("refuses implicit conversion or ambiguous mixing of raw and typed memory", async () => {
    const f = await setup();
    await f.store.storage.writeMemory({ identity: alice, binding: (await f.store.registry.resolve(alice))! }, "MEMORY.md", "unstructured original", 2, 0);
    await expect(remember(f.contextA, "new", "new")).rejects.toThrow("reviewed import");
    expect((await read(f.contextA)).memory).toBe("unstructured original");
  });
});
