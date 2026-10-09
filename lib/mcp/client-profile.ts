import type { McpToolProfile } from "./tool-contract";

function hostOf(value: string): string {
  try { return new URL(value).hostname.toLowerCase(); } catch { return ""; }
}

function isChatGptHost(host: string): boolean {
  return host === "chatgpt.com" || host.endsWith(".chatgpt.com");
}

export function detectMcpToolProfile(input: { clientId?: string; name?: string; redirectUris?: string[] }): McpToolProfile {
  const name = (input.name ?? "").toLowerCase();
  // Display/catalog hints never establish provider identity or download authority.
  if (name.includes("chatgpt") || name === "openai" || isChatGptHost(hostOf(input.clientId ?? "")) || (input.redirectUris ?? []).some(uri => isChatGptHost(hostOf(uri)))) return "chatgpt";
  return "full";
}
