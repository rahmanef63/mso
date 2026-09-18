import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
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
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("clientIp — XFF trusted-proxy hops", () => {
  it("1 hop (default) → last XFF entry", () => {
    expect(
      clientIp(reqWith({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" })),
    ).toBe("3.3.3.3");
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

  it("hops exceed chain length → clamps to leftmost", () => {
    vi.stubEnv("OS_TRUSTED_PROXY_HOPS", "9");
    expect(clientIp(reqWith({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe(
      "1.1.1.1",
    );
  });

  it("invalid env value falls back to 1", () => {
    vi.stubEnv("OS_TRUSTED_PROXY_HOPS", "not-a-number");
    expect(
      clientIp(reqWith({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" })),
    ).toBe("2.2.2.2");
  });

  it("no XFF → falls back to x-real-ip then loopback", () => {
    expect(clientIp(reqWith({ "x-real-ip": "5.5.5.5" }))).toBe("5.5.5.5");
    expect(clientIp(reqWith({}))).toBe("127.0.0.1");
  });

  it("ignores empty XFF entries from trailing commas", () => {
    expect(clientIp(reqWith({ "x-forwarded-for": "1.1.1.1,," }))).toBe(
      "1.1.1.1",
    );
  });
});

// The limiter itself, through the real route. Before this, the global counter
// incremented BEFORE the per-IP gate and unconditionally, so a single flooding IP
// burned the process-wide budget and locked every other caller out of the cockpit —
// unauthenticated, from the internet, for as long as the flood ran.
describe("rate limiting cannot be turned into a lockout of everyone else", () => {
  const SECRET = "s".repeat(48);
  const PASSWORD = "correct-horse-battery";
  const device = "d".repeat(32);

  // Module-level counters, so every case needs a fresh graph.
  async function loadRoute() {
    vi.resetModules();
    vi.stubEnv("OS_SESSION_SECRET", SECRET);
    vi.stubEnv("OS_LOGIN_PASSWORD", PASSWORD);
    vi.stubEnv("NEXT_PUBLIC_OS_DEMO", "0");
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

  const post = (ip: string, password: string) =>
    ({
      headers: { get: (k: string) => (k.toLowerCase() === "x-forwarded-for" ? ip : null) },
      json: async () => ({ password, deviceId: device, deviceLabel: "test" }),
    }) as unknown as NextRequest;

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

  it("keeps serving the owner after a DISTRIBUTED flood fills the process-wide budget", async () => {
    const POST = await loadRoute();
    // The variant the single-IP reorder did NOT fix: six fresh addresses, each
    // staying inside its own 5/min allowance, together spend the whole 30/min
    // process-wide budget. No per-IP gate ever fires, so under the old code every
    // one of those 30 charged the global counter and the owner's CORRECT password
    // from a seventh address came back 429 — an unauthenticated lockout of prod.
    for (let ip = 0; ip < 6; ip++) {
      for (let i = 0; i < 5; i++) await POST(post(`198.51.100.${ip}`, "wrong"));
    }
    const owner = await POST(post("203.0.113.7", PASSWORD));
    expect(owner.status).not.toBe(429);
    expect(owner.status).toBe(403); // device_pending = the password was accepted
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
