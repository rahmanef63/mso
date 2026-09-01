const SECRET = /([\w.-]*(?:api[_-]?key|auth[_-]?token|access[_-]?key|secret[_-]?key|private[_-]?key|client[_-]?secret|token|secret|password|passwd|authorization|credential)s?)(["']?\s*[:=]\s*["']?)([^\s"',;)\]}]+)/gi;
const SECRET_VALUE = new RegExp([
  "gh[pousr]_[A-Za-z0-9]{16,}", "github_pat_[A-Za-z0-9_]{20,}",
  "sk-[A-Za-z0-9_-]{16,}", "npm_[A-Za-z0-9]{20,}", "xox[abprs]-[A-Za-z0-9-]{10,}",
  "AKIA[0-9A-Z]{16}", "eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}",
].map((shape) => `\\b${shape}`).join("|"), "g");
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/:@]+):([^\s/@]+)@/gi;

export function redactText(value: string, max = Number.POSITIVE_INFINITY): string {
  return value
    .replace(/\bbearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(URL_CREDENTIALS, "$1$2:[redacted]@")
    .replace(SECRET, "$1$2[redacted]")
    .replace(SECRET_VALUE, "[redacted]")
    .slice(0, max);
}


export function redactUnknown(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[depth-limit]";
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactUnknown(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (/(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|authorization|credential)/.test(lower)) {
      out[key] = "[redacted]";
      continue;
    }
    out[key] = redactUnknown(item, depth + 1);
  }
  return out;
}
