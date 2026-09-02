function finite(value) { if (value === null || value === undefined || value === "") return undefined; const n = Number(value); return Number.isFinite(n) ? n : undefined; }

export function modelFamily(value = "") {
  const raw = String(value).toLowerCase().trim();
  return raw.split("/").at(-1)?.replace(/^models\//, "") || raw;
}

function walk(value, visit, depth = 0) {
  if (depth > 8 || value == null) return null;
  const hit = visit(value); if (hit != null) return hit;
  if (Array.isArray(value)) for (const row of value) { const found = walk(row, visit, depth + 1); if (found != null) return found; }
  else if (typeof value === "object") for (const row of Object.values(value)) { const found = walk(row, visit, depth + 1); if (found != null) return found; }
  return null;
}

export function extractModelEvidence(value) {
  const model = walk(value, (row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    for (const key of ["model", "modelId", "model_id", "modelName", "model_name"]) if (typeof row[key] === "string" && row[key]) return row[key];
    return null;
  });
  let provider = walk(value, (row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    for (const key of ["provider", "providerId", "provider_id", "providerName", "provider_name"]) if (typeof row[key] === "string" && row[key]) return row[key];
    return null;
  });
  if (!provider && typeof model === "string" && model.includes("/")) provider = model.split("/")[0];
  return { model: model ?? null, modelFamily: model ? modelFamily(model) : null, provider: provider ? String(provider).toLowerCase() : null };
}


export function extractToolTelemetry(value) {
  return walk(value, (row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const calls = Array.isArray(row.toolCalls) ? row.toolCalls : Array.isArray(row.tool_calls) ? row.tool_calls : null;
    if (!calls) return null;
    const names = calls.map((call) => call?.name ?? call?.tool ?? call?.toolName).filter((name) => typeof name === "string");
    const failed = calls.filter((call) => call?.ok === false || call?.success === false || call?.isError === true).length;
    return { count: calls.length, names, failed };
  });
}

export function extractUsage(value) {
  return walk(value, (row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const input = finite(row.inputTokens ?? row.input_tokens ?? row.prompt_tokens ?? row.promptTokens);
    const output = finite(row.outputTokens ?? row.output_tokens ?? row.completion_tokens ?? row.completionTokens);
    const reasoning = finite(row.reasoningTokens ?? row.reasoning_tokens);
    const cacheRead = finite(row.cacheReadTokens ?? row.cache_read_tokens ?? row.cacheReadInputTokens ?? row.cache_read_input_tokens);
    const cacheWrite = finite(row.cacheWriteTokens ?? row.cache_write_tokens ?? row.cacheCreationInputTokens ?? row.cache_creation_input_tokens);
    const apiCalls = finite(row.apiCalls ?? row.api_calls);
    const total = finite(row.totalTokens ?? row.total_tokens);
    const explicitMode = typeof (row.accountingMode ?? row.accounting_mode) === "string" ? String(row.accountingMode ?? row.accounting_mode) : null;
    const explicitUsd = finite(row.estimatedCostUsd ?? row.estimated_cost_usd ?? row.costUsd ?? row.cost_usd);
    const currency = typeof (row.currency ?? row.costCurrency ?? row.cost_currency) === "string"
      ? String(row.currency ?? row.costCurrency ?? row.cost_currency).toLowerCase() : undefined;
    const genericCost = finite(row.estimated_cost ?? row.cost);
    const cost = explicitUsd ?? (currency === "usd" ? genericCost : undefined);
    const costStatus = typeof (row.costStatus ?? row.cost_status) === "string" ? String(row.costStatus ?? row.cost_status) : undefined;
    const costSource = typeof (row.costSource ?? row.cost_source) === "string" ? String(row.costSource ?? row.cost_source) : undefined;
    if (input === undefined && output === undefined && reasoning === undefined && total === undefined && cost === undefined) return null;

    let normalizedInput, normalizedOutput, normalizedTotal, accountingMode = "opaque-total", reportedAccountingMode = explicitMode || "unspecified", accountingProof = "none";
    if (input !== undefined && output !== undefined && (total !== undefined || explicitMode === "separate-cache-input-output")) {
      const detailSum = (cacheRead ?? 0) + (cacheWrite ?? 0) + (reasoning ?? 0);
      const exclusiveSum = input + output + detailSum;
      if (explicitMode === "inclusive-input-output-total") {
        normalizedInput = input; normalizedOutput = output; normalizedTotal = total; accountingMode = "inclusive-input-output-total"; accountingProof = "explicit-inclusive-contract";
      } else if (explicitMode === "separate-cache-input-output") {
        normalizedInput = input + (cacheRead ?? 0) + (cacheWrite ?? 0);
        normalizedOutput = output + (reasoning ?? 0); normalizedTotal = total ?? (normalizedInput + normalizedOutput);
        if (normalizedTotal === normalizedInput + normalizedOutput) { accountingMode = "inclusive-input-output-total"; accountingProof = "explicit-separate-components"; }
      } else if (((cacheRead ?? 0) + (cacheWrite ?? 0)) > 0 && total === input + output + (cacheRead ?? 0) + (cacheWrite ?? 0)) {
        // Hermes openai-codex shape observed in the live corpus: cache is outside base input,
        // while reasoning remains a detail already included in output. Exact arithmetic is required.
        normalizedInput = input + (cacheRead ?? 0) + (cacheWrite ?? 0);
        normalizedOutput = output; normalizedTotal = total;
        accountingMode = "inclusive-input-output-total"; reportedAccountingMode = "exclusive-cache-inclusive-output"; accountingProof = "exact-exclusive-cache-sum";
      } else if (detailSum > 0 && total === exclusiveSum) {
        // Alternate expanded representation where both cache and reasoning live outside base categories.
        normalizedInput = input + (cacheRead ?? 0) + (cacheWrite ?? 0);
        normalizedOutput = output + (reasoning ?? 0); normalizedTotal = total;
        accountingMode = "inclusive-input-output-total"; reportedAccountingMode = "exclusive-cache-reasoning"; accountingProof = "exact-exclusive-cache-reasoning-sum";
      } else if (total === input + output) {
        // No extra tokens live outside the provider's input/output categories.
        normalizedInput = input; normalizedOutput = output; normalizedTotal = total;
        accountingMode = "inclusive-input-output-total"; accountingProof = detailSum > 0 ? "exact-inclusive-total-identity" : "exact-input-output-identity";
        if (!explicitMode) reportedAccountingMode = detailSum > 0 ? "inclusive-expanded-components" : "input-output-total";
      }
    }
    const unattributed = normalizedTotal !== undefined && normalizedInput !== undefined && normalizedOutput !== undefined
      ? Math.max(0, normalizedTotal - normalizedInput - normalizedOutput) : undefined;
    return {
      ...(input !== undefined ? { inputTokens: input } : {}), ...(output !== undefined ? { outputTokens: output } : {}),
      ...(reasoning !== undefined ? { reasoningTokens: reasoning } : {}), ...(cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {}),
      ...(cacheWrite !== undefined ? { cacheWriteTokens: cacheWrite } : {}), ...(apiCalls !== undefined ? { apiCalls } : {}),
      ...(total !== undefined ? { totalTokens: total } : {}),
      ...(normalizedInput !== undefined ? { normalizedInputTokens: normalizedInput } : {}),
      ...(normalizedOutput !== undefined ? { normalizedOutputTokens: normalizedOutput } : {}),
      ...(normalizedTotal !== undefined ? { normalizedTotalTokens: normalizedTotal } : {}),
      ...(unattributed !== undefined ? { unattributedTokens: unattributed } : {}),
      ...(cost !== undefined ? { estimatedCostUsd: cost } : {}), ...(costStatus ? { costStatus } : {}), ...(costSource ? { costSource } : {}),
      reportedAccountingMode, accountingMode, accountingProof,
    };
  });
}

/**
 * @param {Array<any>} rows
 * @param {string} requestedFamily
 * @param {string | null} [requestedProvider]
 */
export function comparabilityLevel(rows, requestedFamily, requestedProvider = null) {
  const attempted = rows.filter((row) => row.attempted > 0);
  if (attempted.length < 2) return { level: "uncomparable", reason: "fewer than two agents produced corpus runs" };
  if (attempted.some((row) => row.modelEvidenceCoveragePct !== 100))
    return { level: "uncomparable", reason: "model/provider evidence must cover every attempted scenario" };
  if (attempted.some((row) => !row.modelEvidence?.modelFamily || row.modelEvidence.modelFamily !== modelFamily(requestedFamily)))
    return { level: "uncomparable", reason: "reported model-family evidence is missing or mismatched" };
  const providers = new Set(attempted.map((row) => row.modelEvidence?.provider).filter(Boolean));
  if (providers.size !== 1 || attempted.some((row) => !row.modelEvidence?.provider))
    return { level: "model-family", reason: "model family matches, but provider evidence is missing or differs" };
  const provider = [...providers][0];
  if (requestedProvider && provider !== String(requestedProvider).toLowerCase())
    return { level: "model-family", reason: `reported provider ${provider} does not match requested provider ${String(requestedProvider).toLowerCase()}` };
  return { level: "full", provider };
}

function pct(n, d) { return d ? Math.round((n / d) * 1000) / 10 : 0; }
function average(values, decimals = 1) { if (!values.length) return null; const scale = 10 ** decimals; return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * scale) / scale; }
function median(values) { if (!values.length) return null; const s = [...values].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10; }

