import { describe, expect, it } from "vitest";
import { modelHistoryBudget, projectHistoryForModel } from "./mso-agent-context.mjs";

describe("MSO model context projection", () => {
  it("reserves provider-neutral headroom instead of filling the whole context window", () => {
    expect(modelHistoryBudget(32_000)).toBe(17_600);
    expect(modelHistoryBudget(128_000)).toBe(70_400);
    expect(modelHistoryBudget(1_000_000)).toBe(120_000);
    expect(modelHistoryBudget(128_000, 8_000)).toBe(8_000);
    expect(modelHistoryBudget(8_000, 24_000)).toBe(16_000);
  });

  it("keeps recent context while omitting old bulk", () => {
    const history = Array.from({ length: 80 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `${i}:${"x".repeat(4000)}` }));
    const out = projectHistoryForModel(history, 32_000);
    expect(out.messages.length).toBeLessThan(history.length);
    expect(out.messages.at(-1)).toEqual(history.at(-1));
    expect(out.estimatedTokens).toBeLessThanOrEqual(out.budgetTokens + 2_000);
    expect(out.omittedRows).toBeGreaterThan(0);
  });

  it("never splits an assistant tool call from its following tool result", () => {
    const old = Array.from({ length: 30 }, (_, i) => ({ role: "user", text: `${i}${"x".repeat(3000)}` }));
    const call = { role: "assistant", text: "", toolUses: [{ id: "c1", name: "sys_stats", input: {} }] };
    const result = { role: "tool", results: [{ id: "c1", content: "ok" }] };
    const out = projectHistoryForModel([...old, call, result], 32_000);
    expect(out.messages.slice(-2)).toEqual([call, result]);
  });
});
