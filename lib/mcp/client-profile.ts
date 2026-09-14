import type { McpToolProfile } from "./tool-contract";

function hostOf(value: string): string {
  try { return new URL(value).hostname.toLowerCase(); } catch { return ""; }
}

function isChatGptHost(host: string): boolean {
  return host === "chatgpt.com" || host.endsWith(".chatgpt.com");
}

export function isTrustedOpenAiFileParamsClient(input: { clientId?: string; redirectUris?: string[] }): boolean {
  const clientHost = hostOf(input.clientId ?? "");
  const redirectHosts = (input.redirectUris ?? []).map(hostOf);
  return isChatGptHost(clientHost) || redirectHosts.some(isChatGptHost);
}

export function detectMcpToolProfile(input: { clientId?: string; name?: string; redirectUris?: string[] }): McpToolProfile {
  const name = (input.name ?? "").toLowerCase();
  if (name.includes("chatgpt") || name === "openai" || isTrustedOpenAiFileParamsClient(input)) return "chatgpt";
  return "full";
}
