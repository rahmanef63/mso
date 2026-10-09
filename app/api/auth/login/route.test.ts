import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { clientIp } from "./route";

// clientIp() is the rate-limit key. Behind multi-hop proxies (Cloudflare →
// nginx → app), the LAST x-forwarded-for entry is the internal nginx — taking
// it would collapse every external client into a single bucket. The function
// honours OS_TRUSTED_PROXY_HOPS to pick the right hop.

function reqWith(headers: Record<string, string>): NextRequest {
  return {
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("OS_TRUSTED_PROXY_HOPS", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("clientIp — XFF trusted-proxy hops", () => {
  it("ignores forwarding headers unless proxy trust is explicitly configured", () => {
    expect(
      clientIp(reqWith({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" })),
    ).toBe("unknown");
  });

  it("OS_TRUSTED_PROXY_HOPS=2 → second from last", () => {
    vi.stubEnv("OS_TRUSTED_PROXY_HOPS", "2");
    expect(
      clientIp(reqWith({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" })),
    ).toBe("2.2.2.2");
  });

  it("OS_TRUSTED_PROXY_HOPS=3 → third from last", () => {
    vi.stubEnv("OS_TRUSTED_PROXY_HOPS", "3");
    expect(
      clientIp(reqWith({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" })),
    ).toBe("1.1.1.1");
  });

  it("rejects a chain shorter than the configured trusted hops", () => {
    vi.stubEnv("OS_TRUSTED_PROXY_HOPS", "9");
    expect(clientIp(reqWith({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe(
      "unknown",
    );
  });

  it("invalid env value fails closed", () => {
    vi.stubEnv("OS_TRUSTED_PROXY_HOPS", "not-a-number");
    expect(
      clientIp(reqWith({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" })),
    ).toBe("unknown");
  });

  it("does not trust x-real-ip or invent a loopback identity", () => {
    expect(clientIp(reqWith({ "x-real-ip": "5.5.5.5" }))).toBe("unknown");
    expect(clientIp(reqWith({}))).toBe("unknown");
  });

  it("rejects empty, non-IP, fractional or oversized proxy attribution", () => {
    vi.stubEnv("OS_TRUSTED_PROXY_HOPS", "1");
    expect(clientIp(reqWith({ "x-forwarded-for": "1.1.1.1,," }))).toBe(
      "unknown",
    );
    expect(clientIp(reqWith({ "x-forwarded-for": "attacker" }))).toBe("unknown");
    expect(clientIp(reqWith({ "x-forwarded-for": "1".repeat(4097) }))).toBe("unknown");
    vi.stubEnv("OS_TRUSTED_PROXY_HOPS", "1.5");
    expect(clientIp(reqWith({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("unknown");
  });
});

// The limiter itself, through the real route. Before this, the global counter
// incremented BEFORE the per-IP gate and unconditionally, so a single flooding IP
// burned the process-wide budget and locked every other caller out of the cockpit —
// unauthenticated, from the internet, for as long as the flood ran.
describe("login admission budgets", () => {
  const SECRET = "s".repeat(48);
  const PASSWORD = "correct-horse-battery";
  const device = "d".repeat(32);

  // Module-level counters, so every case needs a fresh graph.
  async function loadRoute() {
    vi.resetModules();
    vi.stubEnv("OS_SESSION_SECRET", SECRET);
    vi.stubEnv("OS_LOGIN_PASSWORD", PASSWORD);
    vi.stubEnv("NEXT_PUBLIC_OS_DEMO", "0");
    vi.stubEnv("OS_TRUSTED_PROXY_HOPS", "1");
    vi.doMock("@/lib/auth/device-store", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      currentSessionPolicy: async (scope: string) => ({ scope, epoch: "epoch-0000000000000000", changedAt: 1 }),
      isApproved: async () => false,
      recordPending: async () => {},
      touchApproved: async () => {},
    }));
    vi.doMock("@/lib/host/audit", () => ({ audit: () => {} }));
    return (await import("./route")).POST;
  }

  const post = (ip: string, password: string) => new NextRequest("https://mso.example/api/auth/login", {
    method: "POST", headers: {"x-forwarded-for": ip, "content-type": "application/json"},
    body: JSON.stringify({password, deviceId: device, deviceLabel: "test"}),
  });

  it("keeps serving a different IP after one IP exhausts its own budget", async () => {
    const POST = await loadRoute();
    // Flood from one address far past BOTH its per-IP allowance (5/min) and the
    // process-wide budget (30/min). Under the old ordering those 60 rejected
    // requests each still incremented the global counter, which is the lockout.
    for (let i = 0; i < 60; i++) await POST(post("10.0.0.1", "wrong"));
    const attacker = await POST(post("10.0.0.1", "wrong"));
    expect(attacker.status).toBe(429); // the flooder is still blocked

    // The owner, elsewhere, with the RIGHT password. 403 = device_pending, which
    // means the password was accepted — anything but 429 proves no lockout.
    const owner = await POST(post("203.0.113.9", PASSWORD));
    expect(owner.status).not.toBe(429);
    expect(owner.status).toBe(403);
  });

  it("exhausts the distributed budget before parsing or testing another password", async () => {
    const POST = await loadRoute();
    for (let ip = 0; ip < 6; ip++) {
      for (let i = 0; i < 5; i++) expect((await POST(post(`198.51.100.${ip}`, "wrong"))).status).toBe(401);
    }
    const request = post("203.0.113.7", PASSWORD);
    const reader = vi.spyOn(request.body!, "getReader");
    expect((await POST(request)).status).toBe(429);
    expect(reader).not.toHaveBeenCalled();
  });

  it("still blocks a single IP past its own allowance", async () => {
    const POST = await loadRoute();
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await POST(post("10.0.0.2", "wrong"))).status);
    expect(codes.slice(0, 5).every((c) => c === 401)).toBe(true); // 5 real attempts
    expect(codes.slice(5).every((c) => c === 429)).toBe(true); // then throttled
  });

  it("still enforces the process-wide cap on legitimate-looking traffic", async () => {
    const POST = await loadRoute();
    // 30/min global: spread across many IPs so no per-IP gate fires first.
    const codes: number[] = [];
    for (let i = 0; i < 40; i++) codes.push((await POST(post(`10.1.0.${i}`, "wrong"))).status);
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
  });
});
