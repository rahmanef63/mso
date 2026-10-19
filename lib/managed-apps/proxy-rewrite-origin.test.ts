// The production request shape for an app host, and the Next 16 rewrite-origin rule.
//
// Traefik passes `Host: <app>.mso.example.com` through (passHostHeader) while
// `x-forwarded-proto: https` makes Next describe its OWN plain-HTTP listener with a
// synthetic `https://localhost:PORT` nextUrl. Next (verified on 16.3.8:
// resolve-routes getRelativeURL compares the rewrite origin against initUrl by exact
// equality) resolves the rewrite internally ONLY when the destination origin equals
// that nextUrl origin.
//
// The old code downgraded the loopback scheme to `http:` before building the target.
// The destination then had a different origin than initUrl, so Next classified the
// rewrite as external, self-hopped it over the network against the public Host, and
// middleware re-ran there as a NON-app host — stripping the managed-app marker and
// 404ing the proxy route. proxy.ts now builds the destination from nextUrl.origin.
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/lib/managed-apps/session", () => ({ gateManagedApp: vi.fn(async () => null) }));

const TEMPLATE = "{id}.mso.example.com";
const APP_HOST_HEADER = "x-os-managed-app-host";

async function loadProxy(template: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE", template);
  return (await import("../../proxy")).proxy;
}

/** As it reaches middleware behind a TLS-terminating proxy: Host is the app name and
 *  nextUrl is a synthetic https loopback derived from x-forwarded-proto. */
function proxyReq(
  host: string,
  path: string,
  init: { method?: string; headers?: HeadersInit; body?: string } = {},
): NextRequest {
  const headers = new Headers(init.headers);
  headers.set("host", host);
  headers.set("x-forwarded-proto", "https");
  return new NextRequest(`https://127.0.0.1:3000${path}`, { ...init, headers });
}

const rewriteOf = (res: Response) => res.headers.get("x-middleware-rewrite");
const stampedHost = (res: Response) =>
  res.headers.get(`x-middleware-request-${APP_HOST_HEADER}`);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the app-host rewrite keeps nextUrl's exact origin (Next 16)", () => {
  it("classifies the rewrite as same-origin instead of downgrading to http", async () => {
    const proxy = await loadProxy(TEMPLATE);
    const request = proxyReq("orca.mso.example.com", "/web-index.html?tab=1");
    // Guard the fixture: the whole point is a synthetic https loopback nextUrl.
    expect(request.nextUrl.origin).toBe("https://localhost:3000");
    const res = await proxy(request);
    const dest = new URL(rewriteOf(res)!);
    // Equal origin to initUrl is what makes Next resolve the rewrite internally;
    // the old `http://localhost:3000` differed and became an external self-hop.
    expect(dest.origin).toBe(request.nextUrl.origin);
    expect(dest.protocol).toBe("https:");
    expect(dest.pathname).toBe("/api/v1/managed-apps/orca/proxy/web-index.html");
    expect(dest.search).toBe("?tab=1");
  });

  it("still overwrites the client marker when the nextUrl host is loopback", async () => {
    const proxy = await loadProxy(TEMPLATE);
    const res = await proxy(
      proxyReq("orca.mso.example.com", "/", {
        headers: { [APP_HOST_HEADER]: "hermes" },
      }),
    );
    expect(stampedHost(res)).toBe("orca");
    expect(new URL(rewriteOf(res)!).origin).toBe("https://localhost:3000");
  });
});
