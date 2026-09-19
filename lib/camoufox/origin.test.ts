import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllEnvs());

async function load(
  template: string,
  publicOrigin = "https://mso.example.com",
  viewerOrigin = "",
) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE", template);
  vi.stubEnv("OS_PUBLIC_ORIGIN", publicOrigin);
  vi.stubEnv("CAMOUFOX_VIEWER_ORIGIN", viewerOrigin);
  return import("./origin");
}

describe("Camoufox split origin", () => {
  it("reserves one host in the managed-app namespace", async () => {
    const mod = await load("{id}.mso.example.com");
    expect(mod.camoufoxViewerHost()).toBe("camoufox.mso.example.com");
    expect(mod.camoufoxViewerOrigin()).toBe("https://camoufox.mso.example.com");
    expect(mod.isCamoufoxViewerHost("camoufox.mso.example.com:443")).toBe(true);
  });

  it("has no same-origin fallback when the namespace is disabled", async () => {
    const mod = await load("");
    expect(mod.camoufoxViewerOrigin()).toBeNull();
    expect(mod.isCamoufoxViewerHost("mso.example.com")).toBe(false);
  });


  it("can use an explicit sibling viewer origin without changing the managed-app namespace", async () => {
    const mod = await load(
      "{id}.mso.example.com",
      "https://mso.example.com",
      "https://camoufox-mso.example.com",
    );
    expect(mod.camoufoxViewerHost()).toBe("camoufox-mso.example.com");
    expect(mod.camoufoxViewerOrigin()).toBe("https://camoufox-mso.example.com");
    expect(mod.isCamoufoxViewerHost("camoufox-mso.example.com:443")).toBe(true);
    expect(mod.isCamoufoxViewerHost("camoufox.mso.example.com")).toBe(false);
  });

  it("rejects unsafe viewer-origin overrides and keeps the safe namespace fallback", async () => {
    for (const value of [
      "http://camoufox-mso.example.com",
      "https://user:pass@camoufox-mso.example.com",
      "https://camoufox-mso.example.com/path",
    ]) {
      const mod = await load("{id}.mso.example.com", "https://mso.example.com", value);
      expect(mod.camoufoxViewerOrigin()).toBe("https://camoufox.mso.example.com");
      vi.unstubAllEnvs();
    }
  });

  it("allows only the cockpit to frame the viewer and no outbound forms", async () => {
    const mod = await load("{id}.mso.example.com");
    const csp = mod.camoufoxViewerCsp();
    expect(csp).toContain("frame-ancestors https://mso.example.com");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("object-src 'none'");
  });
});
