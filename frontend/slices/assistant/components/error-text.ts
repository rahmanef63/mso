// Turns an assistant failure into something the user can ACT on.
//
// Lifted out of chat-panel.tsx, which was at 218 effective lines against a 220
// warn ceiling — no room for the next branch, and this is the part that grows.
// Every branch here exists because the generic fallback sent someone to do the
// one thing that could not work.
export function errText(err: unknown): string {
  const code = err instanceof Error ? err.message : "";
  if (code.startsWith("no_api_key")) {
    const provider = code.split(":")[1] || "selected provider";
    return `No API key set for ${provider}. Add it in Settings → AI, then save and test that provider.`;
  }
  if (code === "unauthorized") return "Session expired. Sign in again.";
  // OUR OWN tripwire, not the provider's: /api/assistant allows 30 POSTs per minute
  // per device and one send spends up to 8 of them (runToolAgent's turn cap), so a
  // tool-heavy answer burns a quarter of the budget. Calling that "couldn't reach
  // the assistant" sent people straight back to Send — the one action that is
  // guaranteed not to work while the window is still open.
  if (code === "rate_limited" || code === "http_429")
    return "Too many requests in the last minute. An answer that uses tools costs several. Wait about a minute, then send again.";
  // The provider's own 429/5xx arrives as free text on the SSE `error` event, AFTER
  // the response already returned 200, so there is no status left to switch on.
  if (/rate.?limit|\b429\b|quota/i.test(code))
    return "Your AI provider is rate-limiting this key. Wait a moment, or switch provider in Settings → AI.";
  if (code.startsWith("http_5") || /overloaded|\b529\b/i.test(code))
    return "The AI provider is overloaded or down. Nothing on this box is broken. Retry shortly, or pick another model in Settings → AI.";
  if (code === "oauth_refresh_failed") return "Couldn't refresh the OpenAI Codex sign-in. Reconnect it in Settings → AI.";
  return "Couldn't reach the assistant. Try again.";
}
