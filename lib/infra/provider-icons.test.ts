import { describe, expect, it } from "vitest";
import { PROVIDER_ICON_ASSETS, PROVIDER_ICON_PATHS, PROVIDER_ICON_TILE_COLORS } from "./provider-icons";
import { INFRA_PROVIDER_IDS } from "./types";

describe("infrastructure provider brand marks", () => {
  it("includes the official Dokploy image mark instead of the generic provider fallback", () => {
    expect(PROVIDER_ICON_ASSETS.dokploy).toBe("/brand/official/dokploy.webp");
    expect(PROVIDER_ICON_TILE_COLORS.dokploy).toBe("#111827");
  });
  it("keeps the Cloudflare Simple Icons mark available to provider cards", () => {
    expect(PROVIDER_ICON_PATHS.cloudflare).toBeTruthy();
    expect(PROVIDER_ICON_PATHS.cloudflare.length).toBeGreaterThan(100);
  });
  it("provides official marks for social and Google providers", () => {
    for (const id of ["telegram", "discord", "google-oauth-app", "google-search-console", "google-analytics"]) {
      expect(PROVIDER_ICON_PATHS[id]).toBeTruthy();
    }
  });
  it("uses official image assets for Composio, Dokploy and DOKU", () => {
    expect(PROVIDER_ICON_ASSETS.composio).toBe("/brand/official/composio.webp");
    expect(PROVIDER_ICON_ASSETS.dokploy).toBe("/brand/official/dokploy.webp");
    expect(PROVIDER_ICON_ASSETS.doku).toBe("/brand/official/doku.webp");
    expect(PROVIDER_ICON_TILE_COLORS.composio).toBe("#111827");
    expect(PROVIDER_ICON_TILE_COLORS.dokploy).toBe("#111827");
  });
  it("has a brand mark for every infrastructure provider except the documented OpenAI fallback", () => {
    for (const id of INFRA_PROVIDER_IDS) {
      if (id === "openai-app") continue;
      expect(PROVIDER_ICON_PATHS[id] ?? PROVIDER_ICON_ASSETS[id], id).toBeTruthy();
    }
    expect(PROVIDER_ICON_PATHS["openai-app"]).toBeUndefined();
    expect(PROVIDER_ICON_ASSETS["openai-app"]).toBeUndefined();
  });
});
