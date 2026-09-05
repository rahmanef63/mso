import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
import { GET } from "./route";
import { proxy } from "@/proxy";
describe("friendly native Integrations page", () => {
  it("renders an uncached full catalog with public instructions but no credential grant", async () => {
    const response = GET(), html = await response.text();
    expect(response.status).toBe(200); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(html).toContain("INTEGRATIONS_CATALOG"); expect(html).toContain('"id":"supabase"');
    expect(html).toContain("Step by step: get this credential"); expect(html).not.toContain("si-coder");
    expect(() => new Function(html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)![1])).not.toThrow();
  });
  it("lets the trusted HTML endpoint own its nonce while retaining owner mutation CSRF checks", async () => {
    const read = await proxy(new NextRequest("https://mso.rahmanef.com/integrations", { headers: { host: "mso.rahmanef.com" } }));
    expect(read.headers.get("content-security-policy")).toBeNull();
    const write = await proxy(new NextRequest("https://mso.rahmanef.com/api/v1/infra/setup", { method: "POST", headers: { host: "mso.rahmanef.com", origin: "https://evil.invalid", "sec-fetch-site": "cross-site" }, body: "{}" }));
    expect(write.status).toBe(403);
  });
});
