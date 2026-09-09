import { describe, expect, it, vi } from "vitest";
import { probeSession, resolveSessionProbe } from "./session-probe";

describe("resolveSessionProbe", () => {
  it("treats an explicit successful unauthenticated response as signed out", () => {
    expect(resolveSessionProbe(200, { authenticated: false, role: null })).toEqual({
      status: "out",
      role: null,
    });
  });

  it("treats authenticated responses as signed in and normalizes an invalid role", () => {
    expect(resolveSessionProbe(200, { authenticated: true, role: "owner" })).toEqual({
      status: "in",
      role: "owner",
    });
    expect(resolveSessionProbe(200, { authenticated: true, role: "bogus" })).toEqual({
      status: "in",
      role: "viewer",
    });
  });

  it.each([
    [502, { authenticated: false }],
    [503, { authenticated: true, role: "owner" }],
    [200, {}],
    [200, null],
  ])("returns indeterminate for non-authoritative probe %#", (status, body) => {
    expect(resolveSessionProbe(status, body)).toBeNull();
  });
});

describe("probeSession", () => {
  it("preserves the caller's current state by returning null on network failure", async () => {
    const fetcher = vi.fn(async () => { throw new Error("restart race"); }) as unknown as typeof fetch;
    expect(await probeSession(fetcher)).toBeNull();
  });

  it("uses no-store and same-origin credentials", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ authenticated: true, role: "operator" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
    await expect(probeSession(fetcher)).resolves.toEqual({ status: "in", role: "operator" });
    expect(fetcher).toHaveBeenCalledWith("/api/auth/me", { cache: "no-store", credentials: "same-origin" });
  });
});
