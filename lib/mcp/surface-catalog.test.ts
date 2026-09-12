import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { publicSurfaceApps, resolveSurfaceRoute, surfaceFrameDomains } from "./surface-catalog";
import { msoSurfaceScript } from "./ui-surface-script";
import { OPEN_IN_MSO_SCRIPT } from "./ui-navigation";

const configured = [{
  id: "demo", title: "Demo", description: "Configured demo", origin: "https://demo.example.test",
  startPath: "/embed", renderer: "iframe", presentation: "inline", environment: "production",
  sandbox: "allow-scripts allow-same-origin", externalAuthPath: "/?auth=google",
}];

describe("MSO Page trusted app catalog", () => {
  beforeEach(() => { process.env.MSO_SURFACE_APPS_JSON = JSON.stringify(configured); });
  afterEach(() => { delete process.env.MSO_SURFACE_APPS_JSON; });

  it("uses only instance-configured reviewed origins", async () => {
    expect(await surfaceFrameDomains()).toEqual(["https://demo.example.test"]);
    const apps = await publicSurfaceApps();
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ id: "demo", title: "Demo", origin: "https://demo.example.test", startPath: "/embed", renderer: "iframe", presentation: "inline", environment: "production" });
    expect(JSON.stringify(apps)).not.toContain("sandbox");
    expect(JSON.stringify(apps)).not.toContain("externalAuthPath");
    expect((await resolveSurfaceRoute("/apps/demo")).app?.externalAuthPath).toBe("/?auth=google");
  });

  it("rejects arbitrary URLs, protocol-relative routes and traversal", async () => {
    for (const route of ["https://evil.example/app", "//evil.example/app", "/apps/unknown", "/apps/demo/../admin", "/apps/demo/%2e%2e/admin", "/apps/demo/%252e%252e/admin", "/apps/demo\\evil"]) {
      await expect(resolveSurfaceRoute(route), route).rejects.toThrow();
    }
  });

  it("keeps every registry route inside its start path with the reviewed renderer", async () => {
    const root = await resolveSurfaceRoute("/apps/demo");
    expect(root).toMatchObject({ kind: "app", title: "Demo", openPath: "/browser" });
    expect(root.app).toMatchObject({ id: "demo", renderer: "iframe", environment: "production" });
    expect(new URL(root.app!.url).pathname).toBe("/embed");
    const room = await resolveSurfaceRoute("/apps/demo/room/ABCD?join=remote");
    const url = new URL(room.app!.url);
    expect(url.origin).toBe("https://demo.example.test");
    expect(url.pathname).toBe("/embed/room/ABCD");
    expect(url.searchParams.get("join")).toBe("remote");
  });

  it("ships syntactically valid browser code with no dynamic HTML sink and path-prefix revalidation", async () => {
    const script = await msoSurfaceScript();
    expect(() => new Function(`${OPEN_IN_MSO_SCRIPT}\n${script}`)).not.toThrow();
    expect(script).not.toContain("innerHTML");
    expect(script).not.toContain("insertAdjacentHTML");
    expect(script).not.toContain("document.write");
    expect(script).toContain('rpcRequest("tools/call"');
    expect(script).toContain('rpcCall("render_mso_page"');
    expect(script).not.toContain("window.openai.callTool");
    expect(script).toContain("url.origin!==safe.origin");
    expect(script).toContain("!url.pathname.startsWith(start+\"/\")");
    expect(script).not.toContain("play-together:embed-ready");
    expect(script).not.toContain("mountReviewedFrame");
    expect(script).toContain('el("iframe","preview-frame")');
  });
  it("rejects a mismatched project and keeps MSO auth outside preview frames", async () => {
    process.env.MSO_SURFACE_APPS_JSON = JSON.stringify([{...configured[0], project:"demo-project"}]);
    await expect(resolveSurfaceRoute("/apps/demo", {project:"other-project"})).rejects.toThrow("project does not match");
    expect(await resolveSurfaceRoute("/apps/demo")).toMatchObject({project:"demo-project"});
    process.env.MSO_SURFACE_APPS_JSON = JSON.stringify([{...configured[0], origin:"http://localhost:4005"}]);
    expect(await surfaceFrameDomains()).toEqual([]);
  });

});
