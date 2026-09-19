import { describe, expect, it } from "vitest";
import { compactConsumedReadToolResults, modelHistoryBudget, projectHistoryForModel } from "./mso-agent-context.mjs";

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

  it("compacts consumed read results into replay handles but leaves write receipts intact", () => {
    const readCall = {
      role: "assistant",
      text: "",
      toolUses: [{ id: "r1", name: "fs_read", input: { path: "/repo/src/app.ts" } }],
    };
    const secret = "raw-secret-that-must-not-survive";
    const readResult = {
      role: "tool",
      results: [{
        id: "r1",
        content: JSON.stringify({
          path: "/repo/src/app.ts",
          sha256: "a".repeat(64),
          content: secret,
        }),
      }],
    };
    const writeCall = {
      role: "assistant",
      text: "",
      toolUses: [{ id: "w1", name: "fs_write", input: { path: "/repo/src/app.ts", content: "new" } }],
    };
    const writeResult = { role: "tool", results: [{ id: "w1", content: "write-receipt" }] };
    const history = [readCall, readResult, writeCall, writeResult];
    const compacted = compactConsumedReadToolResults(history, [
      { name: "fs_read", scope: "read" },
      { name: "fs_write", scope: "write" },
    ]);

    expect(compacted).toBe(1);
    const envelope = JSON.parse(String(readResult.results[0].content));
    expect(envelope).toMatchObject({
      msoReplay: true,
      handles: expect.arrayContaining([
        expect.objectContaining({ kind: "file", path: "/repo/src/app.ts", rereadWith: "read_pipeline" }),
      ]),
    });
    expect(JSON.stringify(readResult)).not.toContain(secret);
    expect(writeResult.results[0].content).toBe("write-receipt");
    expect(compactConsumedReadToolResults(history, [
      { name: "fs_read", scope: "read" },
      { name: "fs_write", scope: "write" },
    ])).toBe(0);
  });

});
