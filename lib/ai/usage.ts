import type Anthropic from "@anthropic-ai/sdk";

export function anthropicDonePayload(final: Anthropic.Message) {
  return {
    stopReason: final.stop_reason,
    usage: {
      inputTokens: final.usage.input_tokens,
      outputTokens: final.usage.output_tokens,
      cacheCreationInputTokens: final.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: final.usage.cache_read_input_tokens ?? 0,
    },
  };
}
