import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { BASELINE_SECURITY_HEADERS, applyBaselineSecurityHeaders } from "../scripts/server-headers.mjs";

describe("baseline security headers", () => {
  it("sends the three headers the passive ZAP baseline fails on (10021, 10035, 10063)", () => {
    const headers = applyBaselineSecurityHeaders(new Headers());
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("strict-transport-security")).toBe("max-age=31536000");
    expect(headers.get("permissions-policy")).toContain("camera=()");
    // The copy buttons call navigator.clipboard.writeText.
    expect(headers.get("permissions-policy")).toContain("clipboard-write=(self)");
  });

  it("keeps a value the route already chose", () => {
    // The noVNC viewer deliberately sends a narrower Permissions-Policy.
    const headers = new Headers({ "permissions-policy": "camera=()" });
    applyBaselineSecurityHeaders(headers);
    expect(headers.get("permissions-policy")).toBe("camera=()");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("denies the capabilities the app never uses", () => {
    for (const feature of ["microphone", "geolocation", "payment", "usb", "serial", "hid"]) {
      expect(BASELINE_SECURITY_HEADERS["permissions-policy"]).toContain(`${feature}=()`);
    }
  });

  it("is applied where every response leaves the server", () => {
    // A route, a static asset and a 404 all return through dispatchMsoRequest, so the
    // server is the one place that can promise the baseline for each of them.
    const source = readFileSync(new URL("./server.mjs", import.meta.url), "utf8");
    expect(source).toContain("applyBaselineSecurityHeaders(res.headers)");
  });
});
