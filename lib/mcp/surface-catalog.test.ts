import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { publicSurfaceApps, resolveSurfaceRoute, surfaceFrameDomains } from "./surface-catalog";
import { MSO_SURFACE_SCRIPT } from "./ui-surface-script";
import { OPEN_IN_MSO_SCRIPT } from "./ui-navigation";

const configured = [{
  id: "demo", title: "Demo", description: "Configured demo", origin: "https://demo.example.test",
  startPath: "/embed", renderer: "iframe", presentation: "inline", environment: "production",
  sandbox: "allow-scripts allow-same-origin", externalAuthPath: "/?auth=google",
}];

describe("MSO Page trusted app catalog", () => {
  beforeEach(() => { process.env.MSO_SURFACE_APPS_JSON = JSON.stringify(configured); });
  afterEach(() => { delete process.env.MSO_SURFACE_APPS_JSON; });

  it("uses only instance-configured reviewed origins", () => {
    expect(surfaceFrameDomains()).toEqual(["https://demo.example.test"]);
    const apps = publicSurfaceApps();
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ id: "demo", title: "Demo", origin: "https://demo.example.test", startPath: "/embed", renderer: "iframe", presentation: "inline", environment: "production" });
    expect(JSON.stringify(apps)).not.toContain("sandbox");
    expect(JSON.stringify(apps)).not.toContain("externalAuthPath");
    expect(resolveSurfaceRoute("/apps/demo").app?.externalAuthPath).toBe("/?auth=google");
  });

  it("rejects arbitrary URLs, protocol-relative routes and traversal", () => {
    for (const route of ["https://evil.example/app", "//evil.example/app", "/apps/unknown", "/apps/demo/../admin", "/apps/demo/%2e%2e/admin", "/apps/demo\\evil"]) {
      expect(() => resolveSurfaceRoute(route), route).toThrow();
    }
  });

  it("keeps every configured iframe route inside its start path", () => {
    const root = resolveSurfaceRoute("/apps/demo");
    expect(root).toMatchObject({ kind: "app", title: "Demo", openPath: "/assistant/mcp" });
    expect(root.app).toMatchObject({ id: "demo", renderer: "iframe", environment: "production" });
    expect(new URL(root.app!.url).pathname).toBe("/embed");
    const room = resolveSurfaceRoute("/apps/demo/room/ABCD?join=remote");
    const url = new URL(room.app!.url);
    expect(url.origin).toBe("https://demo.example.test");
    expect(url.pathname).toBe("/embed/room/ABCD");
    expect(url.searchParams.get("join")).toBe("remote");
  });

  it("ships syntactically valid browser code with no dynamic HTML sink and path-prefix revalidation", () => {
    expect(() => new Function(`${OPEN_IN_MSO_SCRIPT}\n${MSO_SURFACE_SCRIPT}`)).not.toThrow();
    expect(MSO_SURFACE_SCRIPT).not.toContain("innerHTML");
    expect(MSO_SURFACE_SCRIPT).not.toContain("insertAdjacentHTML");
    expect(MSO_SURFACE_SCRIPT).not.toContain("document.write");
    expect(MSO_SURFACE_SCRIPT).toContain('rpcRequest("tools/call"');
    expect(MSO_SURFACE_SCRIPT).toContain('rpcCall("render_mso_page"');
    expect(MSO_SURFACE_SCRIPT).not.toContain("window.openai.callTool");
    expect(MSO_SURFACE_SCRIPT).toContain("url.origin!==safe.origin");
    expect(MSO_SURFACE_SCRIPT).toContain("!url.pathname.startsWith(start+\"/\")");
    expect(MSO_SURFACE_SCRIPT).not.toContain("play-together:embed-ready");
  });
});
