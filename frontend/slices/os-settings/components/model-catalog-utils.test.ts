import { describe, expect, it } from "vitest";
import { filterAndSortModels, type CatModel } from "./model-catalog-utils";

const models: CatModel[] = [
  { ref: "free", id: "free-agent", context: 256000, inputCost: 0, outputCost: 0, free: true, agentReady: true, tools: true },
  { ref: "a", id: "cheap-tools", context: 128000, inputCost: 0.1, outputCost: 0.2, tools: true },
  { ref: "b", id: "expensive-vision", context: 1000000, inputCost: 10, outputCost: 30, vision: true },
  { ref: "c", id: "reasoner", context: 64000, inputCost: 1, outputCost: 1, reasoning: true },
  { ref: "unknown", id: "unknown-price", context: 128000, tools: true, free: false },
];

const none = { free: false, tools: false, reasoning: false, vision: false, minContext: 0 };

describe("model catalog filters", () => {
  it("filters by capabilities and context", () => {
    const got = filterAndSortModels(models, "", { ...none, tools: true, minContext: 128000 }, "best");
    expect(got.map((m) => m.id)).toEqual(expect.arrayContaining(["free-agent", "cheap-tools", "unknown-price"]));
  });

  it("filters Free using the server-provided strict free flag", () => {
    expect(filterAndSortModels(models, "", { ...none, free: true }, "price").map((m) => m.id)).toEqual(["free-agent"]);
  });

  it("sorts explicit zero-cost models first by price without treating unknown cost as free", () => {
    const sorted = filterAndSortModels(models, "", none, "price");
    expect(sorted[0].id).toBe("free-agent");
    expect(sorted.find((m) => m.id === "unknown-price")?.free).toBe(false);
  });
});
