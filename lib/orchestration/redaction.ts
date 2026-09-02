const QUERY_SECRET = /([?&](?:token|key|secret|password|code)=)[^&\s]+/gi;
const KEY_VALUE_SECRET = /\b(password|token|secret|api[_-]?key|authorization)\s*[:=]\s*\S+/gi;
const PREFIX_SECRET = /\b(?:bearer\s+)?(?:sk|pk|ghp|github_pat|mso_mcp)_[a-z0-9_-]{8,}\b/gi;
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

export function redactText(value: string, max = 4000): string {
  let out = value
    .replace(QUERY_SECRET, "$1[redacted]")
    .replace(KEY_VALUE_SECRET, "$1=[redacted]")
    .replace(PREFIX_SECRET, "[redacted]")
    .replace(PRIVATE_KEY, "[redacted-private-key]")
    .trim();
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

export function redactStrings(values: unknown, maxItems = 40, maxLength = 800): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => redactText(value, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

export function containsLikelySecret(value: string): boolean {
  for (const pattern of [QUERY_SECRET, KEY_VALUE_SECRET, PREFIX_SECRET, PRIVATE_KEY]) {
    pattern.lastIndex = 0;
    if (pattern.test(value)) return true;
  }
  return false;
}
