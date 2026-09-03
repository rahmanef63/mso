import type { McpToolProfile } from "./tool-contract";

function hostOf(value: string): string {
  try { return new URL(value).hostname.toLowerCase(); } catch { return ""; }
}

export function detectMcpToolProfile(input: { clientId?: string; name?: string; redirectUris?: string[] }): McpToolProfile {
  const name = (input.name ?? "").toLowerCase();
  const clientHost = hostOf(input.clientId ?? "");
  const redirectHosts = (input.redirectUris ?? []).map(hostOf);
  if (name.includes("chatgpt") || name === "openai" || clientHost === "chatgpt.com" || clientHost.endsWith(".chatgpt.com") ||
      redirectHosts.some((host) => host === "chatgpt.com" || host.endsWith(".chatgpt.com"))) return "chatgpt";
  return "full";
}
