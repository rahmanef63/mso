import { describe, expect, it } from "vitest";
import { publicSurfaceApps, resolveSurfaceRoute, surfaceFrameDomains } from "./surface-catalog";
import { MSO_SURFACE_SCRIPT } from "./ui-surface-script";
import { OPEN_IN_MSO_SCRIPT } from "./ui-navigation";

describe("MSO Surface trusted app catalog", () => {
  it("allowlists only reviewed direct-frame origins", () => {
    expect(surfaceFrameDomains()).toEqual(["https://builder-game.antinrml.com"]);
    const apps = publicSurfaceApps();
    expect(apps.find((app) => app.id === "antinrml-builder")?.renderer).toBe("iframe");
    expect(apps.find((app) => app.id === "baton")?.renderer).toBe("remote");
    expect(apps.find((app) => app.id === "antinrml-game")?.renderer).toBe("remote");
    expect(JSON.stringify(apps)).not.toContain("sandbox");
  });

  it("rejects arbitrary URLs, protocol-relative routes and traversal", () => {
    for (const route of [
      "https://evil.example/app",
      "//evil.example/app",
      "/apps/unknown",
      "/apps/antinrml-builder/../admin",
      "/apps/antinrml-builder/%2e%2e/admin",
      "/apps/antinrml-builder\\evil",
    ]) {
      expect(() => resolveSurfaceRoute(route), route).toThrow();
    }
  });

  it("keeps direct demo paths on the exact reviewed origin", () => {
    const surface = resolveSurfaceRoute("/apps/antinrml-builder/rooms/demo?mode=guest");
    expect(surface).toMatchObject({ kind: "app", title: "AntiNRML Builder" });
    expect(surface.app?.renderer).toBe("iframe");
    const url = new URL(surface.app!.url);
    expect(url.origin).toBe("https://builder-game.antinrml.com");
    expect(url.pathname).toBe("/rooms/demo");
    expect(url.searchParams.get("mode")).toBe("guest");
  });

  it("ships syntactically valid browser code with no dynamic HTML sink", () => {
    expect(() => new Function(`${OPEN_IN_MSO_SCRIPT}\n${MSO_SURFACE_SCRIPT}`)).not.toThrow();
    expect(MSO_SURFACE_SCRIPT).not.toContain("innerHTML");
    expect(MSO_SURFACE_SCRIPT).not.toContain("insertAdjacentHTML");
    expect(MSO_SURFACE_SCRIPT).not.toContain("document.write");
    expect(MSO_SURFACE_SCRIPT).toContain("url.origin!==safe.origin");
  });

  it("preserves anti-framing apps as remote surfaces", () => {
    const baton = resolveSurfaceRoute("/apps/baton");
    expect(baton.app).toMatchObject({ id: "baton", renderer: "remote", origin: "https://baton.rahmanef.com" });
    expect(baton.openPath).toBe("/browser");
  });
});
