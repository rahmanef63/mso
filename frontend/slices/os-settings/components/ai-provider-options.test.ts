import { describe, expect, it } from "vitest";
import { groupProviderOptions, suggestedProviderModel, type ProviderSummary } from "./ai-provider-options";

const rows: ProviderSummary[] = [
  { id: "paid", name: "Paid", catalogId: "paid", modelCount: 3, freeModelCount: 0, freeAgentModelCount: 0, recommendedFreeModel: null },
  { id: "free", name: "Free", catalogId: "free", modelCount: 5, freeModelCount: 2, freeAgentModelCount: 1, recommendedFreeModel: "agent-free" },
];

describe("AI provider options", () => {
  it("separates providers with agent-ready free models from other providers", () => {
    const grouped = groupProviderOptions(rows);
    expect(grouped.free.map((row) => row.id)).toEqual(["free"]);
    expect(grouped.other.map((row) => row.id)).toEqual(["paid"]);
  });

  it("prefers the live recommended free model and otherwise preserves the caller fallback", () => {
    expect(suggestedProviderModel(rows, "free", "fallback")).toBe("agent-free");
    expect(suggestedProviderModel(rows, "paid", "fallback")).toBe("fallback");
  });
});
