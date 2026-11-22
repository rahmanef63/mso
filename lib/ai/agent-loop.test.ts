import { expect, it, vi } from "vitest";
import { runToolAgent } from "./agent-loop";
import { streamAgentTurn } from "./stream";
import {
  formatTurnUsage,
  formatThreadUsage,
  formatUsageSummary,
} from "./turn-usage";

vi.mock("./stream", () => ({ streamAgentTurn: vi.fn() }));

it("stops between tool calls and retains matching tool results", async () => {
  vi.mocked(streamAgentTurn).mockResolvedValue({ text: "", stopReason: null, toolUses: [
    { id: "one", name: "fs.read", input: {} }, { id: "two", name: "fs.write", input: {} },
  ] });
  const ctrl = new AbortController();
  const invoke = vi.fn(async () => { ctrl.abort(); return { ok: true, result: "read" }; });
  const result = await runToolAgent([], [], invoke, { onDelta: vi.fn(), onTool: vi.fn() }, 8, undefined, ctrl.signal);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(result.outcome).toBe("stopped");
  expect(result.history.at(-1)).toMatchObject({ role: "tool", results: [{ id: "one" }, { id: "two", isError: true }] });
});

it("reports the turn cap as a limit instead of successful completion", async () => {
  vi.mocked(streamAgentTurn).mockResolvedValue({ text: "", stopReason: null, toolUses: [{ id: "one", name: "fs.read", input: {} }] });
  const result = await runToolAgent([], [], async () => ({ ok: true, result: "read" }), { onDelta: vi.fn(), onTool: vi.fn() }, 1);
  expect(result.outcome).toBe("limit");
});

it("aggregates usage across multiple turns with addProviderUsage", async () => {
  vi.mocked(streamAgentTurn)
    .mockResolvedValueOnce({
      text: "calling tool",
      stopReason: "tool_use",
      toolUses: [{ id: "t1", name: "fs.read", input: { path: "a.txt" } }],
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 15,
        accountingMode: "separate-cache-input-output",
        apiCalls: 1,
      },
    })
    .mockResolvedValueOnce({
      text: "done with tool",
      stopReason: "end_turn",
      toolUses: [],
      usage: {
        inputTokens: 50,
        outputTokens: 10,
        cacheReadTokens: 5,
        accountingMode: "separate-cache-input-output",
        apiCalls: 1,
      },
    });

  const invoke = vi.fn(async () => ({ ok: true, result: "content" }));
  const result = await runToolAgent([], [], invoke, { onDelta: vi.fn(), onTool: vi.fn() }, 8);

  expect(result.outcome).toBe("completed");
  expect(result.text).toBe("done with tool");
  expect(result.usage).toMatchObject({
    inputTokens: 150,
    outputTokens: 30,
    cacheReadTokens: 20,
    apiCalls: 2,
  });
});

it("leaves usage undefined if no turn returned usage", async () => {
  vi.mocked(streamAgentTurn).mockResolvedValueOnce({
    text: "done",
    stopReason: "end_turn",
    toolUses: [],
  });

  const result = await runToolAgent([], [], async () => ({ ok: true, result: "ok" }), { onDelta: vi.fn(), onTool: vi.fn() }, 1);
  expect(result.outcome).toBe("completed");
  expect(result.usage).toBeUndefined();
});

it("formats turn usage with cached tokens", () => {
  expect(formatTurnUsage({ inputTokens: 1200, outputTokens: 80, cacheReadTokens: 600 })).toBe(
    "this turn: 1,200 in / 80 out / 600 cached",
  );
});

it("formats turn usage without cached tokens when cacheReadTokens is absent", () => {
  expect(formatTurnUsage({ inputTokens: 100, outputTokens: 20 })).toBe(
    "this turn: 100 in / 20 out",
  );
});

it("formats thread total and summary cleanly", () => {
  expect(formatThreadUsage({ inputTokens: 5000, outputTokens: 350, cacheReadTokens: 2500 })).toBe(
    "thread total: 5,000 in / 350 out / 2,500 cached",
  );
  expect(
    formatUsageSummary(
      { inputTokens: 100, outputTokens: 20, cacheReadTokens: 10 },
      { inputTokens: 500, outputTokens: 100, cacheReadTokens: 50 },
    ),
  ).toBe("this turn: 100 in / 20 out / 10 cached · thread total: 500 in / 100 out / 50 cached");
});

it("returns empty string when usage is absent or null", () => {
  expect(formatTurnUsage(undefined)).toBe("");
  expect(formatTurnUsage(null)).toBe("");
  expect(formatThreadUsage(undefined)).toBe("");
  expect(formatUsageSummary(null, null)).toBe("");
});
