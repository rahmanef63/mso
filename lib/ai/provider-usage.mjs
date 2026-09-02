function finite(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function put(out, key, value) {
  const n = finite(value);
  if (n !== undefined) out[key] = n;
}

function coverage(keys) {
  const out = {};
  for (const [name, value] of keys) if (finite(value) !== undefined) out[name] = 1;
  return Object.keys(out).length ? out : undefined;
}

/** OpenAI Responses usage: cache/reasoning details are subsets of input/output. */
export function responsesProviderUsage(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = { accountingMode: "inclusive-input-output-total", apiCalls: 1 };
  put(out, "inputTokens", raw.input_tokens);
  put(out, "outputTokens", raw.output_tokens);
  put(out, "totalTokens", raw.total_tokens);
  put(out, "cacheReadTokens", raw.input_tokens_details?.cached_tokens);
  put(out, "cacheWriteTokens", raw.input_tokens_details?.cache_write_tokens);
  put(out, "reasoningTokens", raw.output_tokens_details?.reasoning_tokens);
  const detailCoverage = coverage([
    ["cacheReadTokens", raw.input_tokens_details?.cached_tokens],
    ["cacheWriteTokens", raw.input_tokens_details?.cache_write_tokens],
    ["reasoningTokens", raw.output_tokens_details?.reasoning_tokens],
  ]);
  if (detailCoverage) out.detailCoverage = detailCoverage;
  return out;
}

/** OpenAI-compatible Chat Completions usage uses the same inclusive category semantics. */
export function chatCompletionsProviderUsage(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = { accountingMode: "inclusive-input-output-total", apiCalls: 1 };
  put(out, "inputTokens", raw.prompt_tokens);
  put(out, "outputTokens", raw.completion_tokens);
  put(out, "totalTokens", raw.total_tokens);
  put(out, "cacheReadTokens", raw.prompt_tokens_details?.cached_tokens);
  put(out, "cacheWriteTokens", raw.prompt_tokens_details?.cache_write_tokens);
  put(out, "reasoningTokens", raw.completion_tokens_details?.reasoning_tokens);
  const detailCoverage = coverage([
    ["cacheReadTokens", raw.prompt_tokens_details?.cached_tokens],
    ["cacheWriteTokens", raw.prompt_tokens_details?.cache_write_tokens],
    ["reasoningTokens", raw.completion_tokens_details?.reasoning_tokens],
  ]);
  if (detailCoverage) out.detailCoverage = detailCoverage;
  return out;
}

/** Anthropic reports cache reads/creation as separate input categories. */
export function anthropicProviderUsage(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = { accountingMode: "separate-cache-input-output", apiCalls: 1 };
  put(out, "inputTokens", raw.input_tokens);
  put(out, "outputTokens", raw.output_tokens);
  put(out, "cacheReadTokens", raw.cache_read_input_tokens);
  put(out, "cacheWriteTokens", raw.cache_creation_input_tokens);
  const detailCoverage = coverage([
    ["cacheReadTokens", raw.cache_read_input_tokens],
    ["cacheWriteTokens", raw.cache_creation_input_tokens],
  ]);
  if (detailCoverage) out.detailCoverage = detailCoverage;
  return out;
}

const SUM_FIELDS = ["inputTokens", "outputTokens", "totalTokens", "cacheReadTokens", "cacheWriteTokens", "reasoningTokens"];
const ALIASES = {
  inputTokens: ["inputTokens", "input_tokens", "prompt_tokens"],
  outputTokens: ["outputTokens", "output_tokens", "completion_tokens"],
  totalTokens: ["totalTokens", "total_tokens"],
  cacheReadTokens: ["cacheReadTokens", "cache_read_tokens", "cacheReadInputTokens", "cache_read_input_tokens"],
  cacheWriteTokens: ["cacheWriteTokens", "cache_write_tokens", "cacheCreationInputTokens", "cache_creation_input_tokens"],
  reasoningTokens: ["reasoningTokens", "reasoning_tokens"],
};
function metric(row, key) {
  for (const alias of ALIASES[key]) { const value = finite(row?.[alias]); if (value !== undefined) return value; }
  return undefined;
}

/** Accumulate provider-reported calls without inventing missing component values. */
export function addProviderUsage(total, next) {
  if (!next || typeof next !== "object") return total ?? { apiCalls: 0 };
  const base = total && typeof total === "object" ? total : { apiCalls: 0 };
  const out = { apiCalls: (finite(base.apiCalls) ?? 0) + (finite(next.apiCalls) ?? 1) };
  for (const key of SUM_FIELDS) {
    const a = metric(base, key), b = metric(next, key);
    if (a !== undefined || b !== undefined) out[key] = (a ?? 0) + (b ?? 0);
  }
  const modes = [base.accountingMode, next.accountingMode].filter(Boolean);
  if (modes.length) out.accountingMode = new Set(modes).size === 1 ? modes[0] : "mixed";
  const cov = {};
  for (const key of ["cacheReadTokens", "cacheWriteTokens", "reasoningTokens"]) {
    const a = finite(base.detailCoverage?.[key]) ?? 0;
    const b = finite(next.detailCoverage?.[key]) ?? (metric(next, key) !== undefined ? finite(next.apiCalls) ?? 1 : 0);
    if (a || b) cov[key] = a + b;
  }
  if (Object.keys(cov).length) out.detailCoverage = cov;
  return out;
}
