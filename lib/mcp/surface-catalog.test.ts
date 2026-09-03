import { describe, expect, it } from "vitest";
import { publicSurfaceApps, resolveSurfaceRoute, surfaceFrameDomains } from "./surface-catalog";
import { MSO_SURFACE_SCRIPT } from "./ui-surface-script";
import { OPEN_IN_MSO_SCRIPT } from "./ui-navigation";

describe("MSO Surface trusted app catalog", () => {
  it("starts with no third-party nested-frame origins", () => {
    expect(surfaceFrameDomains()).toEqual([]);
    const apps = publicSurfaceApps();
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ id: "play-together", title: "Play Together", origin: "https://game.rahmanef.com", renderer: "remote" });
    expect(JSON.stringify(apps)).not.toContain("sandbox");
  });

  it("rejects arbitrary URLs, protocol-relative routes and traversal", () => {
    for (const route of [
      "https://evil.example/app",
      "//evil.example/app",
      "/apps/unknown",
      "/apps/play-together/../admin",
      "/apps/play-together/%2e%2e/admin",
      "/apps/play-together\\evil",
    ]) {
      expect(() => resolveSurfaceRoute(route), route).toThrow();
    }
  });

  it("keeps Play Together on the remote seam while its CSP is self-only", () => {
    const surface = resolveSurfaceRoute("/apps/play-together");
    expect(surface).toMatchObject({ kind: "app", title: "Play Together", openPath: "/browser" });
    expect(surface.app).toMatchObject({ id: "play-together", renderer: "remote", origin: "https://game.rahmanef.com" });
    expect(new URL(surface.app!.url).origin).toBe("https://game.rahmanef.com");
  });

  it("ships syntactically valid browser code with no dynamic HTML sink", () => {
    expect(() => new Function(`${OPEN_IN_MSO_SCRIPT}\n${MSO_SURFACE_SCRIPT}`)).not.toThrow();
    expect(MSO_SURFACE_SCRIPT).not.toContain("innerHTML");
    expect(MSO_SURFACE_SCRIPT).not.toContain("insertAdjacentHTML");
    expect(MSO_SURFACE_SCRIPT).not.toContain("document.write");
    expect(MSO_SURFACE_SCRIPT).toContain("url.origin!==safe.origin");
  });
});
