import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET } from "./route";

describe("GET /integrations/manager", () => {
  it("serves the native embedded manager with same-origin framing without requiring auth", async () => {
    // Handler serves the manager interface without requiring an authenticated session
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");

    const html = await res.text();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("INTEGRATIONS_CATALOG");
    // Embedded presentation hides the top site-bar
    expect(html).toContain(".site-bar{display:none}");
  });
});
