import { describe, expect, it } from "vitest";
import { addProviderUsage, anthropicProviderUsage, chatCompletionsProviderUsage, responsesProviderUsage } from "./provider-usage.mjs";

describe("provider usage normalization", () => {
  it("keeps Responses cache/reasoning as inclusive details without double counting", () => {
    expect(responsesProviderUsage({ input_tokens: 100, input_tokens_details: { cached_tokens: 60, cache_write_tokens: 5 }, output_tokens: 20, output_tokens_details: { reasoning_tokens: 7 }, total_tokens: 120 })).toEqual({
      accountingMode: "inclusive-input-output-total", apiCalls: 1, inputTokens: 100, outputTokens: 20, totalTokens: 120,
      cacheReadTokens: 60, cacheWriteTokens: 5, reasoningTokens: 7,
      detailCoverage: { cacheReadTokens: 1, cacheWriteTokens: 1, reasoningTokens: 1 },
    });
  });

  it("keeps absent provider details absent rather than fabricating zero", () => {
    expect(responsesProviderUsage({ input_tokens: 10, output_tokens: 2, total_tokens: 12 })).toEqual({
      accountingMode: "inclusive-input-output-total", apiCalls: 1, inputTokens: 10, outputTokens: 2, totalTokens: 12,
    });
    expect(anthropicProviderUsage({ input_tokens: 10, output_tokens: 2 })).toEqual({
      accountingMode: "separate-cache-input-output", apiCalls: 1, inputTokens: 10, outputTokens: 2,
    });
  });

  it("does not seed an unknown provider total with zero during accumulation", () => {
    const out = addProviderUsage({ apiCalls: 0 }, anthropicProviderUsage({ input_tokens: 10, output_tokens: 2 }));
    expect(out).toEqual({ apiCalls: 1, inputTokens: 10, outputTokens: 2, accountingMode: "separate-cache-input-output" });
    expect(out.totalTokens).toBeUndefined();
  });

  it("normalizes Chat Completions detail fields with the same inclusive semantics", () => {
    expect(chatCompletionsProviderUsage({ prompt_tokens: 30, prompt_tokens_details: { cached_tokens: 20 }, completion_tokens: 6, completion_tokens_details: { reasoning_tokens: 4 }, total_tokens: 36 })).toMatchObject({
      accountingMode: "inclusive-input-output-total", inputTokens: 30, outputTokens: 6, totalTokens: 36, cacheReadTokens: 20, reasoningTokens: 4,
    });
  });

  it("accumulates calls while preserving detail coverage and mixed semantics", () => {
    const a = responsesProviderUsage({ input_tokens: 10, input_tokens_details: { cached_tokens: 3 }, output_tokens: 2, total_tokens: 12 });
    const b = responsesProviderUsage({ input_tokens: 20, input_tokens_details: { cached_tokens: 4 }, output_tokens: 3, total_tokens: 23 });
    expect(addProviderUsage(addProviderUsage(null, a), b)).toMatchObject({ apiCalls: 2, inputTokens: 30, outputTokens: 5, totalTokens: 35, cacheReadTokens: 7, accountingMode: "inclusive-input-output-total", detailCoverage: { cacheReadTokens: 2 } });
    expect(addProviderUsage(a, anthropicProviderUsage({ input_tokens: 1, output_tokens: 1 }))).toMatchObject({ accountingMode: "mixed" });
  });
});
