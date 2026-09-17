import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TEMPLATE = "{id}.mso.example.com";
const HERMES = "/api/v1/managed-apps/hermes/proxy";
const rewriteOf = (res: Response) => res.headers.get("x-middleware-rewrite");
async function loadProxy(template: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE", template);
  return (await import("../proxy")).proxy;
}
afterEach(() => vi.unstubAllEnvs());

describe("managed-app internal transport behind HTTPS termination", () => {
  it.each(["localhost", "127.0.0.1", "[::1]"])("keeps reverse-proxy rewrites to %s on local HTTP", async host => {
    const proxy = await loadProxy(TEMPLATE);
    for (const protocol of ["http", "https"]) {
      const request = new NextRequest(`${protocol}://${host}:4005/chat?from=edge`, {
        headers: { host: "hermes.mso.example.com", "x-forwarded-proto": "https" },
      });
      const res = await proxy(request);
      expect(rewriteOf(res)).toBe(`http://${request.nextUrl.host}${HERMES}/chat?from=edge`);
    }
  });

});
