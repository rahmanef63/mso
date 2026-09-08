import { afterEach, describe, expect, it, vi } from "vitest";

const reset = () => {
  vi.unstubAllEnvs();
  vi.resetModules();
};
afterEach(reset);

describe("portable public MCP configuration", () => {
  it("derives safe public and sibling widget origins", async () => {
    vi.stubEnv("OS_PUBLIC_ORIGIN", "https://mso.example.test/ignored?x=1");
    const config = await import("./ui-config");
    expect(config.MSO_ORIGIN).toBe("https://mso.example.test");
    expect(config.MCP_UI_DOMAIN).toBe("https://mso-ui.example.test");
    expect(JSON.stringify(config.widgetResourceMeta("test"))).not.toMatch(
      /rahmanef\.com|\/home\/rahman/,
    );
  });
  it("uses explicit UI origin only when it is a safe browser origin", async () => {
    vi.stubEnv("OS_PUBLIC_ORIGIN", "https://console.example.test");
    vi.stubEnv("OS_MCP_UI_ORIGIN", "https://widgets.example.test/path");
    let config = await import("./ui-config");
    expect(config.MCP_UI_DOMAIN).toBe("https://widgets.example.test");
    reset();
    vi.stubEnv("OS_PUBLIC_ORIGIN", "https://console.example.test");
    vi.stubEnv("OS_MCP_UI_ORIGIN", "https://user:pass@evil.example.test");
    config = await import("./ui-config");
    expect(config.MCP_UI_DOMAIN).toBe("https://console.example.test");
  });
  it("has no external app or frame CSP without explicit configuration", async () => {
    vi.stubEnv("OS_PUBLIC_ORIGIN", "https://mso.example.test");
    const catalog = await import("./surface-catalog");
    expect(catalog.publicSurfaceApps()).toEqual([]);
    expect(catalog.surfaceFrameDomains()).toEqual([]);
    const config = await import("./ui-config");
    expect(
      JSON.stringify({
        metadataBase: config.MSO_ORIGIN,
        apps: catalog.publicSurfaceApps(),
        meta: config.widgetResourceMeta("test"),
      }),
    ).not.toMatch(/rahmanef\.com|\/home\/rahman/);
  });
  it("validates, deduplicates and exposes configured external apps only", async () => {
    vi.stubEnv(
      "MSO_SURFACE_APPS_JSON",
      JSON.stringify([
        {
          id: "demo",
          title: "Demo",
          description: "safe",
          origin: "https://demo.example.test",
          startPath: "/embed",
          renderer: "iframe",
          presentation: "inline",
          environment: "production",
          sandbox: "allow-scripts allow-same-origin",
          externalAuthPath: "/login",
        },
        {
          id: "demo",
          title: "Duplicate",
          origin: "https://other.example.test",
          startPath: "/",
          renderer: "remote",
          presentation: "inline",
          environment: "other",
        },
        {
          id: "bad",
          title: "Bad",
          origin: "http://evil.example.test",
          startPath: "/",
          renderer: "iframe",
          presentation: "inline",
          environment: "production",
        },
      ]),
    );
    const catalog = await import("./surface-catalog");
    expect(catalog.publicSurfaceApps()).toEqual([
      expect.objectContaining({
        id: "demo",
        origin: "https://demo.example.test",
      }),
    ]);
    expect(catalog.surfaceFrameDomains()).toEqual([
      "https://demo.example.test",
    ]);
    expect(catalog.resolveSurfaceRoute("/apps/demo").app?.url).toBe(
      "https://demo.example.test/embed",
    );
  });
});
