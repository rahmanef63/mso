import { describe, expect, it } from "vitest";
import { PROVIDERS } from "./registry.js";
import {
  isFreeModel,
  providerCatalogId,
  providerSummariesFromCatalog,
  runtimeProviderModels,
} from "./discovery.js";

describe("dynamic provider discovery", () => {
  it("only treats explicit numeric zero input+output pricing as free", () => {
    expect(isFreeModel({ cost: { input: 0, output: 0 } })).toBe(true);
    expect(isFreeModel({ cost: { input: 0, output: 1 } })).toBe(false);
    expect(isFreeModel({ cost: { input: 0 } })).toBe(false);
    expect(isFreeModel({})).toBe(false);
    expect(isFreeModel({ cost: { input: "0", output: "0" } })).toBe(false);
  });

  it("uses registry catalogId mappings instead of assuming runtime id equals catalog id", () => {
    expect(providerCatalogId("glm")).toBe("zhipuai");
    expect(providerCatalogId("vercel-gateway")).toBe("vercel");
    const catalog = { zhipuai: { models: { "glm-test": { cost: { input: 0, output: 0 }, tool_call: true } } } };
    expect(runtimeProviderModels(catalog, "glm").map((row) => row.id)).toEqual(["glm-test"]);
  });

  it("summarizes free and agent-ready free models without guessing unknown prices", () => {
    const catalog = {
      opencode: {
        name: "OpenCode Zen",
        models: {
          paid: { cost: { input: 1, output: 2 }, tool_call: true },
          "z-free": { cost: { input: 0, output: 0 }, tool_call: false },
          "a-free-agent": { cost: { input: 0, output: 0 }, tool_call: true },
          unknown: { tool_call: true },
        },
      },
    };
    const row = providerSummariesFromCatalog(catalog).find((p) => p.id === "opencode");
    expect(row).toMatchObject({
      name: "OpenCode Zen",
      modelCount: 4,
      freeModelCount: 2,
      freeAgentModelCount: 1,
      recommendedFreeModel: "a-free-agent",
    });
  });

  it("keeps pinned providers discoverable offline without claiming they are free", () => {
    const rows = providerSummariesFromCatalog({});
    expect(rows.find((row) => row.id === "opencode")).toMatchObject({ modelCount: 0, freeModelCount: 0, freeAgentModelCount: 0 });
    expect(providerSummariesFromCatalog({}, { freeOnly: true })).toEqual([]);
  });

  it("registers OpenCode Zen as a pinned OpenAI-compatible provider", () => {
    expect(PROVIDERS.opencode).toMatchObject({
      baseUrl: "https://opencode.ai/zen/v1",
      protocol: "openai",
      catalogId: "opencode",
    });
    expect(PROVIDERS.opencode.envVars).toContain("OPENCODE_API_KEY");
  });
});
