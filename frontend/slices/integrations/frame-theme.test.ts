import { describe, expect, it } from "vitest";
import { INTEGRATION_FRAME_TOKEN_MAP, integrationFrameTokens } from "./frame-theme";

describe("Integrations frame visual token bridge", () => {
  it("maps shell semantic palette/accent into the iframe without arbitrary CSS", () => {
    const source = new Map<string, string>([["--accent", " dynamic-accent "], ["--surface", " dynamic-surface "], ["--sidebar", " dynamic-sidebar "]]);
    expect(integrationFrameTokens((name) => source.get(name) ?? "")).toMatchObject({
      "--os-accent": "dynamic-accent",
      "--surface": "dynamic-surface",
      "--sidebar": "dynamic-sidebar",
    });
    expect(INTEGRATION_FRAME_TOKEN_MAP.some(([local]) => local === "--os-accent")).toBe(true);
  });

  it("drops missing values instead of manufacturing feature-local fallbacks", () => {
    expect(integrationFrameTokens(() => "")).toEqual({});
  });
});
