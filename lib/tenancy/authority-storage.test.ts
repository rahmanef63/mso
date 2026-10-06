import { afterEach, describe, expect, it, vi } from "vitest";
import { tenantAccess, tenantPrincipal, type TenantContext } from "./authority";
import { readTenantMemory, readTenantValue } from "./storage";
import { tenantCapabilityPlan } from "./capability";
import { resolveMcpTenant } from "./runtime";
import { tenantFixture } from "./test-fixtures";

afterEach(() => vi.unstubAllEnvs());
describe("authenticated tenant authority", () => {
  it("separates named subjects independently of application identity", async () => {
    const f = tenantFixture();
    const a = await f.authority.authenticate(f.identity()), b = await f.authority.authenticate(f.identity("bob"));
    expect(await tenantPrincipal(a)).not.toBe(await tenantPrincipal(b));
    expect((await tenantAccess(a)).binding.tenantId).toBe("tenant-a");
  });
  it.each(["unknown", "../alice", "", "__proto__"])("rejects unmapped/invalid subject %s", async subject => {
    const f = tenantFixture();
    await expect(f.authority.authenticate(f.identity(subject))).rejects.toThrow();
  });
  it("rejects another issuer and expired identities", async () => {
    const f = tenantFixture();
    await expect(f.authority.authenticate({ ...f.identity(), issuer: "other" })).rejects.toThrow();
    await expect(f.authority.authenticate({ ...f.identity(), expiresAt: 1000 })).rejects.toThrow();
  });
  it("rejects forged and copied contexts", async () => {
    const f = tenantFixture(), context = await f.authority.authenticate(f.identity());
    expect(Object.isFrozen(context)).toBe(true);
    await expect(tenantAccess({ ...context })).rejects.toThrow();
    await expect(tenantAccess({ kind: "tenant-preview" } as TenantContext)).rejects.toThrow();
  });
  it.each(["tenantId", "principalId", "mappingRevision", "enabled", "tenantEnabled"] as const)("invalidates changed %s", async field => {
    const f = tenantFixture(), context = await f.authority.authenticate(f.identity());
    const patch = { tenantId: "tenant-b", principalId: "other", mappingRevision: 2, enabled: false, tenantEnabled: false };
    Object.assign(f.bindings.alice, { [field]: patch[field] });
    await expect(tenantAccess(context)).rejects.toThrow();
  });
  it.each([0, -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid mapping revision %s", async mappingRevision => {
    const f = tenantFixture(); f.bindings.alice.mappingRevision = mappingRevision;
    await expect(f.authority.authenticate(f.identity())).rejects.toThrow();
  });
});
describe("tenant-scoped storage", () => {
  it("derives address from opaque context without accepting tenant selectors", async () => {
    const f = tenantFixture(), context = await f.authority.authenticate(f.identity());
    expect(await readTenantValue(context, "memory", "USER.md")).toBe("tenant-a:USER.md");
    expect(f.reads).toEqual([{ tenantId: "tenant-a", principalId: "principal-a", mappingRevision: 1, collection: "memory", key: "USER.md" }]);
  });
  it.each(["tenantId", "principalId", "mappingRevision", "collection", "key"] as const)("refuses wrongly scoped adapter row: %s", async field => {
    const f = tenantFixture(), context = await f.authority.authenticate(f.identity());
    f.overrideRead(address => ({ ...address, value: "foreign", [field]: field === "mappingRevision" ? 2 : "foreign" }));
    await expect(readTenantValue(context, "memory", "USER.md")).rejects.toThrow("scope mismatch");
  });
  it("has no global/owner fallback for an absent record", async () => {
    const f = tenantFixture(), context = await f.authority.authenticate(f.identity());
    f.overrideRead(() => null);
    expect(await readTenantMemory(context)).toMatchObject({ user: "", memory: "" });
    expect(f.reads).toHaveLength(2);
  });
  it.each(["../USER.md", "/absolute", "", "x/y"])("rejects path-shaped storage key %s", async key => {
    const f = tenantFixture(), context = await f.authority.authenticate(f.identity());
    await expect(readTenantValue(context, "memory", key)).rejects.toThrow();
    expect(f.reads).toHaveLength(0);
  });
  it.each(["revoke", "expire"])("rechecks %s after storage awaits", async change => {
    const f = tenantFixture(), context = await f.authority.authenticate(f.identity());
    f.overrideRead(address => {
      if (change === "revoke") f.bindings.alice.enabled = false; else f.setNow(5000);
      return { ...address, value: "not-returned" };
    });
    await expect(readTenantValue(context, "memory", "USER.md")).rejects.toThrow();
  });
  it.each([42, "x".repeat(65537)])("rejects malformed or oversized memory", async value => {
    const f = tenantFixture(), context = await f.authority.authenticate(f.identity());
    f.overrideRead(address => ({ ...address, value }));
    await expect(readTenantMemory(context)).rejects.toThrow("invalid tenant memory");
  });
});
describe("disabled-by-default runtime", () => {
  it("leaves legacy unmarked tokens unchanged", async () => {
    vi.stubEnv("OS_TENANCY_MODE", "");
    await expect(resolveMcpTenant({ expiresAt: 0 })).resolves.toBeUndefined();
    await expect(tenantCapabilityPlan(undefined, "exec_run")).resolves.toBeNull();
  });
  it("never downgrades a tenant credential/context into owner legacy mode", async () => {
    vi.stubEnv("OS_TENANCY_MODE", "legacy");
    await expect(resolveMcpTenant({ tenantSubject: "alice", expiresAt: 5000 })).rejects.toThrow();
    const f = tenantFixture(), context = await f.authority.authenticate(f.identity());
    await expect(tenantCapabilityPlan(context, "agent_memory_read")).rejects.toThrow();
  });
  it("invalid mode fails closed", async () => {
    vi.stubEnv("OS_TENANCY_MODE", "typo");
    await expect(resolveMcpTenant({ expiresAt: 0 })).rejects.toThrow("invalid tenancy mode");
    await expect(tenantCapabilityPlan(undefined, "exec_run")).rejects.toThrow();
  });
  it("preview has no live subject minting or storage provisioning path", async () => {
    vi.stubEnv("OS_TENANCY_MODE", "tenant-preview");
    await expect(resolveMcpTenant({ expiresAt: Date.now() + 10000 })).rejects.toThrow("versioned tenant credential");
    await expect(resolveMcpTenant({ tenantSubject: "alice", expiresAt: Date.now() + 10000 })).rejects.toThrow("unversioned");
    await expect(resolveMcpTenant({ tenantBinding: { version: 1, issuer: "mso-local", subject: "alice",
      tenantId: "tenant-a", principalId: "principal-a", mappingRevision: 1 }, expiresAt: Date.now() + 10000 })).rejects.toThrow("not configured");
  });
});

describe("parallel tenant read lifecycle", () => {
  it("settles every started read before returning a sibling failure", async () => {
    const f = tenantFixture(), context = await f.authority.authenticate(f.identity());
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const read = f.storage.read.bind(f.storage);
    f.storage.read = async address => {
      if (address.key === "USER.md") throw new Error("synthetic read failure");
      await blocked;
      return read(address);
    };
    let settled = false;
    const pending = readTenantMemory(context);
    void pending.then(() => { settled = true; }, () => { settled = true; });
    await new Promise(resolve => setImmediate(resolve));
    try { expect(settled).toBe(false); } finally { release(); }
    await expect(pending).rejects.toThrow("synthetic read failure");
  });
});
