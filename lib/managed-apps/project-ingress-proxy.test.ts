import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TEMPLATE = "{id}.mso.rahmanef.com";
const ROUTES = JSON.stringify([{
  app: "hermes", method: "POST", path: "/webhooks/project-example",
  target: "http://127.0.0.1:8644/webhooks/project-example", auth: "hmac-v2-json",
}]);

async function loadProxy(ingress = "") {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE", TEMPLATE);
  vi.stubEnv("OS_PROJECT_INGRESS_ROUTES", ingress);
  return (await import("../../proxy")).proxy;
}

function req(path: string, signature = "a".repeat(64)) {
  return new NextRequest(`https://hermes.mso.rahmanef.com${path}`, {
    method: "POST",
    headers: {
      host: "hermes.mso.rahmanef.com",
      "sec-fetch-site": "cross-site",
      "content-type": "application/json",
      "x-webhook-timestamp": String(Math.floor(Date.now() / 1000)),
      "x-webhook-signature-v2": signature,
    },
    body: "{}",
  });
}
const rewriteOf = (res: Response) => res.headers.get("x-middleware-rewrite");
afterEach(() => vi.unstubAllEnvs());

describe("proxy opt-in project ingress", () => {
  it("keeps stock MSO closed when no ingress config exists", async () => {
    const res = await (await loadProxy())(req("/webhooks/project-example"));
    expect(res.status).toBe(403);
    expect(rewriteOf(res)).toBeNull();
  });

  it("relays only the exact operator-declared route", async () => {
    const proxy = await loadProxy(ROUTES);
    expect(rewriteOf(await proxy(req("/webhooks/project-example"))))
      .toBe("http://127.0.0.1:8644/webhooks/project-example");
    const other = await proxy(req("/webhooks/other"));
    expect(other.status).toBe(403);
    expect(rewriteOf(other)).toBeNull();
  });

  it("rejects malformed auth-shaped traffic before loopback", async () => {
    const res = await (await loadProxy(ROUTES))(req("/webhooks/project-example", "bad"));
    expect(res.status).toBe(403);
    expect(rewriteOf(res)).toBeNull();
  });
});
