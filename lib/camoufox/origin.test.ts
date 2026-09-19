import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllEnvs());

async function load(
  template = "{id}.mso.example.com",
  publicOrigin = "https://mso.example.com",
  viewerOrigin = "",
  cookieDomain = "mso.example.com",
) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE", template);
  vi.stubEnv("OS_PUBLIC_ORIGIN", publicOrigin);
  vi.stubEnv("CAMOUFOX_VIEWER_ORIGIN", viewerOrigin);
  vi.stubEnv("OS_SESSION_COOKIE_DOMAIN", cookieDomain);
  return import("./origin");
}

describe("Camoufox split origin", () => {
  it("derives a sibling outside the managed-app cookie namespace by default", async () => {
    const mod = await load();
    expect(mod.camoufoxViewerHost()).toBe("camoufox.example.com");
    expect(mod.camoufoxViewerOrigin()).toBe("https://camoufox.example.com");
    expect(mod.isCamoufoxViewerHost("camoufox.example.com:443")).toBe(true);
    expect(mod.isCamoufoxViewerHost("camoufox.mso.example.com")).toBe(false);
  });

  it("derives the deployment sibling for an arbitrary three-label cookie namespace", async () => {
    const mod = await load(
      "{id}.mso.operator.test",
      "https://mso.operator.test",
      "",
      "mso.operator.test",
    );
    expect(mod.camoufoxViewerOrigin()).toBe("https://camoufox.operator.test");
  });

  it("uses an explicit isolated viewer origin without changing the managed-app namespace", async () => {
    const mod = await load(
      "{id}.mso.example.com",
      "https://mso.example.com",
      "https://browser.example.net",
    );
    expect(mod.camoufoxViewerHost()).toBe("browser.example.net");
    expect(mod.camoufoxViewerOrigin()).toBe("https://browser.example.net");
    expect(mod.isCamoufoxViewerHost("browser.example.net:443")).toBe(true);
  });

  it("refuses explicit viewer origins that can receive the cockpit Domain cookie", async () => {
    for (const value of [
      "https://camoufox.mso.example.com",
      "https://mso.example.com",
    ]) {
      const mod = await load("{id}.mso.example.com", "https://mso.example.com", value);
      expect(mod.camoufoxViewerOrigin()).toBe("https://camoufox.example.com");
      vi.unstubAllEnvs();
    }
  });

  it("rejects malformed overrides and falls back to the safe derived sibling", async () => {
    for (const value of [
      "http://camoufox.example.com",
      "https://user:pass@camoufox.example.com",
      "https://camoufox.example.com:8443",
      "https://camoufox.example.com/path",
    ]) {
      const mod = await load("{id}.mso.example.com", "https://mso.example.com", value);
      expect(mod.camoufoxViewerOrigin()).toBe("https://camoufox.example.com");
      vi.unstubAllEnvs();
    }
  });

  it("fails closed when a broad two-label Domain cookie leaves no safe automatic sibling", async () => {
    const mod = await load(
      "{id}.mso.example.com",
      "https://mso.example.com",
      "",
      "example.com",
    );
    expect(mod.camoufoxViewerOrigin()).toBeNull();
    expect(mod.isCamoufoxViewerHost("camoufox.mso.example.com")).toBe(false);
  });

  it("can derive a sibling with host-only sessions even when managed-app embedding is disabled", async () => {
    const mod = await load("", "https://mso.example.com", "", "");
    expect(mod.camoufoxViewerOrigin()).toBe("https://camoufox.example.com");
    expect(mod.isCamoufoxViewerHost("mso.example.com")).toBe(false);
  });

  it("allows only the cockpit to frame the viewer and no outbound forms", async () => {
    const mod = await load();
    const csp = mod.camoufoxViewerCsp();
    expect(csp).toContain("frame-ancestors https://mso.example.com");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("object-src 'none'");
  });
});
