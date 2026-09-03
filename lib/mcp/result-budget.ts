export const DEFAULT_MCP_RESULT_BYTES = 32 * 1024;
export const MAX_MCP_RESULT_BYTES = 128 * 1024;

function clampBudget(value?: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MCP_RESULT_BYTES;
  return Math.max(4 * 1024, Math.min(MAX_MCP_RESULT_BYTES, Math.trunc(value!)));
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (utf8Bytes(value) <= maxBytes) return value;
  let low = 0, high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (utf8Bytes(value.slice(0, mid)) <= maxBytes) low = mid;
    else high = mid - 1;
  }
  return value.slice(0, low);
}

export type McpResultBudget = {
  maxTextBytes?: number;
  overflowHint?: string;
};

/**
 * Bound the model-visible text fallback of a tool result. Large tool payloads
 * are one of the easiest ways to destroy agent context quality: the operation
 * succeeded, but its raw logs/file/list then crowd out the goal and plan.
 *
 * The original result object is left untouched for any explicit structured UI
 * projection. Only the generic text fallback is compacted here.
 */
export function boundedResultText(result: unknown, policy?: McpResultBudget): string {
  let raw: string;
  try {
    const encoded = typeof result === "string" ? result : JSON.stringify(result);
    raw = encoded === undefined ? "null" : encoded;
  } catch { raw = String(result); }
  const max = clampBudget(policy?.maxTextBytes);
  const bytes = utf8Bytes(raw);
  if (bytes <= max) return raw;

  const hint = (policy?.overflowHint || "Refine the request or use a narrower read/search call for the omitted details.")
    .replace(/[\r\n\t]+/g, " ").trim().slice(0, 320);
  // Leave room for the metadata envelope itself so the final fallback remains
  // close to the requested budget even with multibyte content.
  const previewBudget = Math.max(1024, max - 1024);
  const preview = truncateUtf8(raw, previewBudget);
  return JSON.stringify({
    msoTruncated: true,
    originalBytes: bytes,
    returnedPreviewBytes: utf8Bytes(preview),
    preview,
    hint,
  });
}
