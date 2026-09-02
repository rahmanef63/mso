// What the browser actually receives from /api/auth/login and /api/auth/logout,
// in both cookie configurations. The Domain is the difference between the framed
// managed-app hosts being authenticated and 401-ing on every request, and a
// clear that misses the Domain is a logout that does not log out — so the wire
// bytes are asserted here, not just the helper's return value.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_SECRET_LEN } from "@/lib/auth/session";

vi.mock("@/lib/host/audit-api", () => ({ audit: vi.fn() }));
vi.mock("@/lib/auth/device-store", () => ({
  isValidDeviceId: (id: unknown) => typeof id === "string" && /^[a-f0-9-]{16,128}$/i.test(id),
  isApproved: async () => true,
  recordPending: async () => {},
  touchApproved: async () => {},
}));
// require-session itself stays REAL so the asserted cookie name is the shipped
// constant; only its next/headers dependency (needs a request scope) is stubbed.
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [] }) }));

const DEVICE = "a".repeat(32);
const PASSWORD = "correct-horse";

const loginReq = (host: string) =>
  new Request("http://internal/api/auth/login", {
    method: "POST",
    headers: { host, "content-type": "application/json" },
    body: JSON.stringify({ password: PASSWORD, deviceId: DEVICE, deviceLabel: "test" }),
  });

async function login(host = "mso.rahmanef.com"): Promise<string[]> {
  const { POST } = await import("./login/route");
  const res = await POST(loginReq(host) as never);
  expect(res.status).toBe(200);
  return res.headers.getSetCookie();
}

async function logout(host = "mso.rahmanef.com"): Promise<string[]> {
  const { POST } = await import("./logout/route");
  const res = await POST(new Request("http://internal/api/auth/logout", { method: "POST", headers: { host } }));
  return res.headers.getSetCookie();
}

beforeEach(() => {
  process.env.OS_SESSION_SECRET = "s".repeat(MIN_SECRET_LEN);
  process.env.OS_LOGIN_PASSWORD = PASSWORD;
  process.env.SESSION_EXPIRY_HOURS = "24";
  // The login limiter is module state; each rate window allows 5 per IP and this
  // suite stays well under it.
  vi.resetModules();
});

afterEach(() => {
  delete process.env.OS_SESSION_COOKIE_DOMAIN;
});

describe("session cookie on the wire — host-only (default)", () => {
  it("login sets no Domain", async () => {
    const [cookie, ...rest] = await login();
    expect(rest).toEqual([]);
    expect(cookie).toMatch(/^session=[\w-]+\.[\w-]+;/);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=86400");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie.toLowerCase()).toContain("samesite=strict");
    expect(cookie.toLowerCase()).not.toContain("domain=");
  });

  it("logout clears with exactly the same scope and no extra header", async () => {
    const cookies = await logout();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain("session=;");
    expect(cookies[0]).toContain("Max-Age=0");
    expect(cookies[0].toLowerCase()).not.toContain("domain=");
  });
});

describe("session cookie on the wire — OS_SESSION_COOKIE_DOMAIN set", () => {
  beforeEach(() => {
    process.env.OS_SESSION_COOKIE_DOMAIN = "mso.rahmanef.com";
  });

  it("login widens to the domain, keeping every other attribute", async () => {
    const [cookie] = await login();
    expect(cookie).toContain("Domain=mso.rahmanef.com");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie.toLowerCase()).toContain("samesite=strict");
  });

  it("logout clears BOTH the domain cookie and the pre-widening host-only one", async () => {
    const cookies = await logout();
    expect(cookies).toHaveLength(2);
    const withDomain = cookies.find((c) => c.includes("Domain=mso.rahmanef.com"));
    const hostOnly = cookies.find((c) => !c.toLowerCase().includes("domain="));
    expect(withDomain).toContain("Max-Age=0");
    expect(hostOnly).toContain("Max-Age=0");
    // Both must stay HttpOnly+Secure: a non-Secure clear is refused over https
    // by browsers that reject downgrades, leaving the cookie alive.
    for (const cookie of cookies) {
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("Secure");
    }
  });

  it("falls back to host-only when the request host is outside the domain", async () => {
    // Reaching the app directly on :4005 must not produce a Set-Cookie the
    // browser silently drops — that is a login that 200s with no session.
    const [cookie] = await login("127.0.0.1");
    expect(cookie.toLowerCase()).not.toContain("domain=");
    expect(await logout("127.0.0.1")).toHaveLength(1);
  });
});