export function aggregateAgent(agent, scenarios) {
  const full = scenarios.filter((row) => row.fullSuccess), task = scenarios.filter((row) => row.taskSuccess), policy = scenarios.filter((row) => row.policyCompliant);
  const usageRows = scenarios.filter((row) => row.usage?.normalizedTotalTokens !== undefined);
  const costRows = scenarios.filter((row) => row.usage?.estimatedCostUsd !== undefined);
  const toolRows = scenarios.filter((row) => row.toolTelemetry?.count !== undefined);
  const accountingModes = new Set(scenarios.map((row) => row.usage?.accountingMode).filter(Boolean));
  const accountingProofs = new Set(scenarios.map((row) => row.usage?.accountingProof).filter((value) => value && value !== "none"));
  const costStatuses = new Set(scenarios.map((row) => row.usage?.costStatus).filter(Boolean));
  const costSources = new Set(scenarios.map((row) => row.usage?.costSource).filter(Boolean));
  const evidenced = scenarios.filter((row) => row.modelEvidence?.modelFamily);
  const families = new Set(evidenced.map((row) => row.modelEvidence.modelFamily));
  const providers = new Set(evidenced.map((row) => row.modelEvidence.provider).filter(Boolean));
  const providerCoverage = evidenced.length > 0 && evidenced.every((row) => row.modelEvidence.provider);
  const modelEvidence = families.size === 1 ? {
    model: evidenced[0]?.modelEvidence?.model ?? null, modelFamily: [...families][0],
    provider: providerCoverage && providers.size === 1 ? [...providers][0] : null,
    consistent: families.size === 1 && providers.size <= 1,
  } : null;
  const tokenCoveragePct = pct(usageRows.length, scenarios.length), costCoveragePct = pct(costRows.length, scenarios.length);
  const totalReportedTokens = usageRows.reduce((sum, row) => sum + row.usage.normalizedTotalTokens, 0);
  const totalReportedCostUsd = costRows.reduce((sum, row) => sum + row.usage.estimatedCostUsd, 0);
  return {
    agent, attempted: scenarios.length, taskSuccesses: task.length, policyCompliant: policy.length, fullSuccesses: full.length,
    taskSuccessPct: pct(task.length, scenarios.length), policyCompliancePct: pct(policy.length, scenarios.length), fullSuccessPct: pct(full.length, scenarios.length),
    averageLatencyMs: average(scenarios.map((row) => row.latencyMs).filter(Number.isFinite)), p50LatencyMs: median(scenarios.map((row) => row.latencyMs).filter(Number.isFinite)),
    tokenCoveragePct, costCoveragePct,
    totalReportedTokens: usageRows.length ? totalReportedTokens : null,
    totalReportedCostUsd: costRows.length ? Math.round(totalReportedCostUsd * 1e9) / 1e9 : null,
    reportedTokensPerAttempt: usageRows.length ? average(usageRows.map((row) => row.usage.normalizedTotalTokens)) : null,
    reportedCostPerAttemptUsd: costRows.length ? average(costRows.map((row) => row.usage.estimatedCostUsd), 6) : null,
    toolTelemetryCoveragePct: pct(toolRows.length, scenarios.length),
    averageToolCallsPerTask: toolRows.length ? average(toolRows.map((row) => row.toolTelemetry.count)) : null,
    failedToolCalls: toolRows.reduce((sum, row) => sum + (row.toolTelemetry.failed || 0), 0),
    tokenAccountingMode: accountingModes.size === 1 ? [...accountingModes][0] : accountingModes.size ? "mixed" : "unknown",
    tokenAccountingProof: accountingProofs.size === 1 ? [...accountingProofs][0] : accountingProofs.size ? "mixed" : "unknown",
    costStatus: costStatuses.size === 1 ? [...costStatuses][0] : costStatuses.size ? "mixed" : "unknown",
    costSource: costSources.size === 1 ? [...costSources][0] : costSources.size ? "mixed" : "unknown",
    modelEvidenceCoveragePct: pct(evidenced.length, scenarios.length),
    tokensPerSuccessfulTask: tokenCoveragePct === 100 && full.length ? Math.round((totalReportedTokens / full.length) * 10) / 10 : null,
    costPerSuccessfulTaskUsd: costCoveragePct === 100 && full.length ? Math.round((totalReportedCostUsd / full.length) * 1e6) / 1e6 : null,
    modelEvidence, fullSuccess: full.length === scenarios.length,
  };
}

/** @param {Array<any>} aggregates @param {any} comparability @param {number | null | undefined} expectedScenarios */
export function eligibleRanking(aggregates, comparability, expectedScenarios = null) {
  if (comparability.level !== "full") return { eligible: false, reason: "overall ranking requires matching model-family and provider evidence" };
  if (aggregates.length < 2 || aggregates.some((row) => row.attempted < 1)) return { eligible: false, reason: "every compared agent must produce corpus results" };
  if (expectedScenarios != null && aggregates.some((row) => row.attempted !== expectedScenarios)) return { eligible: false, reason: "every compared agent must cover the same complete corpus" };
  const ordered = [...aggregates].sort((a, b) => b.fullSuccessPct - a.fullSuccessPct || b.policyCompliancePct - a.policyCompliancePct || (a.p50LatencyMs ?? Infinity) - (b.p50LatencyMs ?? Infinity) || (a.averageLatencyMs ?? Infinity) - (b.averageLatencyMs ?? Infinity));
  return { eligible: true, order: ordered.map((row) => row.agent), note: "Order prioritizes task success, then policy compliance, then p50/average latency as a descriptive tie-breaker. Efficiency stays a separate metric; token/cost values are comparable only when their independent accounting gates pass." };
}
