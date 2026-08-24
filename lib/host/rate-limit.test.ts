// Unit tests for the fixed-window in-memory rate limiter (lib/host/rate-limit.ts).
// Uses fake timers to exercise window expiry without sleeping.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimited, rateLimitedUntrusted } from "./rate-limit";

describe("rateLimited", () => {
  beforeEach(() => {
    // Pin time so each test starts in a fresh window.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows hits up to the burst limit", () => {
    const key = `burst-${Math.random()}`;
    expect(rateLimited(key, 3, 1000)).toBe(false); // 1
    expect(rateLimited(key, 3, 1000)).toBe(false); // 2
    expect(rateLimited(key, 3, 1000)).toBe(false); // 3
  });

  it("rejects when the burst is exceeded inside the window", () => {
    const key = `over-${Math.random()}`;
    rateLimited(key, 2, 1000);
    rateLimited(key, 2, 1000);
    expect(rateLimited(key, 2, 1000)).toBe(true); // 3rd hit blocked
    expect(rateLimited(key, 2, 1000)).toBe(true); // still blocked
  });

  it("allows again after the window expires", () => {
    const key = `expire-${Math.random()}`;
    expect(rateLimited(key, 1, 500)).toBe(false);
    expect(rateLimited(key, 1, 500)).toBe(true); // blocked inside window
    vi.advanceTimersByTime(501); // cross the resetAt boundary
    expect(rateLimited(key, 1, 500)).toBe(false); // window reset
  });

  it("isolates buckets per key (device A vs device B)", () => {
    const a = `dev-A-${Math.random()}`;
    const b = `dev-B-${Math.random()}`;
    // Fill A's bucket
    rateLimited(a, 2, 1000);
    rateLimited(a, 2, 1000);
    expect(rateLimited(a, 2, 1000)).toBe(true);
    // B is untouched and still has its full burst
    expect(rateLimited(b, 2, 1000)).toBe(false);
    expect(rateLimited(b, 2, 1000)).toBe(false);
    expect(rateLimited(b, 2, 1000)).toBe(true); // B fills independently
  });

  it("treats a separate global key as independent from per-device keys", () => {
    const dev = `dev-${Math.random()}`;
    const global = `global-${Math.random()}`;
    rateLimited(dev, 2, 1000);
    rateLimited(dev, 2, 1000);
    // Dev capped — but the global limiter is its own bucket.
    expect(rateLimited(dev, 2, 1000)).toBe(true);
    expect(rateLimited(global, 5, 1000)).toBe(false);
    expect(rateLimited(global, 5, 1000)).toBe(false);
  });

  it("isolates attacker-controlled pre-auth churn from privileged buckets", () => {
    const victim = `privileged-victim-${Math.random()}`;
    expect(rateLimited(victim, 1, 60_000)).toBe(false);
    expect(rateLimited(victim, 1, 60_000)).toBe(true);

    // More public keys than the table ceiling. The vulnerable implementation used
    // one Map and clear()ed it, silently restoring the victim's allowance.
    for (let i = 0; i < 4200; i++) {
      expect(rateLimitedUntrusted(`spoofed-ip-${Math.random()}-${i}`, 1, 60_000)).toBe(false);
    }
    expect(rateLimited(victim, 1, 60_000)).toBe(true);
  });

  it("evicts cold pre-auth keys instead of turning table pressure into a global 429", () => {
    for (let i = 0; i < 4200; i++) {
      expect(rateLimitedUntrusted(`public-churn-${Math.random()}-${i}`, 1, 60_000)).toBe(false);
    }
    expect(rateLimitedUntrusted(`fresh-public-${Math.random()}`, 1, 60_000)).toBe(false);
  });

  it("counts the call as a hit only when not blocked", () => {
    const key = `count-${Math.random()}`;
    rateLimited(key, 2, 1000); // 1
    rateLimited(key, 2, 1000); // 2
    // 1000 calls that ALL return true must not reset the bucket clock.
    for (let i = 0; i < 1000; i++) expect(rateLimited(key, 2, 1000)).toBe(true);
    // Still inside the window → next allowed call only after expiry.
    vi.advanceTimersByTime(1001);
    expect(rateLimited(key, 2, 1000)).toBe(false);
  });
});
