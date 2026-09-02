import { anthropicProviderUsage } from "./provider-usage.mjs";
import type Anthropic from "@anthropic-ai/sdk";

export function anthropicDonePayload(final: Anthropic.Message) {
  return {
    stopReason: final.stop_reason,
    usage: anthropicProviderUsage(final.usage),
  };
}
