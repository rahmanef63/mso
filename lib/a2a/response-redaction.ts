/** Peer data may echo credentials in values, object keys, or JSON-RPC errors. */
export function a2aResponseRedactor(auth: Record<string, string>) {
  const secrets = [...new Set(Object.values(auth).flatMap((value) => [value, value.replace(/^Bearer\s+/i, "")]).filter(Boolean))].sort((a, b) => b.length - a.length);
  const redact = (value: unknown): unknown => {
    if (typeof value === "string") return secrets.reduce((text, secret) => text.split(secret).join("[redacted]"), value);
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [String(redact(key)), redact(item)]));
    return value;
  };
  return redact;
}
