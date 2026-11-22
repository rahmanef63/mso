import { describe, expect, it } from "vitest";
import { CONNECTION_MANAGER_ASSETS } from "./connection-ui-assets";
import { CONNECTION_MANAGER_SCRIPT } from "./connection-ui";

describe("connection manager provider icon assets", () => {
  it("ships the official image marks to the connection manager", () => {
    expect(CONNECTION_MANAGER_ASSETS).toContain('"dokploy"');
    expect(CONNECTION_MANAGER_ASSETS).toContain("/brand/official/dokploy.webp");
    expect(CONNECTION_MANAGER_ASSETS).toContain("PROVIDER_ICON_ASSETS");
    expect(CONNECTION_MANAGER_ASSETS).toContain("PROVIDER_ICON_TILE_COLORS");
    expect(CONNECTION_MANAGER_ASSETS).toContain("/brand/official/composio.webp");
    expect(CONNECTION_MANAGER_ASSETS).toContain("/brand/official/dokploy.webp");
    expect(CONNECTION_MANAGER_ASSETS).toContain("/brand/official/doku.webp");
    expect(CONNECTION_MANAGER_SCRIPT).toContain("PROVIDER_ICON_ASSETS[p.id]");
  });
});
