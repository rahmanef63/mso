import { describe, expect, it } from "vitest";
import { SURFACE_TOOLS } from "./tools-surface";

const tool = (name: string) => {
  const value = SURFACE_TOOLS.find((row) => row.name === name);
  if (!value) throw new Error(`missing ${name}`);
  return value;
};

describe("MSO Surface MCP tools", () => {
  it("returns only the server-reviewed public app catalog", async () => {
    const result = await tool("mso_surface_apps_list").run({}, { scope: "read" }) as { apps: Array<Record<string, unknown>> };
    expect(result.apps.map((app) => app.id)).toEqual(["play-together"]);
    expect(result.apps[0]).toMatchObject({ title: "Play Together", origin: "https://game.rahmanef.com", renderer: "iframe", startPath: "/embed" });
    expect(JSON.stringify(result)).not.toContain("sandbox");
    expect(JSON.stringify(result)).not.toContain("<script");
  });

  it("renders the VPSKU Play Together target without accepting a URL argument", async () => {
    const render = tool("render_mso_surface");
    expect(render.inputSchema.properties).not.toHaveProperty("url");
    expect(render.inputSchema.properties).not.toHaveProperty("html");
    const result = await render.run({ route: "/apps/play-together" }, { scope: "read" }) as { app?: Record<string, unknown> };
    expect(result.app).toMatchObject({ id: "play-together", renderer: "iframe", origin: "https://game.rahmanef.com", startPath: "/embed", url: "https://game.rahmanef.com/embed" });
    expect(result.app).not.toHaveProperty("sandbox");
  });

  it("keeps project identity separate from the route string", async () => {
    const result = await tool("render_mso_surface").run({ route: "/project", project: "mso" }, { scope: "read" });
    expect(result).toMatchObject({ route: "/project", kind: "project", project: "mso", openPath: "/files" });
  });
});
