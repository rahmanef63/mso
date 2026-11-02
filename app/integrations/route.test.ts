import { GET as embedGET } from "./embed/route";
import { GET as standaloneGET } from "./route";
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
import { GET } from "./manager/route";
import { proxy } from "@/proxy";
describe("friendly native Integrations page", () => {
  it("renders an uncached full catalog with public instructions but no credential grant", async () => {
    const response = GET(), html = await response.text();
    expect(response.status).toBe(200); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(html).toContain("INTEGRATIONS_CATALOG"); expect(html).toContain('"id":"supabase"');
    expect(html).toContain("How to get this credential / authorization"); expect(html).not.toContain("si-coder");
    expect(() => new Function(html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)![1])).not.toThrow();
  });
  it("preserves the dedicated embed alias and keeps standalone framing denied", () => {
    expect(embedGET().headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
    expect(standaloneGET().headers.get("x-frame-options")).toBe("DENY");
  });
  it("limits the embedded manager to the same origin", () => {
    const response = GET();
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
  });
  it("lets the trusted HTML endpoint own its nonce while retaining owner mutation CSRF checks", async () => {
    const read = await proxy(new NextRequest("https://mso.example.com/integrations/manager", { headers: { host: "mso.example.com" } }));
    expect(read.headers.get("content-security-policy")).toBeNull();
    const write = await proxy(new NextRequest("https://mso.example.com/api/v1/infra/setup", { method: "POST", headers: { host: "mso.example.com", origin: "https://evil.invalid", "sec-fetch-site": "cross-site" }, body: "{}" }));
    expect(write.status).toBe(403);
  });
});
