import { fixture as persistentFixture, alice } from "./persistence-test-fixtures";
import { describe, expect, it } from "vitest";
import { createTenantRuntime, type VerifiedTenantToken } from "./runtime-factory";
import { tenantAccess } from "./authority";
import type { TenantBinding, TenantCredentialBinding, TenantRegistryPort } from "./types";

const stampA: TenantCredentialBinding = { version: 1, issuer: "issuer-a", subject: "alice", tenantId: "tenant-a", principalId: "person-a", mappingRevision: 1 };
function fixture() {
  let enabled = true;
  const bindings = new Map<string, TenantBinding>([
    ["issuer-a:alice", { tenantId: "tenant-a", principalId: "person-a", mappingRevision: 1, enabled: true, tenantEnabled: true }],
    ["issuer-b:alice", { tenantId: "tenant-b", principalId: "person-b", mappingRevision: 2, enabled: true, tenantEnabled: true }],
  ]);
  const token: VerifiedTenantToken = { tenantBinding: { ...stampA }, expiresAt: 5000 };
  const tokens = new Map([["fixture-A", token]]);
  const registry: TenantRegistryPort = { resolve: async identity => bindings.get(identity.issuer + ":" + identity.subject) ?? null };
  const runtime = createTenantRuntime({ registry, storage: { read: async () => null },
    verifyAccessToken: async bearer => tokens.get(bearer) ?? null, enabled: () => enabled, now: () => 1000 });
  return { runtime, token, tokens, registry, bindings, enable: (value: boolean) => { enabled = value; } };
}
describe("injected tenant runtime with a fake verifier", () => {
  it("resolves the exact verified issuer and generation", async () => {
    const f = fixture();
    const context = (await f.runtime.authenticateBearer("fixture-A"))!;
    expect((await tenantAccess(context)).binding.tenantId).toBe("tenant-a");
    const other = { ...stampA, issuer: "issuer-b", tenantId: "tenant-b", principalId: "person-b", mappingRevision: 2 };
    f.tokens.set("fixture-B", { tenantBinding: other, expiresAt: 5000 });
    expect((await tenantAccess((await f.runtime.authenticateBearer("fixture-B"))!)).binding.tenantId).toBe("tenant-b");
  });
  it.each(["issuer", "subject", "tenantId", "principalId", "mappingRevision"] as const)("denies a mismatched %s", async field => {
    const f = fixture();
    f.token.tenantBinding = { ...stampA, [field]: field === "mappingRevision" ? 2 : "foreign" };
    await expect(f.runtime.authenticateBearer("fixture-A")).rejects.toThrow();
  });
  it.each(["tenantId", "principalId", "mappingRevision", "enabled", "tenantEnabled"] as const)("denies fresh requests after registry %s changes", async field => {
    const f = fixture();
    await f.runtime.authenticateBearer("fixture-A");
    Object.assign(f.bindings.get("issuer-a:alice")!, { [field]: field === "mappingRevision" ? 2 : field.endsWith("Enabled") || field === "enabled" ? false : "changed" });
    await expect(f.runtime.authenticateBearer("fixture-A")).rejects.toThrow();
  });
  it("does not reactivate old credentials after disable and re-enable", async () => {
    const f = fixture(), binding = f.bindings.get("issuer-a:alice")!;
    binding.enabled = false; binding.mappingRevision = 2;
    await expect(f.runtime.authenticateBearer("fixture-A")).rejects.toThrow();
    binding.enabled = true; binding.mappingRevision = 3;
    await expect(f.runtime.authenticateBearer("fixture-A")).rejects.toThrow();
  });
  it.each([{ expiresAt: 0 }, { expiresAt: 999 }, { expiresAt: Infinity }, { expiresAt: 5000, revokedAt: 1 },
    { expiresAt: 5000 }, { expiresAt: 5000, tenantSubject: "alice" }])("denies invalid or unbound record %j", async input => {
    const f = fixture();
    const value = "tenantSubject" in input || Object.keys(input).length === 1 && input.expiresAt === 5000
      ? input : { tenantBinding: stampA, ...input };
    await expect(f.runtime.resolveValidatedToken(value)).rejects.toThrow();
  });
  it("preserves legacy behavior only for unmarked records with mode off", async () => {
    const f = fixture(); f.enable(false);
    await expect(f.runtime.resolveValidatedToken({ expiresAt: 0 })).resolves.toBeUndefined();
    for (const value of [f.token, { expiresAt: 5000, tenantSubject: "alice" }, { expiresAt: 5000, tenantBinding: null }]) {
      await expect(f.runtime.resolveValidatedToken(value)).rejects.toThrow();
    }
  });
  it("does not let unknown bearers or caller objects act as credentials", async () => {
    const f = fixture();
    for (const raw of ["", "unknown", "x".repeat(8193)]) await expect(f.runtime.authenticateBearer(raw)).rejects.toThrow();
    await expect(f.runtime.authenticateBearer({ tenantBinding: stampA } as unknown as string)).rejects.toThrow();
  });
  it("captures the stamp before asynchronous registry work", async () => {
    const f = fixture();
    let release!: () => void, entered!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    f.registry.resolve = async () => { entered(); await barrier; return f.bindings.get("issuer-a:alice")!; };
    const pending = f.runtime.authenticateBearer("fixture-A");
    await started;
    (f.token.tenantBinding as TenantCredentialBinding).tenantId = "tenant-b";
    release();
    const context = (await pending)!;
    expect((await tenantAccess(context)).binding.tenantId).toBe("tenant-a");
  });
  it("fails closed when preview is disabled while resolving", async () => {
    const f = fixture();
    f.registry.resolve = async () => { f.enable(false); return f.bindings.get("issuer-a:alice")!; };
    await expect(f.runtime.authenticateBearer("fixture-A")).rejects.toThrow();
  });
});

it("denies a fresh request after a durable registry generation changes", async () => {
  const f = await persistentFixture();
  try {
    const binding = (await f.store.registry.resolve(alice))!;
    const token = { expiresAt: alice.expiresAt, tenantBinding: { version: 1 as const, issuer: alice.issuer, subject: alice.subject,
      tenantId: binding.tenantId, principalId: binding.principalId, mappingRevision: binding.mappingRevision } };
    const runtime = createTenantRuntime({ registry: f.store.registry, storage: f.store.storage,
      verifyAccessToken: async raw => raw === "fixture-access" ? token : null, enabled: () => true });
    expect(await runtime.authenticateBearer("fixture-access")).toBeDefined();
    await f.store.administration.setBinding(alice, { ...binding, enabled: false }, 2);
    await expect(runtime.authenticateBearer("fixture-access")).rejects.toThrow();
    await f.store.administration.setBinding(alice, { ...binding, enabled: true }, 3);
    const freshRuntime = createTenantRuntime({ registry: f.store.registry, storage: f.store.storage,
      verifyAccessToken: async raw => raw === "fixture-access" ? token : null, enabled: () => true });
    await expect(freshRuntime.authenticateBearer("fixture-access")).rejects.toThrow();
  } finally { await f.cleanup(); }
});
