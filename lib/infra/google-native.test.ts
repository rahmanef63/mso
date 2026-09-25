import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const security = vi.hoisted(() => ({ role: "owner", epoch: "test-cookie-epoch-123456789" }));
vi.mock("@/lib/auth/device-store", () => ({ currentSessionPolicy: async () => ({ epoch: security.epoch }), getApprovedDevice: async () => ({ role: security.role }) }));
vi.mock("@/lib/auth/session-cookie", () => ({ configuredSessionCookieScope: () => "host" }));
let root: string;
let storage: typeof import("./connection-storage"), service: typeof import("./connection-service"), flow: typeof import("./google-oauth-flow"), native: typeof import("./google-native");
const selector = { user: "test-owner", connection: "search" };
const actor = () => ({ deviceId: "test-device", cookieScope: "host", cookieEpoch: security.epoch, sessionExpiresAt: Date.now() + 600000 });
const tokenResponse = () => ({ access_token: "TEST_ACCESS_NOT_REAL_123456", refresh_token: "TEST_REFRESH_NOT_REAL_123456", token_type: "Bearer", expires_in: 3600, scope: "openid email https://www.googleapis.com/auth/webmasters.readonly" });
const accountResponse = () => ({ sub: "test-user-123", email: "owner@example.test", email_verified: true });
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
async function begin() { const start = await flow.beginGoogleAuthorization("google-search-console", selector, actor()); return { ...start, state: new URL(start.authorizationUrl).searchParams.get("state")! }; }
async function authorize() {
  const start = await begin();
  vi.mocked(fetch).mockResolvedValueOnce(response(tokenResponse())).mockResolvedValueOnce(response(accountResponse()));
  await flow.completeGoogleAuthorization(start.state, start.binding, "TEST_CODE_NOT_REAL"); return start;
}
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "mso-google-test-"));
  vi.resetModules(); vi.stubEnv("OS_INFRA_STORE", path.join(root, "infra.json")); vi.stubEnv("OS_PUBLIC_ORIGIN", "https://mso.example.test");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("No real network in this test")));
  security.role = "owner"; security.epoch = "test-cookie-epoch-123456789";
  storage = await import("./connection-storage"); service = await import("./connection-service"); flow = await import("./google-oauth-flow"); native = await import("./google-native");
  await storage.mutateIntegrationState(d => {
    d.users[selector.user] = { id: selector.user, uid: "owner-uid", label: "Test owner", connections: {}, defaults: {} }; d.defaultUser = selector.user;
    const app = service.createConnectionIn(d, { user: selector.user, provider: "google-oauth-app", connection: "app", authMethod: "oauth-app" });
    app.values = { clientId: "123456789-test.apps.googleusercontent.com", clientSecret: "TEST_CLIENT_SECRET_NOT_REAL" };
    service.createConnectionIn(d, { user: selector.user, provider: "google-search-console", connection: "search", authMethod: "oauth2" }).values = { appConnection: "app" };
  });
});
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

