import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
// The engine's own relativizer, so this test pins Next's real classification rule
// instead of reimplementing it.
import { parseRelativeURL } from "next/dist/shared/lib/router/utils/relativize-url";
vi.mock("@/lib/managed-apps/session", () => ({ gateManagedApp: vi.fn(async () => null) }));

const TEMPLATE = "{id}.mso.example.com";
const HERMES = "/api/v1/managed-apps/hermes/proxy";
const MARKER = "x-middleware-request-x-os-managed-app-host";
const rewriteOf = (res: Response) => res.headers.get("x-middleware-rewrite") ?? "";
async function loadProxy(template: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE", template);
  return (await import("../proxy")).proxy;
}
afterEach(() => vi.unstubAllEnvs());

describe("managed-app internal rewrite keeps the engine's own origin", () => {
  // A TLS-terminating proxy passes x-forwarded-proto: https, so Next describes its
  // plain-HTTP loopback listener as a synthetic https origin. Downgrading that origin
  // to http: (the old transport shim) made Next treat the rewrite as EXTERNAL and
  // self-hop it over the network: 500 over TLS, or a 404 after the marker was stripped.
  it.each(["localhost", "127.0.0.1", "[::1]"])(
    "preserves request.nextUrl.origin for %s over http and https",
    async host => {
      const proxy = await loadProxy(TEMPLATE);
      for (const protocol of ["http", "https"]) {
        const request = new NextRequest(`${protocol}://${host}:4005/chat?from=edge`, {
          headers: { host: "hermes.mso.example.com", "x-forwarded-proto": "https" },
        });
        const res = await proxy(request);
        const rewrite = rewriteOf(res);

        // The rewrite origin must equal nextUrl's origin EXACTLY, scheme included.
        expect(rewrite).toBe(`${request.nextUrl.origin}${HERMES}/chat?from=edge`);
        expect(new URL(rewrite).origin).toBe(request.nextUrl.origin);

        // The internal managed-app marker still rides the rewritten request.
        expect(res.headers.get(MARKER)).toBe("hermes");

        // Next's actual relativizer (not a copy) resolves this as in-process.
        const destination = parseRelativeURL(rewrite, `${request.nextUrl.origin}/chat?from=edge`);
        expect(destination.isRelative).toBe(true);
        expect(destination.url).toBe(`${HERMES}/chat?from=edge`);
      }
    },
  );
});
