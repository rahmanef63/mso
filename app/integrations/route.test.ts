import { expect, it } from "vitest";
import { GET } from "./route";
it("serves a public uncached integration document with its own matching nonce", async () => {
  const r = GET(); const html = await r.text(); expect(r.status).toBe(200);
  const nonce = html.match(/<script nonce="([^"]+)"/)![1]; expect(r.headers.get("content-security-policy")).toContain(`script-src 'nonce-${nonce}'`);
  expect(r.headers.get("cache-control")).toContain("no-store"); expect(r.headers.get("x-frame-options")).toBe("DENY");
});
