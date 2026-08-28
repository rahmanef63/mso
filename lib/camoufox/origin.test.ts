import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllEnvs());

async function load(template: string, publicOrigin = "https://mso.example.com") {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE", template);
  vi.stubEnv("OS_PUBLIC_ORIGIN", publicOrigin);
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

  it("allows only the cockpit to frame the viewer and no outbound forms", async () => {
    const mod = await load("{id}.mso.example.com");
    const csp = mod.camoufoxViewerCsp();
    expect(csp).toContain("frame-ancestors https://mso.example.com");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("object-src 'none'");
  });
});
