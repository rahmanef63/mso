import { afterEach, describe, expect, it, vi } from "vitest";
import {
  A2A_ALLOW_LOOPBACK_ENV,
  assertA2AUrl,
  resolveA2AEndpoint,
} from "./network";

afterEach(() => {
  vi.unstubAllEnvs();
});

const resolver =
  (answers: Array<{ address: string; family: number }>) => async () =>
    answers;

describe("A2A loopback-only default", () => {
  it("allows exact HTTP loopback by default", () => {
    expect(
      assertA2AUrl("http://127.0.0.1:4555/.well-known/agent-card.json").hostname,
    ).toBe("127.0.0.1");
  });

  it("supports an explicit kill switch", () => {
    vi.stubEnv(A2A_ALLOW_LOOPBACK_ENV, "0");
    expect(() =>
      assertA2AUrl("http://127.0.0.1:4555/.well-known/agent-card.json"),
    ).toThrow(/loopback HTTP is disabled/);
  });

  it.each([
    "http://127.0.0.1:4555/.well-known/agent-card.json",
    "http://[::1]:4555/.well-known/agent-card.json",
    "http://localhost:4555/.well-known/agent-card.json",
  ])("accepts exact loopback: %s", async (url) => {
    vi.stubEnv(A2A_ALLOW_LOOPBACK_ENV, "1");
    expect(assertA2AUrl(url).toString()).toBe(new URL(url).toString());
    const endpoint = await resolveA2AEndpoint(
      url,
      resolver([
        {
          address: url.includes("[::1]") ? "::1" : "127.0.0.1",
          family: url.includes("[::1]") ? 6 : 4,
        },
      ]),
    );
    expect(endpoint.loopback).toBe(true);
  });

  it.each([
    "http://10.0.0.1:4555/a2a/v1",
    "http://172.16.0.1:4555/a2a/v1",
    "http://172.31.255.254:4555/a2a/v1",
    "http://192.168.1.10:4555/a2a/v1",
    "http://169.254.169.254:4555/a2a/v1",
    "http://172.17.0.1:4555/a2a/v1",
    "http://0.0.0.0:4555/a2a/v1",
    "http://127.0.0.2:4555/a2a/v1",
  ])("still rejects non-exact-loopback HTTP destinations: %s", (url) => {
    vi.stubEnv(A2A_ALLOW_LOOPBACK_ENV, "1");
    expect(() => assertA2AUrl(url)).toThrow();
  });

  it("rejects localhost if resolution escapes exact loopback", async () => {
    vi.stubEnv(A2A_ALLOW_LOOPBACK_ENV, "1");
    await expect(
      resolveA2AEndpoint(
        "http://localhost:4555/a2a/v1",
        resolver([
          { address: "127.0.0.1", family: 4 },
          { address: "192.168.1.20", family: 4 },
        ]),
      ),
    ).rejects.toThrow(/resolved outside exact loopback/);
  });

  it("preserves public SSRF policy for hostnames resolving private", async () => {
    vi.stubEnv(A2A_ALLOW_LOOPBACK_ENV, "1");
    await expect(
      resolveA2AEndpoint(
        "https://peer.example/a2a/v1",
        resolver([{ address: "10.20.30.40", family: 4 }]),
      ),
    ).rejects.toThrow(/DNS resolved to a private/);
  });

  it.each([
    "https://127.0.0.1:4555/a2a/v1",
    "https://192.168.1.2:4555/a2a/v1",
    "http://peer.example/a2a/v1",
  ])(
    "does not relax previously blocked non-public/public-HTTP URLs: %s",
    (url) => {
      vi.stubEnv(A2A_ALLOW_LOOPBACK_ENV, "1");
      expect(() => assertA2AUrl(url)).toThrow();
    },
  );
});
