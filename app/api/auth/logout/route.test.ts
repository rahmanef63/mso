import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionActor: vi.fn(async () => null as string | null),
  invalidateDeviceSessions: vi.fn(async () => {}),
  audit: vi.fn(),
}));

vi.mock("@/lib/auth/require-session", () => ({
  SESSION_COOKIE: "session",
  getSessionActor: mocks.getSessionActor,
}));
vi.mock("@/lib/auth/device-store", () => ({
  invalidateDeviceSessions: mocks.invalidateDeviceSessions,
}));
vi.mock("@/lib/host/audit-api", () => ({
  audit: mocks.audit,
}));

import { POST } from "./route";

const post = (host = "mso.example.com") =>
  POST(new Request("https://mso.example.com/api/auth/logout", {
    method: "POST",
    headers: { host },
  }));

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.OS_SESSION_COOKIE_DOMAIN;
  mocks.getSessionActor.mockResolvedValue(null);
  mocks.invalidateDeviceSessions.mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.OS_SESSION_COOKIE_DOMAIN;
});

describe("POST /api/auth/logout — device session teardown and cookie clearing", () => {
  it("does not 500 when there was no session to begin with", async () => {
    mocks.getSessionActor.mockResolvedValue(null);
    const res = await post();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(mocks.invalidateDeviceSessions).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith({ action: "auth.logout", actor: null, ok: true });

    const cookies = res.headers.getSetCookie();
    expect(cookies.length).toBeGreaterThanOrEqual(1);
    const cleared = cookies.find((c) => c.startsWith("session="));
    expect(cleared).toBeDefined();
    expect(cleared).toContain("Max-Age=0");
  });

  it("invalidates device sessions when an authenticated session exists", async () => {
    mocks.getSessionActor.mockResolvedValue("device-abc-123");
    const res = await post();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(mocks.invalidateDeviceSessions).toHaveBeenCalledWith("device-abc-123");
    expect(mocks.audit).toHaveBeenCalledWith({ action: "auth.logout", actor: "device-abc-123", ok: true });

    const cookies = res.headers.getSetCookie();
    const cleared = cookies.find((c) => c.startsWith("session="));
    expect(cleared).toBeDefined();
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain("HttpOnly");
  });

  it("clears both domain and pre-existing host-only cookies when domain cookie is active", async () => {
    process.env.OS_SESSION_COOKIE_DOMAIN = "mso.example.com";
    mocks.getSessionActor.mockResolvedValue("device-xyz");

    const res = await post("mso.example.com");
    expect(res.status).toBe(200);

    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(2);

    const domainCookie = cookies.find((c) => c.includes("Domain=mso.example.com"));
    const hostOnlyCookie = cookies.find((c) => !c.toLowerCase().includes("domain="));

    expect(domainCookie).toBeDefined();
    expect(domainCookie).toContain("Max-Age=0");
    expect(hostOnlyCookie).toBeDefined();
    expect(hostOnlyCookie).toContain("Max-Age=0");
  });
});
