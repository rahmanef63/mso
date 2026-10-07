const SECRET_KEY = /^(secrets?|secretValue|password|passphrase|token|apiKey|apiToken|accessToken|refreshToken|authorization|headers|cookie|cookies)$/i;

/** Include short strings and structured/scalar secrets; receipt keys are not a trust boundary. */
export function receiptRedactor(values: unknown[]) {
  const scalars = new Set<unknown>();
  const textValues = new Set<string>();
  function collect(value: unknown, depth = 0): void {
    if (depth > 32) return;
    if (value && typeof value === "object") {
      textValues.add(JSON.stringify(value));
      for (const child of Object.values(value)) collect(child, depth + 1);
    } else {
      scalars.add(value);
      if (typeof value === "string" ? value.length > 0 : value !== undefined) textValues.add(String(value));
    }
  }
  values.forEach(value => collect(value));
  const literals = [...textValues].sort((a, b) => b.length - a.length);
  const pattern = literals.length ? new RegExp(literals.map(value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g") : null;
  const text = (value: string) => pattern ? value.replace(pattern, "[REDACTED]") : value;
  function redact(value: unknown, depth = 0): unknown {
    if (depth > 14) return "[TRUNCATED]";
    if (scalars.has(value)) return "[REDACTED]";
    if (typeof value === "string") return text(value);
    if (Array.isArray(value)) return value.map(child => redact(child, depth + 1));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) =>
      [text(key), SECRET_KEY.test(key) ? "[REDACTED]" : redact(child, depth + 1)]));
    return value;
  }
  return { text, value: redact };
}
