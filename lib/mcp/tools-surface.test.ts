import { describe, expect, it } from "vitest";
import { SURFACE_TOOLS } from "./tools-surface";

const tool = (name: string) => {
  const value = SURFACE_TOOLS.find((row) => row.name === name);
  if (!value) throw new Error(`missing ${name}`);
  return value;
};

describe("MSO Page MCP tools", () => {
  it("returns only the server-reviewed public app catalog", async () => {
    const result = await tool("mso_surface_apps_list").run({}, { scope: "read" }) as { apps: Array<Record<string, unknown>> };
    expect(result.apps.map((app) => app.id)).toEqual(["play-together"]);
    expect(result.apps[0]).toMatchObject({
      title: "Play Together",
      origin: "https://game.rahmanef.com",
      renderer: "iframe",
      startPath: "/embed",
      environment: "production",
    });
    expect(JSON.stringify(result)).not.toContain("sandbox");
    expect(JSON.stringify(result)).not.toContain("<script");
  });

  it("renders the VPSKU Play Together target without accepting a URL argument", async () => {
    const render = tool("render_mso_page");
    expect(render.inputSchema.properties).not.toHaveProperty("url");
    expect(render.inputSchema.properties).not.toHaveProperty("html");
    const result = await render.run({ route: "/apps/play-together" }, { scope: "read" }) as { app?: Record<string, unknown> };
    expect(result.app).toMatchObject({
      id: "play-together",
      renderer: "iframe",
      presentation: "inline",
      origin: "https://game.rahmanef.com",
      startPath: "/embed",
      environment: "production",
      url: "https://game.rahmanef.com/embed",
    });
    expect(result.app).not.toHaveProperty("sandbox");
    expect((render.meta?.ui as { resourceUri?: string }).resourceUri).toMatch(/^ui:\/\/mso\/page-v10\.html$/);
    expect(render.meta?.["openai/outputTemplate"]).toBeUndefined();
  });

  it("keeps scanner-facing Page metadata scoped to Play Together", () => {
    const render = tool("render_mso_page");
    const metadata = JSON.stringify({ description: render.description, chatgptDescription: render.chatgptDescription });
    expect(metadata).toContain("play-together");
    expect(metadata.toLowerCase()).not.toContain("antinrml");
  });

  it("keeps project identity separate from the route string", async () => {
    const result = await tool("render_mso_page").run({ route: "/project", project: "mso" }, { scope: "read" });
    expect(result).toMatchObject({ route: "/project", kind: "project", project: "mso", openPath: "/files" });
  });

  it("uses only the standard resource binding for Page tools", () => {
    for (const name of ["render_mso_page", "integration_setup_open"] as const) {
      const value = tool(name);
      expect((value.meta?.ui as { resourceUri?: string }).resourceUri).toMatch(/^ui:\/\/mso\/page-v10\.html$/);
      expect(value.meta?.["openai/outputTemplate"]).toBeUndefined();
    }
  });

  it("retains an app-only compatibility alias without another UI resource binding", async () => {
    const legacy = tool("render_mso_surface");
    expect(legacy.meta).toMatchObject({ ui: { visibility: ["app"] }, "openai/widgetAccessible": true });
    expect((legacy.meta?.ui as { resourceUri?: string }).resourceUri).toBeUndefined();
    const result = await legacy.run({ route: "/monitor" }, { scope: "read" });
    expect(result).toMatchObject({ route: "/monitor", kind: "monitor", title: "System Monitor" });
  });
});
