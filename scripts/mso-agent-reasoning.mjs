function finite(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function reasoningLine(usage) {
  if (!usage || typeof usage !== "object") return null;

  // The stream carries metrics, never reasoning text. When the provider is silent,
  // print nothing rather than fabricating a zero count.
  const reasoning = finite(usage.reasoningTokens ?? usage.reasoning_tokens);
  if (reasoning === undefined || reasoning <= 0) return null;

  const parts = [`reasoning ${reasoning} tok`];

  const cacheRead = finite(
    usage.cacheReadTokens ??
    usage.cache_read_tokens ??
    usage.cacheReadInputTokens ??
    usage.cache_read_input_tokens,
  );
  if (cacheRead !== undefined && (!usage.detailCoverage || usage.detailCoverage.cacheReadTokens)) {
    parts.push(`cache-read ${cacheRead}`);
  }

  const cacheWrite = finite(
    usage.cacheWriteTokens ??
    usage.cache_write_tokens ??
    usage.cacheCreationInputTokens ??
    usage.cache_creation_input_tokens,
  );
  if (cacheWrite !== undefined && (!usage.detailCoverage || usage.detailCoverage.cacheWriteTokens)) {
    parts.push(`cache-write ${cacheWrite}`);
  }

  return parts.join(" · ");
}

export function toggleReasoning(current, explicit) {
  const val = explicit != null ? String(explicit).trim().toLowerCase() : "";
  if (val === "off" || explicit === false) return false;
  if (val === "on" || explicit === true) return true;
  // Default is true when unset. Toggling inverts the current state.
  return current === false;
}
