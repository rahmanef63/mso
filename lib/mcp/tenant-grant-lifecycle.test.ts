import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTenantRuntime } from "@/lib/tenancy/runtime-factory";
import type { TenantBinding, TenantCredentialBinding } from "@/lib/tenancy/types";

const injected = vi.hoisted(() => ({ runtime: null as ReturnType<typeof createTenantRuntime> | null }));
vi.mock("@/lib/tenancy/runtime", () => ({
  authorizeMcpTenantGrant: async (record: Parameters<ReturnType<typeof createTenantRuntime>["resolveValidatedToken"]>[0]) => {
    await injected.runtime!.resolveValidatedToken(record);
  },
}));
const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-tenant-grants-"));
const previous = process.env.OS_MCP_STORE;
process.env.OS_MCP_STORE = root + "/synthetic-mcp.json";
const store = await import("./store");
const { sha256hex } = await import("./pkce");
const stamp: TenantCredentialBinding = { version: 1, issuer: "fixture", subject: "alice", tenantId: "tenant-a", principalId: "person-a", mappingRevision: 1 };
let enabled = true;
let binding: TenantBinding;
const issue = (tenantBinding: TenantCredentialBinding | undefined = stamp) => store.storeOAuthGrant({
  accessToken: "fixture-access", refreshToken: "fixture-refresh", label: "synthetic only", clientId: "fixture-client", scope: "read",
  resource: "https://fixture.invalid/mcp", grantId: "fixture-grant", tenantBinding,
});
const rotate = (oldRefreshToken = "fixture-refresh", suffix = "two") => store.rotateOAuthGrant({
  oldRefreshToken, accessToken: "fixture-access-" + suffix, refreshToken: "fixture-refresh-" + suffix, label: "synthetic",
  clientId: "fixture-client", resource: "https://fixture.invalid/mcp",
});
beforeEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root, { mode: 0o700 });
  enabled = true;
  binding = { tenantId: "tenant-a", principalId: "person-a", mappingRevision: 1, enabled: true, tenantEnabled: true };
  injected.runtime = createTenantRuntime({ enabled: () => enabled, registry: {
    resolve: async identity => identity.issuer === "fixture" && identity.subject === "alice" ? { ...binding } : null,
  }, storage: { read: async () => null }, verifyAccessToken: bearer => store.validateToken(bearer) });
});
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
  if (previous === undefined) delete process.env.OS_MCP_STORE; else process.env.OS_MCP_STORE = previous;
});
describe("actual OAuth store with synthetic tenant grants", () => {
  it("preserves exact binding through code exchange and repeated rotation", async () => {
    await store.storeCode("fixture-code", { clientId: "fixture-client", redirectUri: "https://fixture.invalid/cb",
      codeChallenge: "synthetic", scope: "read", expiresAt: Date.now() + 60000, tenantBinding: stamp });
    expect((await store.consumeCode("fixture-code"))?.tenantBinding).toEqual(stamp);
    expect(await store.consumeCode("fixture-code")).toBeNull();
    await issue();
    expect((await store.validateToken("fixture-access"))?.tenantBinding).toEqual(stamp);
    expect((await rotate())?.tenantBinding).toEqual(stamp);
    expect((await store.validateToken("fixture-access-two"))?.tenantBinding).toEqual(stamp);
    expect((await rotate("fixture-refresh-two", "three"))?.tenantBinding).toEqual(stamp);
    const disk = JSON.parse(await fs.readFile(root + "/synthetic-mcp.json", "utf8"));
    expect(disk.refreshTokens[sha256hex("fixture-refresh-three")].tenantBinding).toEqual(stamp);
    expect(await fs.readFile(root + "/synthetic-mcp.json", "utf8")).not.toContain("fixture-access-three");
  });
  it.each(["tenantId", "principalId", "mappingRevision", "enabled", "tenantEnabled"] as const)("refuses rotation after %s changes without replacement writes", async field => {
    await issue();
    Object.assign(binding, { [field]: field === "mappingRevision" ? 2 : field.endsWith("Enabled") || field === "enabled" ? false : "different" });
    expect(await rotate()).toBeNull();
    expect(await store.validateToken("fixture-access-two")).toBeNull();
    const disk = JSON.parse(await fs.readFile(root + "/synthetic-mcp.json", "utf8"));
    expect(disk.refreshTokens[sha256hex("fixture-refresh")]).toBeDefined();
    expect(disk.refreshTokens[sha256hex("fixture-refresh-two")]).toBeUndefined();
  });
  it("rechecks the pinned generation on each actual stored access-token request", async () => {
    await issue();
    expect(await injected.runtime!.authenticateBearer("fixture-access")).toBeDefined();
    binding.mappingRevision = 2;
    await expect(injected.runtime!.authenticateBearer("fixture-access")).rejects.toThrow();
  });
  it("copies a caller-supplied stamp before asynchronous store mutation", async () => {
    const source = { ...stamp };
    const pending = issue(source);
    source.tenantId = "changed-after-call";
    await pending;
    expect((await store.validateToken("fixture-access"))?.tenantBinding).toEqual(stamp);
  });
  it("refuses code exchange after a binding generation changes", async () => {
    await store.storeCode("fixture-code", { clientId: "fixture-client", redirectUri: "https://fixture.invalid/cb",
      codeChallenge: "synthetic", scope: "read", expiresAt: Date.now() + 60000, tenantBinding: stamp });
    binding.mappingRevision = 2;
    expect(await store.consumeCode("fixture-code")).toBeNull();
  });
  it("does not upgrade old credentials after disable and re-enable", async () => {
    await issue(); binding.enabled = false; binding.mappingRevision = 2;
    expect(await rotate()).toBeNull();
    binding.enabled = true; binding.mappingRevision = 3;
    expect(await rotate()).toBeNull();
  });
  it.each(["rotate-first", "revoke-first"])("preserves family revocation when rotation races: %s", async order => {
    await issue();
    const id = (await store.listTokens())[0].id;
    await Promise.all(order === "rotate-first" ? [rotate(), store.revokeToken(id)] : [store.revokeToken(id), rotate()]);
    expect(await store.validateToken("fixture-access")).toBeNull();
    expect(await store.validateToken("fixture-access-two")).toBeNull();
    expect(await rotate("fixture-refresh-two", "three")).toBeNull();
  });
  it("rotates a refresh credential at most once under concurrent calls", async () => {
    await issue();
    const results = await Promise.all([rotate("fixture-refresh", "one"), rotate("fixture-refresh", "two")]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const replacements = await Promise.all(["fixture-access-one", "fixture-access-two"].map(store.validateToken));
    expect(replacements.filter(Boolean)).toHaveLength(0); // replay revokes the winning grant family
  });
  it("never acquires a tenant marker added after an unbound queued call", async () => {
    enabled = false;
    const source = { label: "synthetic", clientId: "fixture-client", scope: "read" as const,
      tenantBinding: undefined as TenantCredentialBinding | undefined };
    const pending = store.storeToken("fixture-unbound", source);
    source.tenantBinding = stamp;
    await pending;
    expect(await store.validateToken("fixture-unbound")).not.toHaveProperty("tenantBinding");
    const code = { clientId: "fixture-client", redirectUri: "https://fixture.invalid/cb", codeChallenge: "fake",
      scope: "read" as const, expiresAt: Date.now() + 60000, tenantBinding: undefined as TenantCredentialBinding | undefined };
    const pendingCode = store.storeCode("fixture-unbound-code", code);
    code.tenantBinding = stamp;
    await pendingCode;
    expect(await store.consumeCode("fixture-unbound-code")).not.toHaveProperty("tenantBinding");
  });
  it("allows revocation even when the binding is stale or tenant mode is off", async () => {
    await issue(); binding.mappingRevision = 2; enabled = false;
    expect(await store.revokeToken((await store.listTokens())[0].id)).toBe(true);
    expect(await rotate()).toBeNull();
  });
  it("never downgrades tenant records into owner credentials when mode is off", async () => {
    await issue(); enabled = false;
    expect(await rotate()).toBeNull();
    await expect(issue()).rejects.toThrow();
  });
  it("unbound legacy grants work only in legacy mode", async () => {
    await expect(store.storeOAuthGrant({ accessToken: "fixture-u", refreshToken: "fixture-ur", label: "synthetic",
      clientId: "fixture-client", scope: "read", resource: "https://fixture.invalid/mcp", grantId: "fixture-u" })).rejects.toThrow();
    enabled = false;
    await store.storeOAuthGrant({ accessToken: "fixture-u", refreshToken: "fixture-ur", label: "synthetic",
      clientId: "fixture-client", scope: "read", resource: "https://fixture.invalid/mcp", grantId: "fixture-u" });
    expect(await store.validateToken("fixture-u")).not.toBeNull();
    enabled = true;
    expect(await rotate("fixture-ur")).toBeNull();
  });
  it.each([{ tenantSubject: "alice" }, { tenantBinding: null }, { tenantBinding: { ...stamp, version: 9 } }])("refuses malformed persisted markers %j before rotation", async bad => {
    await issue(); enabled = false;
    const file = root + "/synthetic-mcp.json", disk = JSON.parse(await fs.readFile(file, "utf8"));
    Object.assign(disk.refreshTokens[sha256hex("fixture-refresh")], bad);
    await fs.writeFile(file, JSON.stringify(disk));
    expect(await rotate()).toBeNull();
    expect(await store.validateToken("fixture-access-two")).toBeNull();
  });
});
