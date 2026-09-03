import { describe, expect, it } from "vitest";
import { publicSurfaceApps, resolveSurfaceRoute, surfaceFrameDomains } from "./surface-catalog";
import { MSO_SURFACE_SCRIPT } from "./ui-surface-script";
import { OPEN_IN_MSO_SCRIPT } from "./ui-navigation";

describe("MSO Surface trusted app catalog", () => {
  it("allowlists only the reviewed Play Together origin", () => {
    expect(surfaceFrameDomains()).toEqual(["https://game.rahmanef.com"]);
    const apps = publicSurfaceApps();
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({
      id: "play-together",
      title: "Play Together",
      origin: "https://game.rahmanef.com",
      startPath: "/embed",
      renderer: "iframe",
    });
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

  it("keeps every Play Together demo route inside /embed", () => {
    const root = resolveSurfaceRoute("/apps/play-together");
    expect(root).toMatchObject({ kind: "app", title: "Play Together", openPath: "/assistant/mcp" });
    expect(root.app).toMatchObject({ id: "play-together", renderer: "iframe" });
    expect(new URL(root.app!.url).pathname).toBe("/embed");

    const room = resolveSurfaceRoute("/apps/play-together/room/ABCD?join=remote");
    const url = new URL(room.app!.url);
    expect(url.origin).toBe("https://game.rahmanef.com");
    expect(url.pathname).toBe("/embed/room/ABCD");
    expect(url.searchParams.get("join")).toBe("remote");
  });

  it("ships syntactically valid browser code with no dynamic HTML sink and path-prefix revalidation", () => {
    expect(() => new Function(`${OPEN_IN_MSO_SCRIPT}\n${MSO_SURFACE_SCRIPT}`)).not.toThrow();
    expect(MSO_SURFACE_SCRIPT).not.toContain("innerHTML");
    expect(MSO_SURFACE_SCRIPT).not.toContain("insertAdjacentHTML");
    expect(MSO_SURFACE_SCRIPT).not.toContain("document.write");
    expect(MSO_SURFACE_SCRIPT).toContain("url.origin!==safe.origin");
    expect(MSO_SURFACE_SCRIPT).toContain("!url.pathname.startsWith(start+\"/\")");
  });
});
