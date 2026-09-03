const CHATGPT_ORIGIN = "https://chatgpt.com";

export function chatGptMcpLanding(
  slug: readonly string[] | undefined,
  rawRedirectUrl: string | string[] | undefined,
): string | null {
  if (slug?.length) return null;
  const redirectUrl = Array.isArray(rawRedirectUrl) ? rawRedirectUrl[0] : rawRedirectUrl;
  if (!redirectUrl) return null;
  try {
    const parsed = new URL(redirectUrl);
    if (parsed.origin !== CHATGPT_ORIGIN || !parsed.pathname.startsWith("/c/")) return null;
    return `/assistant/mcp?redirectUrl=${encodeURIComponent(parsed.href)}`;
  } catch {
    return null;
  }
}
