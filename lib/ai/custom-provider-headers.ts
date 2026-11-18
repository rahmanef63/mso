/**
 * Outbound headers for an Anthropic-compatible gateway.
 *
 * `@anthropic-ai/sdk` v1 sends the key as `Authorization: Bearer` and defaults
 * `anthropic-version` to `2026-10-21`. Both are right against the first-party API.
 * A BYOK gateway commonly enforces the older `x-api-key` header and pins
 * `2023-06-01`, and answers 401 otherwise, which reaches the operator as a generic
 * provider failure with nothing pointing at the SDK bump.
 *
 * ONLY the custom-provider path overrides; the first-party host keeps the SDK
 * default so a future API version is picked up without a repo change.
 */
export const CUSTOM_ANTHROPIC_API_VERSION = "2023-06-01";

export function anthropicClientHeaders(customProvider: boolean, apiKey: string): { defaultHeaders?: Record<string, string> } {
  if (!customProvider) return {};
  return { defaultHeaders: { "x-api-key": apiKey, "anthropic-version": CUSTOM_ANTHROPIC_API_VERSION } };
}
