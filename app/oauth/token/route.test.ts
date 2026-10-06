import { TenantDenied } from "@/lib/tenancy/authority";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ consumeCode: vi.fn(), storeGrant: vi.fn(), rotate: vi.fn(), random: vi.fn(), verify: vi.fn(() => true), limited: vi.fn(() => false) }));
vi.mock("@/lib/mcp/store", () => ({ consumeCode: mocks.consumeCode, storeOAuthGrant: mocks.storeGrant, rotateOAuthGrant: mocks.rotate, OAUTH_ACCESS_TOKEN_TTL_MS: 3_600_000 }));
vi.mock("@/lib/mcp/pkce", () => ({ verifyPkce: mocks.verify, randomToken: mocks.random }));
vi.mock("@/lib/mcp/scope", () => ({ mcpEnabled: () => true, oauthScopeString: (scope: string, offline = false) => `${scope}${offline ? " offline_access" : ""}` }));
vi.mock("@/lib/mcp/origin", () => ({ clientIp: () => "127.0.0.1", publicOrigin: () => "https://mso.example.test" }));
vi.mock("@/lib/host/limits-api", () => ({ rateLimitedUntrusted: mocks.limited }));
const { POST } = await import("./route");
const post = (body: Record<string, string>) => new Request("https://mso.example.test/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });

describe("OAuth token endpoint", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.random.mockImplementation((prefix: string) => `${prefix}${mocks.random.mock.calls.length}`); mocks.verify.mockReturnValue(true); mocks.storeGrant.mockReset(); });

  it("exchanges an authorization code into resource-bound access + refresh credentials", async () => {
    mocks.consumeCode.mockResolvedValue({ clientId: "chatgpt", redirectUri: "https://chatgpt.com/cb", codeChallenge: "challenge", scope: "exec", resource: "https://mso.example.test/mcp", profile: "chatgpt", offlineAccess: true });
    const res = await POST(post({ grant_type: "authorization_code", code: "code", code_verifier: "v".repeat(43), client_id: "chatgpt", redirect_uri: "https://chatgpt.com/cb", resource: "https://mso.example.test/mcp" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "exec offline_access" });
    expect(body.access_token).toMatch(/^mso_mcp_/); expect(body.refresh_token).toMatch(/^mso_refresh_/);
    expect(mocks.storeGrant).toHaveBeenCalledWith(expect.objectContaining({ clientId: "chatgpt", resource: "https://mso.example.test/mcp", profile: "chatgpt", offlineAccess: true }));
  });

  it("rotates a refresh credential and rejects a wrong resource", async () => {
    mocks.rotate.mockResolvedValue({ clientId: "chatgpt", scope: "exec", resource: "https://mso.example.test/mcp", profile: "chatgpt", offlineAccess: true, grantId: "g" });
    const ok = await POST(post({ grant_type: "refresh_token", refresh_token: "r1", client_id: "chatgpt", resource: "https://mso.example.test/mcp" }));
    expect(ok.status).toBe(200); expect((await ok.json()).refresh_token).toMatch(/^mso_refresh_/);
    const bad = await POST(post({ grant_type: "refresh_token", refresh_token: "r1", client_id: "chatgpt", resource: "https://other.example/mcp" }));
    expect(bad.status).toBe(400); expect(await bad.json()).toMatchObject({ error: "invalid_target" });
  });
});

describe("tenant credential exchange projection", () => {
  const binding = { version: 1, issuer: "fixture", subject: "alice", tenantId: "tenant-a", principalId: "person-a", mappingRevision: 3 };
  const request = () => post({ grant_type: "authorization_code", code: "fixture-code", code_verifier: "v".repeat(43),
    client_id: "fixture-client", redirect_uri: "https://fixture.invalid/cb", tenantSubject: "attacker", tenantBinding: "forged" });
  beforeEach(() => {
    vi.clearAllMocks(); mocks.storeGrant.mockReset(); mocks.verify.mockReturnValue(true);
    mocks.random.mockImplementation((prefix: string) => prefix + "synthetic");
    mocks.consumeCode.mockResolvedValue({ clientId: "fixture-client", redirectUri: "https://fixture.invalid/cb",
      codeChallenge: "fake", scope: "read", tenantBinding: binding });
  });
  it("copies only the server-owned code binding and ignores request selectors", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(mocks.storeGrant).toHaveBeenCalledWith(expect.objectContaining({ tenantBinding: binding }));
    expect(mocks.storeGrant.mock.calls[0][0]).not.toHaveProperty("tenantSubject");
  });
  it("returns a sanitized denial when binding changes before grant storage", async () => {
    mocks.storeGrant.mockRejectedValue(new TenantDenied("private registry state"));
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_grant" });
  });
});
