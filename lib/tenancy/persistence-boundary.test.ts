import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { openTenantPersistence } from "./persistence";
import { createTenantAuthority } from "./authority";
import { readTenantMemory } from "./storage";
import { MAX_AUDIT, MAX_STORE_BYTES } from "./persistence-schema";
import { alice, bindingA, fixture } from "./persistence-test-fixtures";

const cleanups: Array<() => Promise<void>> = [];
async function setup() { const f = await fixture(); cleanups.push(f.cleanup); return f; }
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
describe("tenant persistence fail-closed boundary", () => {
  it.each(["", ".", "/", "/tmp/../tmp"])("requires an explicit canonical root: %s", async root => {
    await expect(openTenantPersistence({ root })).rejects.toThrow();
  });
  it("rejects symlink roots without creating files", async () => {
    const f = await setup();
    const alias = f.root + "-alias";
    await fs.symlink(f.root, alias);
    cleanups.push(() => fs.unlink(alias));
    await expect(openTenantPersistence({ root: alias })).rejects.toThrow("symlinks");
  });
  it("rejects changed root identity", async () => {
    const f = await setup();
    await fs.rename(f.root, f.root + "-original");
    cleanups.push(() => fs.rm(f.root + "-original", { recursive: true, force: true }));
    await fs.mkdir(f.root, { mode: 0o700 });
    await expect(f.store.administration.status()).rejects.toThrow("invalid tenant root");
    expect(await fs.readdir(f.root)).toEqual([]);
  });
  it.each(["symlink", "hardlink", "directory", "loose-mode"])("rejects an unsafe state leaf: %s", async kind => {
    const f = await setup();
    await fs.rename(f.root + "/state.json", f.root + "/preserved.json");
    if (kind === "symlink") await fs.symlink("preserved.json", f.root + "/state.json");
    if (kind === "hardlink") await fs.link(f.root + "/preserved.json", f.root + "/state.json");
    if (kind === "directory") await fs.mkdir(f.root + "/state.json", { mode: 0o700 });
    if (kind === "loose-mode") {
      await fs.copyFile(f.root + "/preserved.json", f.root + "/state.json");
      await fs.chmod(f.root + "/state.json", 0o644);
    }
    await expect(f.store.administration.status()).rejects.toThrow();
  });
  it("rejects an overly permissive synthetic root", async () => {
    const f = await setup();
    await fs.chmod(f.root, 0o755);
    await expect(f.store.administration.status()).rejects.toThrow();
  });
  it.each(["truncated", "unknown-schema", "duplicate-binding", "duplicate-memory", "extra-field", "invalid-boolean",
    "unsafe-revision", "invalid-utf8", "inconsistent-tenant"])("rejects corrupted state: %s", async kind => {
    const f = await setup();
    const state = JSON.parse(await fs.readFile(f.root + "/state.json", "utf8"));
    if (kind === "unknown-schema") state.schema = 2;
    if (kind === "duplicate-binding") state.bindings.push(state.bindings[0]);
    if (kind === "duplicate-memory") state.memory = Array(2).fill({
      tenantId: "tenant-a", principalId: "person-a", mappingRevision: 1, collection: "memory", key: "USER.md", value: "", version: 1,
    });
    if (kind === "extra-field") state.audit[0].secret = "should-never-load";
    if (kind === "invalid-boolean") state.bindings[0].enabled = "true";
    if (kind === "unsafe-revision") state.revision = Number.MAX_SAFE_INTEGER + 1;
    if (kind === "inconsistent-tenant") state.bindings.push({ ...state.bindings[0], subject: "peer", principalId: "peer", tenantEnabled: false });
    let bytes: string | Buffer = JSON.stringify(state);
    if (kind === "truncated") bytes = bytes.slice(0, -1);
    if (kind === "invalid-utf8") bytes = Buffer.concat([Buffer.from('{"bad":"'), Buffer.from([0xc3, 0x28]), Buffer.from('"}')]);
    await fs.writeFile(f.root + "/state.json", bytes);
    await expect(openTenantPersistence({ root: f.root, initialize: true })).rejects.toThrow();
    await expect(f.store.registry.resolve(alice)).rejects.toThrow();
  });
  it("bounds bytes before parsing", async () => {
    const f = await setup();
    await fs.truncate(f.root + "/state.json", MAX_STORE_BYTES + 1);
    await expect(f.store.administration.status()).rejects.toThrow("invalid tenant state file");
  });
  it("audit exhaustion denies tenant access while retaining administrative reconciliation", async () => {
    const f = await setup();
    const state = JSON.parse(await fs.readFile(f.root + "/state.json", "utf8"));
    for (let i = 3; i <= MAX_AUDIT; i++) state.audit.push({ ...state.audit[0], id: "event-" + i, revision: i });
    state.revision = MAX_AUDIT;
    await fs.writeFile(f.root + "/state.json", JSON.stringify(state));
    await expect(createTenantAuthority(f.store.registry, f.store.storage).authenticate(alice)).rejects.toThrow("capacity");
    await expect(readTenantMemory(f.contextA)).rejects.toThrow("capacity");
    await expect(f.store.administration.setBinding(alice, { ...bindingA, enabled: false }, MAX_AUDIT)).rejects.toThrow("capacity");
    expect(await f.store.administration.operationStatus("event-" + MAX_AUDIT)).toMatchObject({ revision: MAX_AUDIT });
  });
  it("closes tenant reads near byte capacity before revocation space is exhausted", async () => {
    const f = await setup();
    const state = JSON.parse(await fs.readFile(f.root + "/state.json", "utf8"));
    state.revision = 254;
    for (let i = 3; i <= 254; i++) state.audit.push({ ...state.audit[0], id: "event-" + i, revision: i });
    state.memory = Array.from({ length: 254 }, (_, i) => ({
      tenantId: "historical-" + i, principalId: "p", mappingRevision: 1,
      collection: "memory", key: "MEMORY.md", value: "x".repeat(65536), version: 1,
    }));
    const bytes = JSON.stringify(state);
    expect(Buffer.byteLength(bytes)).toBeGreaterThan(MAX_STORE_BYTES - 131072);
    expect(Buffer.byteLength(bytes)).toBeLessThan(MAX_STORE_BYTES);
    await fs.writeFile(f.root + "/state.json", bytes);
    await expect(readTenantMemory(f.contextA)).rejects.toThrow("capacity");
    await f.store.administration.setBinding(alice, { ...bindingA, enabled: false }, 254);
    expect((await f.store.administration.status()).revision).toBe(255);
  });
  it("projects control-plane inputs rather than persisting injected subject or payload fields", async () => {
    const f = await setup();
    await f.store.administration.setBinding(alice, { ...bindingA, issuer: "attacker", subject: "other", token: "fake-secret" } as typeof bindingA, 2);
    const state = await fs.readFile(f.root + "/state.json", "utf8");
    expect(state).not.toContain("fake-secret");
    expect(state).not.toContain("attacker");
    expect(await f.store.registry.resolve(alice)).toMatchObject({ mappingRevision: 3 });
  });
});
