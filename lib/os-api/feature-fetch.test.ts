import { afterEach, describe, expect, it, vi } from "vitest";
import { featureFetch, FeatureFetchError } from "./feature-fetch";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("featureFetch", () => {
  it("returns parsed JSON payload with cache no-store", async () => {
    const spy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", spy);
    const data = await featureFetch<{ ok: boolean }>("/api/v1/example");
    expect(data).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledWith("/api/v1/example", expect.objectContaining({ cache: "no-store" }));
  });

  it("serializes JSON body and sets content-type header", async () => {
    const spy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ saved: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", spy);
    await featureFetch("/api/v1/example", { method: "POST", body: { name: "test" } });
    const [, init] = spy.mock.calls[0];
    expect(init.body).toBe('{"name":"test"}');
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("classifies 401 and 403 as auth errors with explicit messages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    await expect(featureFetch("/api/v1/private", { unauthorizedMessage: "Sign in first" }))
      .rejects.toMatchObject({ name: "FeatureFetchError", status: 401, isAuthError: true, message: "Sign in first" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 403 })));
    await expect(featureFetch("/api/v1/owner"))
      .rejects.toBeInstanceOf(FeatureFetchError);
  });

  it("surfaces server JSON error payloads for non-2xx responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "rate_limited", message: "Too many calls" }), { status: 429 }),
    ));
    await expect(featureFetch("/api/v1/example")).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
      message: "Too many calls",
      isAuthError: false,
    });
  });
});
