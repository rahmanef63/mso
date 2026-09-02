import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TEMPLATE = "{id}.mso.rahmanef.com";
const APP_HOST_HEADER = "x-os-managed-app-host";

async function loadProxy(template: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE", template);
  return (await import("./proxy")).proxy;
}

function req(
  host: string,
  path: string,
  init: { method?: string; headers?: HeadersInit; body?: string } = {},
): NextRequest {
  const headers = new Headers(init.headers);
  headers.set("host", host);
  return new NextRequest(`https://${host}${path}`, { ...init, headers });
}

const rewriteOf = (res: Response) => res.headers.get("x-middleware-rewrite");

afterEach(() => {
  vi.unstubAllEnvs();
});

// The session cookie is widened to Domain=mso.rahmanef.com, so ANY host under that
// name receives it. A host in the namespace that is not one of the apps must
// therefore 404 rather than serve the cockpit — otherwise adding a DNS record is
// enough to hand a page a fully authenticated cockpit, with no code change at all.
describe("an unclaimed host inside the app namespace serves nothing", () => {
  it.each([
    "staging.mso.rahmanef.com",
    "deep.sub.mso.rahmanef.com",
    "xhermes.mso.rahmanef.com",
  ])("404s %s", async (host) => {
    const proxy = await loadProxy(TEMPLATE);
    for (const path of [
      "/",
      "/api/v1/exec/run",
      "/api/auth/login",
      "/_next/static/chunks/main.js",
    ]) {
      const res = await proxy(req(host, path));
      expect(res.status).toBe(404);
      expect(rewriteOf(res)).toBeNull();
    }
  });

  it("refuses only the namespace: the cockpit, its siblings and single-origin mode all still serve", async () => {
    const split = await loadProxy(TEMPLATE);
    for (const host of [
      "mso.rahmanef.com",
      "api-mso.rahmanef.com",
      "rahmanef.com",
    ]) {
      expect((await split(req(host, "/files"))).status).toBe(200);
    }
    const single = await loadProxy("");
    expect(
      (await single(req("staging.mso.rahmanef.com", "/files"))).status,
    ).toBe(200);
  });
});

describe("single-origin mode (template unset) is unchanged", () => {
  it("stamps a nonce + document policy on a page", async () => {
    const proxy = await loadProxy("");
    const res = await proxy(req("mso.rahmanef.com", "/files"));
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(res.headers.get("x-middleware-request-x-nonce")).toBeTruthy();
  });

  it("waves through the paths the matcher used to exclude, with no policy", async () => {
    const proxy = await loadProxy("");
    for (const path of [
      "/_next/static/chunks/main.js",
      "/_next/image?url=%2Fx.png",
      "/favicon.ico",
    ]) {
      const res = await proxy(req("mso.rahmanef.com", path));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-security-policy")).toBeNull();
      expect(res.headers.get("x-middleware-request-x-nonce")).toBeNull();
    }
  });

  it("never treats an app-shaped host as an app host", async () => {
    const proxy = await loadProxy("");
    const res = await proxy(req("hermes.mso.rahmanef.com", "/"));
    expect(rewriteOf(res)).toBeNull();
  });

  it("still blocks a cross-site mutating /api and leaves reads alone", async () => {
    const proxy = await loadProxy("");
    const blocked = await proxy(
      req("mso.rahmanef.com", "/api/v1/exec/run", {
        method: "POST",
        headers: { "sec-fetch-site": "cross-site" },
      }),
    );
    expect(blocked.status).toBe(403);
    const read = await proxy(req("mso.rahmanef.com", "/api/v1/sys/status"));
    expect(read.status).toBe(200);
    expect(read.headers.get("content-security-policy")).toBeNull();
  });

  it("treats A2A discovery and protocol routes as machine surfaces, not documents", async () => {
    const proxy = await loadProxy("");
    for (const path of ["/.well-known/agent-card.json", "/a2a/v1"]) {
      const res = await proxy(req("mso.rahmanef.com", path));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-security-policy")).toBeNull();
      expect(res.headers.get("x-middleware-request-x-nonce")).toBeNull();
    }
  });

  it("lets remote bearer-authenticated A2A POST reach the route while keeping owner A2A management CSRF-protected", async () => {
    const proxy = await loadProxy("");
    const protocol = await proxy(
      req("mso.rahmanef.com", "/a2a/v1", {
        method: "POST",
        headers: { "sec-fetch-site": "cross-site" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "ListTasks",
          params: {},
        }),
      }),
    );
    expect(protocol.status).toBe(200);
    expect(protocol.headers.get("content-security-policy")).toBeNull();

    const management = await proxy(
      req("mso.rahmanef.com", "/api/v1/a2a", {
        method: "POST",
        headers: { "sec-fetch-site": "cross-site" },
        body: JSON.stringify({ action: "state" }),
      }),
    );
    expect(management.status).toBe(403);
    expect(await management.json()).toEqual({ error: "cross_origin_blocked" });
  });

  // Full coverage of this bridge (forged cookie, revoked device, upgrade, off-box
  // destination) lives in proxy-websocket.test.ts, which has the session harness.
  it("does not let an unverified cookie near the camoufox VNC bridge", async () => {
    const proxy = await loadProxy("");
    const res = await proxy(
      req("mso.rahmanef.com", "/camoufox-vnc/", {
        headers: { cookie: "session=anything" },
      }),
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });
});
