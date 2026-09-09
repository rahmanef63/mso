import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reset = () => {
  vi.unstubAllEnvs();
  vi.resetModules();
};
afterEach(reset);
beforeEach(() => {
  vi.stubEnv("OS_MCP_UI_ORIGIN", "");
  vi.stubEnv("MSO_SURFACE_APPS_JSON", "");
});

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
    expect(await catalog.publicSurfaceApps()).toEqual([]);
    expect(await catalog.surfaceFrameDomains()).toEqual([]);
    const config = await import("./ui-config");
    expect(
      JSON.stringify({
        metadataBase: config.MSO_ORIGIN,
        apps: await catalog.publicSurfaceApps(),
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
    expect(await catalog.publicSurfaceApps()).toEqual([
      expect.objectContaining({
        id: "demo",
        origin: "https://demo.example.test",
        renderer: "remote",
      }),
    ]);
    expect(await catalog.surfaceFrameDomains()).toEqual([
      "https://demo.example.test",
    ]);
    expect((await catalog.resolveSurfaceRoute("/apps/demo")).app?.url).toBe(
      "https://demo.example.test/embed",
    );
  });
});


describe("two independent instance presentations", () => {
  it("does not mix origins, app catalogs, resource HTML or CSP between instances", async () => {
    const outputs: string[] = [];
    for (const id of ["alpha", "beta"]) {
      vi.resetModules();
      vi.stubEnv("OS_PUBLIC_ORIGIN", `https://mso.${id}.example.test`);
      vi.stubEnv("OS_MCP_UI_ORIGIN", `https://widgets.${id}.example.test`);
      vi.stubEnv("MSO_SURFACE_APPS_JSON", JSON.stringify([{
        id, title: id, description: id, origin: `https://app.${id}.example.test`,
        startPath: "/embed", renderer: "iframe", presentation: "inline", environment: "preview",
      }]));
      const { readUiResource, MSO_PAGE_URI } = await import("./ui-resources");
      const { publicSurfaceApps, surfaceFrameDomains } = await import("./surface-catalog");
      expect((await publicSurfaceApps()).map(app => app.id)).toEqual([id]);
      expect(await surfaceFrameDomains()).toEqual([`https://app.${id}.example.test`]);
      const resource = await readUiResource(MSO_PAGE_URI);
      const serialized = JSON.stringify(resource);
      expect(serialized).toContain(`widgets.${id}.example.test`);
      expect(serialized).toContain(`mso.${id}.example.test`);
      expect((resource?._meta.ui as { csp: { frameDomains?: string[] } }).csp.frameDomains).toBeUndefined();
      expect((resource?._meta["openai/widgetCSP"] as { frame_domains?: string[] }).frame_domains).toBeUndefined();
      outputs.push(serialized);
    }
    expect(outputs[0]).not.toContain("beta.example.test");
    expect(outputs[1]).not.toContain("alpha.example.test");
  });
});
