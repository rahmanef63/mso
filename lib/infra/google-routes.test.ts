import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ context: vi.fn(), begin: vi.fn(), complete: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionContext: mocks.context }));
vi.mock("@/lib/infra/google-oauth-flow", () => ({ beginGoogleAuthorization: mocks.begin, completeGoogleAuthorization: mocks.complete, googleFlowCookie: () => "__Host-mso-google-test" }));
vi.mock("@/lib/host/audit-api", () => ({ audit: mocks.audit }));
import { POST } from "@/app/api/integrations/google/start/route";
import { GET } from "@/app/api/integrations/google/callback/route";
const origin = "https://mso.example.test";
const actor = { role: "owner", session: { device_id: "test-device", cookie_scope: "host", cookie_epoch: "test-epoch-123456789", expires_at: 9999999999999 } };
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("OS_PUBLIC_ORIGIN", origin);
  mocks.context.mockResolvedValue(actor);
  mocks.begin.mockResolvedValue({ authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=TEST", cookieName: "__Host-mso-google-test", binding: "b".repeat(43), expiresIn: 600 });
  mocks.complete.mockResolvedValue({ status: "authorized" }); mocks.audit.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());
const request = (body: unknown = { user: "test-owner", provider: "google-search-console", connection: "search" }, headers: Record<string, string> = {}) => new NextRequest(origin + "/api/integrations/google/start", { method: "POST", headers: { host: "mso.example.test", origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const callback = (query: string, cookie = "__Host-mso-google-test=" + "b".repeat(43)) => new NextRequest(origin + "/api/integrations/google/callback?" + query, { headers: { host: "mso.example.test", cookie } });
describe("native OAuth HTTP boundary", () => {
  it.each([null, { ...actor, role: "operator" }, { ...actor, role: "viewer" }])("denies non-owner start %j", async context => {
    mocks.context.mockResolvedValue(context); expect((await POST(request())).status).toBe(403); expect(mocks.begin).not.toHaveBeenCalled();
  });
  it("requires the configured native origin, not untrusted forwarded hosts", async () => {
    expect((await POST(request(undefined, { origin: "https://evil.test", "x-forwarded-host": "mso.example.test" }))).status).toBe(403);
    expect((await POST(request(undefined, { host: "evil.test" }))).status).toBe(403); expect(mocks.begin).not.toHaveBeenCalled();
  });
  it("sets a host-only finite HttpOnly/Secure/Lax binding without changing the main session cookie", async () => {
    const result = await POST(request()), cookie = result.headers.get("set-cookie")!;
    expect(result.status).toBe(200); expect(cookie).toContain("__Host-mso-google-test=");
    for (const attr of ["HttpOnly", "Secure", "SameSite=lax", "Max-Age=600", "Path=/"]) expect(cookie).toContain(attr);
    expect(cookie).not.toContain("Domain="); expect(cookie).not.toContain("session=");
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("state=");
  });
  it("refuses secret-bearing start input instead of accepting a copied browser session", async () => {
    const result = await POST(request({ user: "test-owner", provider: "google-search-console", connection: "search", accessToken: "NOT_REAL" }));
    expect(result.status).toBe(400); expect(mocks.begin).not.toHaveBeenCalled();
  });
  it("redirects a completed callback to a clean, fixed native URL", async () => {
    const state = "s".repeat(43), result = await GET(callback("state=" + state + "&code=TEST_CODE&returnTo=https://evil.test"));
    expect(result.status).toBe(303); expect(result.headers.get("location")).toBe(origin + "/integrations?google=authorized");
    expect(result.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(result.headers.get("referrer-policy")).toBe("no-referrer");
    expect(JSON.stringify([...result.headers])).not.toContain("TEST_CODE");
  });
  it.each(["state=short&code=TEST", "state=" + "s".repeat(43) + "&state=other&code=TEST", "state=" + "s".repeat(43) + "&code=A&code=B", "state=" + "s".repeat(43) + "&code=A&error=denied", "state=" + "s".repeat(43) + "&iss=https://evil.test&code=A"])("rejects malformed callback parameters without reflecting them", async query => {
    const result = await GET(callback(query)); expect(result.headers.get("location")).toBe(origin + "/integrations?google=retry"); expect(mocks.complete).not.toHaveBeenCalled();
  });
  it("refuses missing or duplicate browser bindings", async () => {
    const query = "state=" + "s".repeat(43) + "&code=TEST";
    await GET(callback(query, "")); expect(mocks.complete).not.toHaveBeenCalled();
  });
  it("does not expose raw failures or user codes in redirects", async () => {
    mocks.complete.mockRejectedValue(new Error("PRIVATE_TOKEN_FROM_UPSTREAM"));
    const result = await GET(callback("state=" + "s".repeat(43) + "&code=PRIVATE_CODE"));
    expect(result.headers.get("location")).toBe(origin + "/integrations?google=retry"); expect(await result.text()).not.toContain("PRIVATE");
  });
});