describe("native Google lifecycle — isolated store, mocked Google", () => {
  it("rejects OAuth secrets at the public metadata boundary", async () => {
    for (const key of ["clientSecret", "client_secret", "access_token", "refresh_token", "code_verifier"])
      await expect(service.integrationQuery({ view: "catalog", [key]: "SYNTHETIC_ONLY" })).rejects.toThrow("secret_input_forbidden");
  });
  it("app configuration and bound metadata are not connected accounts", async () => {
    expect((await service.resolveIntegration("google-oauth-app", { ...selector, connection: "app" })).state).toBe("app-configured");
    expect((await service.resolveIntegration("google-search-console", selector)).state).toBe("authorization-required");
    expect((await native.nativeGoogleStatus("google-oauth-app", { ...selector, connection: "app" })).ok).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("pins state, browser binding, PKCE and exact redirect, with minimal service scope", async () => {
    const start = await begin(), url = new URL(start.authorizationUrl);
    expect(url.origin).toBe("https://accounts.google.com"); expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe("https://mso.example.test/api/integrations/google/callback");
    expect(url.searchParams.get("scope")).not.toContain("analytics");
    expect((await service.resolveIntegration("google-search-console", selector)).state).toBe("authorization-pending");
    expect(JSON.stringify(await service.integrationSnapshot())).not.toContain(start.state);
    await expect(flow.completeGoogleAuthorization(start.state, "x".repeat(43), "TEST_CODE")).rejects.toThrow("expired_or_invalid");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("consumes a successful code once and never exports runtime grants", async () => {
    const start = await authorize();
    const snapshot = await service.integrationSnapshot(); expect(snapshot.connections.find(c => c.provider === "google-search-console")?.state).toBe("authorized");
    expect(JSON.stringify(snapshot)).not.toMatch(/TEST_ACCESS|TEST_REFRESH|TEST_CLIENT_SECRET/);
    const { exportIntegrationData } = await import("./portable/data");
    const exported = JSON.stringify(await exportIntegrationData()); expect(exported).not.toMatch(/TEST_ACCESS|TEST_REFRESH|TEST_CLIENT_SECRET|googleOAuth|googlePending/);
    await expect(flow.completeGoogleAuthorization(start.state, start.binding, "TEST_CODE_AGAIN")).rejects.toThrow("expired_or_invalid");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("does not replace an account after a mismatched reconnect", async () => {
    await authorize(); const next = await begin();
    vi.mocked(fetch).mockResolvedValueOnce(response(tokenResponse())).mockResolvedValueOnce(response({ ...accountResponse(), sub: "another-user" }));
    await expect(flow.completeGoogleAuthorization(next.state, next.binding, "TEST_CODE_2")).rejects.toThrow("account_changed_disconnect_first");
    expect((await service.resolveIntegration("google-search-console", selector)).google?.account?.email).toBe("owner@example.test");
  });
  it.each(["expired", "rotated-app", "role-revoked", "epoch-revoked"])("rejects a %s flow before token exchange", async kind => {
    const start = await begin();
    if (kind === "expired") await storage.mutateIntegrationState(d => { d.users[selector.user].connections["google-search-console"].search.googlePending!.expiresAt = 1; });
    if (kind === "rotated-app") await storage.mutateIntegrationState(d => { d.users[selector.user].connections["google-oauth-app"].app.revision++; });
    if (kind === "role-revoked") security.role = "operator";
    if (kind === "epoch-revoked") security.epoch = "another-cookie-epoch-123456";
    await expect(flow.completeGoogleAuthorization(start.state, start.binding, "TEST_CODE")).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
  it("denial consumes the authorization without losing an older grant", async () => {
    await authorize(); const next = await begin();
    await expect(flow.completeGoogleAuthorization(next.state, next.binding, undefined, true)).rejects.toThrow("consent_denied");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await service.resolveIntegration("google-search-console", selector)).state).toBe("authorized");
  });
  it("refreshes expired access and only marks verified after an actual API response", async () => {
    await authorize(); await storage.mutateIntegrationState(d => { d.users[selector.user].connections["google-search-console"].search.googleOAuth!.expiresAt = 1; });
    vi.mocked(fetch).mockResolvedValueOnce(response({ ...tokenResponse(), refresh_token: undefined, scope: undefined })).mockResolvedValueOnce(response({ siteEntry: [] }));
    expect((await native.verifyNativeGoogle("google-search-console", selector)).ok).toBe(true);
    expect((await service.resolveIntegration("google-search-console", selector)).state).toBe("verified");
    expect(String(vi.mocked(fetch).mock.calls[2][1]?.body)).toContain("grant_type=refresh_token");
  });
  it("invalid_grant creates an actionable reconnect state without exposing the provider response", async () => {
    await authorize(); await storage.mutateIntegrationState(d => { d.users[selector.user].connections["google-search-console"].search.googleOAuth!.expiresAt = 1; });
    vi.mocked(fetch).mockResolvedValueOnce(response({ error: "invalid_grant", error_description: "TEST_REFRESH_NOT_REAL_123456" }, 400));
    const result = await native.verifyNativeGoogle("google-search-console", selector); expect(result.ok).toBe(false); expect(result.detail).toBe("google_reauthorization_required");
    expect((await service.resolveIntegration("google-search-console", selector)).state).toBe("reauthorization-required");
  });
  it.each([403, 503])("does not keep a stale green status after verification HTTP %s", async status => {
    await authorize(); vi.mocked(fetch).mockResolvedValueOnce(response({ siteEntry: [] }));
    expect((await native.verifyNativeGoogle("google-search-console", selector)).ok).toBe(true);
    vi.mocked(fetch).mockResolvedValueOnce(response({ error: "synthetic_failure" }, status));
    expect((await native.verifyNativeGoogle("google-search-console", selector)).ok).toBe(false);
    expect((await service.resolveIntegration("google-search-console", selector)).state).toBe(status === 403 ? "invalid" : "unavailable");
    expect((await storage.readIntegrationState()).users[selector.user].connections["google-search-console"].search.googleOAuth?.state).toBe("connected");
  });
  it("local disconnect is explicit and does not claim provider revocation", async () => {
    await authorize(); const result = await native.disconnectGoogle("google-search-console", selector);
    expect(result).toMatchObject({ disconnectedLocally: true, providerRevoked: false });
    await expect(native.runNativeGoogle("google-search-console", selector, "google.searchConsole.sites.list", {})).rejects.toThrow("reauthorization_required");
  });
  it("copied identities do not carry user authorization; sharing is refused", async () => {
    await authorize(); const { integrationManage } = await import("./connection-manage");
    await integrationManage({ action: "user.duplicate", user: selector.user, target: "other-owner", copyCredentials: true, confirm: true });
    expect((await storage.readIntegrationState()).users["other-owner"].connections["google-search-console"].search.googleOAuth).toBeUndefined();
    await expect(integrationManage({ action: "connection.share", ...selector, provider: "google-search-console", target: "other-owner", confirm: true })).rejects.toThrow("google_shared_authorization_not_supported");
  });
  it("saving app setup is configuration-only and requires no fabricated live credential probe", async () => {
    const setup = await import("./setup-capability");
    const opened = await setup.openIntegrationSetup("google-oauth-app", "test-operator", "oauth-app", { ...selector, connection: "app" });
    expect(opened.setup.redirectUri).toBe("https://mso.example.test/api/integrations/google/callback");
    const saved = await setup.consumeIntegrationSetup(opened.token, { clientId: "987654321-test.apps.googleusercontent.com" });
    expect(saved).toMatchObject({ verified: false, configurationOnly: true }); expect(fetch).not.toHaveBeenCalled();
    await expect(setup.openIntegrationSetup("google-search-console", "test-operator", "oauth2", selector)).rejects.toThrow("google_use_native_authorization");
  });
});
