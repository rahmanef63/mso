import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/host/audit-api", () => ({ audit: vi.fn() }));
let root: string;
const KEY = "opaque_synthetic_composio_test_key";
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-setup-test-"));
  process.env.OS_INFRA_STORE = path.join(root, "infra.json");
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
});
afterEach(async () => { vi.unstubAllGlobals(); delete process.env.OS_INFRA_STORE; await fs.rm(root, { recursive: true, force: true }); vi.resetModules(); });
describe("native integration setup capabilities", () => {
  it("binds a hashed, owner-only, expiring grant to a provider/method", async () => {
    const api = await import("./setup-capability");
    const grant = await api.openIntegrationSetup("composio", "test-owner", "project");
    expect(grant.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const file = path.join(root, "integration-setup", createHash("sha256").update(grant.token).digest("hex") + ".json");
    const handle = await fs.open(file, "r");
    try {
      expect((await handle.stat()).mode & 0o777).toBe(0o600);
      const stored = await handle.readFile("utf8"); expect(stored).not.toContain(grant.token); expect(stored).toContain("test-owner");
    } finally { await handle.close(); }
    expect(grant.setup.fields.map(f => f.key)).toEqual(["apiKey"]);
    expect(grant.setup.expiresAt - Date.now()).toBeLessThanOrEqual(600000);
    await expect(api.consumeIntegrationSetup(grant.token, { orgApiKey: KEY })).rejects.toMatchObject({ code: "invalid_fields" });
    await expect(api.openIntegrationSetup("composio", "", "project")).rejects.toMatchObject({ status: 403 });
  });
  it("verifies candidates before saving and returns no secrets", async () => {
    const api = await import("./setup-capability"), store = await import("./store");
    const grant = await api.openIntegrationSetup("composio", "test-owner");
    const output = await api.consumeIntegrationSetup(grant.token, { apiKey: ` ${KEY} ` });
    expect(output.verified).toBe(true); expect(JSON.stringify(output)).not.toContain(KEY);
    expect((await store.readInfraProvider("composio")).apiKey).toBe(KEY);
    expect(JSON.stringify(store.summarizeInfraProvider("composio", await store.readInfraProvider("composio")))).not.toContain(KEY);
    await expect(api.consumeIntegrationSetup(grant.token, { apiKey: KEY })).rejects.toMatchObject({ status: 401 });
  });
  it("failed probes cannot replace existing keys; a session permits bounded retries", async () => {
    const api = await import("./setup-capability"), store = await import("./store");
    await store.setInfraProvider("composio", { apiKey: "original_synthetic_key_keep_me" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(KEY, { status: 403 })));
    const grant = await api.openIntegrationSetup("composio", "test-owner");
    for (let i = 0; i < 5; i++) await expect(api.consumeIntegrationSetup(grant.token, { apiKey: KEY })).rejects.toMatchObject({ code: "credential_validation_failed" });
    await expect(api.consumeIntegrationSetup(grant.token, { apiKey: KEY })).rejects.toMatchObject({ status: 401 });
    expect((await store.readInfraProvider("composio")).apiKey).toBe("original_synthetic_key_keep_me");
    expect(JSON.stringify(grant.setup)).not.toContain("original_synthetic_key_keep_me");
  });
  it("expired grants and concurrent replays fail closed", async () => {
    const api = await import("./setup-capability");
    const expired = await api.openIntegrationSetup("composio", "test-owner");
    const file = path.join(root, "integration-setup", createHash("sha256").update(expired.token).digest("hex") + ".json");
    const row = JSON.parse(await fs.readFile(file, "utf8")); row.expiresAt = Date.now() - 1; await fs.writeFile(file, JSON.stringify(row));
    await expect(api.describeIntegrationSetup(expired.token)).rejects.toMatchObject({ status: 401 });
    const grant = await api.openIntegrationSetup("composio", "test-owner");
    const results = await Promise.allSettled([api.consumeIntegrationSetup(grant.token, { apiKey: KEY }), api.consumeIntegrationSetup(grant.token, { apiKey: KEY })]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  });
  it("organization keys use the correct header and are masked in summaries", async () => {
    const api = await import("./setup-capability"), store = await import("./store");
    const grant = await api.openIntegrationSetup("composio", "test-owner", "organization");
    await api.consumeIntegrationSetup(grant.token, { orgApiKey: KEY });
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("/api/v3.1/org/owner/project/list"); expect(options?.headers).toEqual({ "x-org-api-key": KEY });
    expect(store.summarizeInfraProvider("composio", await store.readInfraProvider("composio")).values.orgApiKey).toBe("configured");
  });
  it("standalone page contains no grant and its inline script parses", async () => {
    const { integrationSetupPage } = await import("./setup-page");
    const result = integrationSetupPage(); expect(result.csp).toContain("frame-ancestors 'none'");
    const script = result.html.match(/<script nonce="[^"]+">([\s\S]+)<\/script>/)?.[1];
    expect(script).toBeTruthy(); expect(() => new Function(script!)).not.toThrow();
    expect(result.html).not.toContain(KEY); expect(result.html).not.toContain("si-coder");
  });
});
