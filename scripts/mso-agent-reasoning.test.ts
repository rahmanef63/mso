import { describe, expect, it, vi } from "vitest";
import { reasoningLine, toggleReasoning } from "./mso-agent-reasoning.mjs";
import { agentRound } from "./mso-agent-turn.mjs";

function dummySession(overrides: Record<string, unknown> = {}) {
  return {
    history: [{ role: "user", text: "prompt" }],
    permission: "yolo",
    state: { tools: [], modelMeta: null },
    agentSession: { id: "s1", name: "test-agent" },
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    lastElapsedMs: 0,
    ...overrides,
  } as any;
}

describe("mso agent reasoning metrics", () => {
  it("returns null when provider usage is empty, null, or has null reasoning tokens", () => {
    expect(reasoningLine({})).toBeNull();
    expect(reasoningLine(null)).toBeNull();
    expect(reasoningLine({ reasoningTokens: null })).toBeNull();
    expect(reasoningLine({ reasoningTokens: undefined })).toBeNull();
    expect(reasoningLine({ reasoningTokens: 0 })).toBeNull();
  });

  it("includes reasoning tokens when present", () => {
    expect(reasoningLine({ reasoningTokens: 120 })).toBe("reasoning 120 tok");
    expect(reasoningLine({ reasoning_tokens: 45 })).toBe("reasoning 45 tok");
  });

  it("includes cache-read/cache-write only when present", () => {
    expect(reasoningLine({ reasoningTokens: 120, cacheReadTokens: 60 })).toBe("reasoning 120 tok · cache-read 60");
    expect(reasoningLine({ reasoningTokens: 120, cacheWriteTokens: 5 })).toBe("reasoning 120 tok · cache-write 5");
    expect(
      reasoningLine({
        reasoningTokens: 120,
        cacheReadTokens: 60,
        cacheWriteTokens: 5,
      }),
    ).toBe("reasoning 120 tok · cache-read 60 · cache-write 5");
    expect(
      reasoningLine({
        reasoningTokens: 120,
        cacheReadTokens: null,
        cacheWriteTokens: undefined,
      }),
    ).toBe("reasoning 120 tok");
    expect(
      reasoningLine({
        reasoningTokens: 120,
        cacheReadTokens: 60,
        detailCoverage: { reasoningTokens: 1, cacheReadTokens: 1 },
      }),
    ).toBe("reasoning 120 tok · cache-read 60");
    // When detail coverage marks cache absent, omit the metric even if an unverified key exists.
    expect(
      reasoningLine({
        reasoningTokens: 120,
        cacheReadTokens: 60,
        detailCoverage: { reasoningTokens: 1, cacheReadTokens: 0 },
      }),
    ).toBe("reasoning 120 tok");
  });

  it("never returns a string containing reasoning text or a fabricated block", () => {
    const payloads = [
      { reasoningTokens: 120, reasoningText: "thinking step 1" },
      { reasoningTokens: 120, thoughts: "let me analyze this" },
      { reasoningTokens: 120, content: "<thinking>hidden</thinking>" },
    ];
    for (const payload of payloads) {
      const line = reasoningLine(payload);
      expect(line).not.toBeNull();
      expect(line).not.toContain("reasoning text");
      expect(line).not.toContain("<thinking>");
      expect(line).not.toContain("thinking step");
      expect(line).not.toContain("analyze");
      expect(line).toBe("reasoning 120 tok");
    }
  });

  it("toggles showReasoning preference correctly", () => {
    // Default is on. First toggle turns it off.
    expect(toggleReasoning(undefined)).toBe(false);
    expect(toggleReasoning(true)).toBe(false);
    expect(toggleReasoning(false)).toBe(true);

    // Explicit on and off overrides.
    expect(toggleReasoning(false, "on")).toBe(true);
    expect(toggleReasoning(true, "off")).toBe(false);
    expect(toggleReasoning(undefined, "on")).toBe(true);
    expect(toggleReasoning(undefined, "off")).toBe(false);
  });

  it("prints reasoning line in agentRound only when enabled and not quiet", async () => {
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line?: unknown) => { printed.push(String(line ?? "")); });

    const streamWithReasoning = vi.fn(async () => ({
      text: "hello world\n",
      toolUses: [],
      usage: { reasoningTokens: 120, cacheReadTokens: 60 },
    }));

    // 1. Normal round: prints the reasoning line.
    await agentRound(null, dummySession(), null, undefined, null, {
      streamTurn: streamWithReasoning,
    });
    expect(printed.some((line) => line.includes("reasoning 120 tok · cache-read 60"))).toBe(true);

    // 2. Quiet mode: suppresses reasoning output.
    printed.length = 0;
    await agentRound(null, dummySession(), null, undefined, null, {
      quiet: true,
      streamTurn: streamWithReasoning,
    });
    expect(printed.some((line) => line.includes("reasoning 120 tok"))).toBe(false);

    // 3. showReasoning: false suppresses output even when quiet is false.
    printed.length = 0;
    await agentRound(null, dummySession({ showReasoning: false }), null, undefined, null, {
      quiet: false,
      streamTurn: streamWithReasoning,
    });
    expect(printed.some((line) => line.includes("reasoning 120 tok"))).toBe(false);

    // 4. Provider silent on reasoning: prints nothing.
    printed.length = 0;
    const streamWithoutReasoning = vi.fn(async () => ({
      text: "hello world\n",
      toolUses: [],
      usage: { inputTokens: 50, outputTokens: 10 },
    }));
    await agentRound(null, dummySession(), null, undefined, null, {
      quiet: false,
      streamTurn: streamWithoutReasoning,
    });
    expect(printed.some((line) => line.includes("reasoning"))).toBe(false);
  });
});
