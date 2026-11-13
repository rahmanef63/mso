// Framing policy, split from proxy.test.ts to keep both files under the max-lines
// limit. It is a security decision with two halves that must not drift apart:
// production must never be frameable, and a local dev server must be frameable by the
// preview panel that is showing it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/lib/managed-apps/session", () => ({ gateManagedApp: vi.fn(async () => null) }));

/** As it arrives from the local proxy: Host is the machine the developer opened. */
function req(host: string, path = "/"): NextRequest {
  const headers = new Headers();
  headers.set("host", host);
  return new NextRequest(`https://${host}${path}`, { headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

// The app is a private control plane: a public page must never frame it and clickjack
// exec/fs buttons. But a developer's local preview panel IS an iframe of this same
// server, so `frame-ancestors 'none'` there hides the app from the only person running
// it. These pin both halves, and the second half is why the relaxation is host-gated
// rather than NODE_ENV-gated alone: a dev server on a tunnel is still public.
describe("framing policy", () => {
  const framing = async (host: string, nodeEnv: string) => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", nodeEnv);
    const proxy = (await import("./proxy")).proxy;
    const res = await proxy(req(host, "/"));
    return { csp: res.headers.get("content-security-policy") ?? "", xfo: res.headers.get("x-frame-options") };
  };

  it("never frames a production deployment", async () => {
    const { csp } = await framing("mso.example.com", "production");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("frame-ancestors *");
  });

  // A tunnel is public even when the process says development.
  it("keeps 'none' for a non-loopback host in development", async () => {
    const { csp } = await framing("mso.example.com", "development");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("lets a local preview panel frame a loopback dev server", async () => {
    for (const host of ["localhost:3000", "127.0.0.1:3000"]) {
      const { csp } = await framing(host, "development");
      expect(csp).toContain("frame-ancestors *");
      expect(csp).not.toContain("frame-ancestors 'none'");
    }
  });

  // Narrow relaxation: framing only. Every other directive stays strict.
  it("keeps the rest of the CSP strict in development", async () => {
    const { csp } = await framing("localhost:3000", "development");
    for (const directive of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) {
      expect(csp).toContain(directive);
    }
  });

  it("still issues a fresh nonce per request", async () => {
    const nonceOf = (csp: string) => /'nonce-([^']+)'/.exec(csp)?.[1];
    const first = await framing("localhost:3000", "development");
    const second = await framing("localhost:3000", "development");
    expect(nonceOf(first.csp)).toBeTruthy();
    expect(nonceOf(first.csp)).not.toBe(nonceOf(second.csp));
  });
});
