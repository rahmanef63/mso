import { describe, expect, it } from "vitest";
import { aggregateAgent, comparabilityLevel, eligibleRanking, extractModelEvidence, extractToolTelemetry, extractUsage } from "./bench-agent-metrics.mjs";
import { summarizeCorpus } from "./bench-agent-corpus.mjs";

describe("agent-quality accounting metrics", () => {
  it("keeps missing usage and cost unknown rather than converting null to zero", () => {
    expect(extractUsage({ usage: { input_tokens: null, output_tokens: null, cost_usd: null } })).toBeNull();
    expect(extractUsage({ usage: { input_tokens: 10, output_tokens: 5 } })).toMatchObject({ inputTokens: 10, outputTokens: 5, reportedAccountingMode: "unspecified", accountingMode: "opaque-total", accountingProof: "none" });
    expect(extractUsage({ usage: { input_tokens: 10, output_tokens: 5 } })?.totalTokens).toBeUndefined();
    expect(extractUsage({ input_tokens: 10, output_tokens: 5, reasoning_tokens: 7, total_tokens: 22, cache_read_tokens: 3, cost_status: "estimated", cost_source: "catalog" })).toMatchObject({ reasoningTokens: 7, cacheReadTokens: 3, accountingMode: "opaque-total", costStatus: "estimated", costSource: "catalog" });
  });

  it("extracts model/provider evidence but withholds full comparability when provider differs", () => {
    expect(extractModelEvidence({ model: "openai-codex/gpt-5.6-terra" })).toMatchObject({ modelFamily: "gpt-5.6-terra", provider: "openai-codex" });
    const rows = [
      { agent: "mso", attempted: 6, modelEvidenceCoveragePct: 100, modelEvidence: { modelFamily: "gpt-5.6-terra", provider: "openai-codex" } },
      { agent: "hermes", attempted: 6, modelEvidenceCoveragePct: 100, modelEvidence: { modelFamily: "gpt-5.6-terra", provider: "openai" } },
    ];
    expect(comparabilityLevel(rows, "gpt-5.6-terra").level).toBe("model-family");
    expect(eligibleRanking(rows, { level: "model-family" }, 6).eligible).toBe(false);
  });

  it("allows ranking failed agents only when same model/provider evidence and equal corpus coverage are proven", () => {
    const aggregates = [
      { agent: "mso", attempted: 6, fullSuccessPct: 100, policyCompliancePct: 100, p50LatencyMs: 100, averageLatencyMs: 100, modelEvidenceCoveragePct: 100, modelEvidence: { modelFamily: "x", provider: "p" } },
      { agent: "other", attempted: 6, fullSuccessPct: 50, policyCompliancePct: 100, p50LatencyMs: 80, averageLatencyMs: 80, modelEvidenceCoveragePct: 100, modelEvidence: { modelFamily: "x", provider: "p" } },
    ];
    const comp = comparabilityLevel(aggregates, "x", "p"); expect(comp.level).toBe("full");
    expect(eligibleRanking(aggregates, comp, 6)).toMatchObject({ eligible: true, order: ["mso", "other"] });
    expect(eligibleRanking([{ ...aggregates[0], attempted: 5 }, aggregates[1]], comp, 6).eligible).toBe(false);
  });

  it("aggregates token/cost only from rows that actually report them", () => {
    const rows = [
      { fullSuccess: true, taskSuccess: true, policyCompliant: true, latencyMs: 10, usage: { totalTokens: 100, normalizedTotalTokens: 100, accountingMode: "inclusive-input-output-total", estimatedCostUsd: 0.01 }, modelEvidence: { model: "p/x", modelFamily: "x", provider: "p" } },
      { fullSuccess: true, taskSuccess: true, policyCompliant: true, latencyMs: 20, usage: null, modelEvidence: { model: "p/x", modelFamily: "x", provider: "p" } },
    ];
    const out = aggregateAgent("mso", rows);
    expect(out.tokenCoveragePct).toBe(50); expect(out.costCoveragePct).toBe(50);
    expect(out.reportedTokensPerAttempt).toBe(100); expect(out.reportedCostPerAttemptUsd).toBe(0.01);
    expect(out.tokensPerSuccessfulTask).toBeNull(); expect(out.costPerSuccessfulTaskUsd).toBeNull();
  });

  it("extracts optional tool telemetry without inventing it for runners that do not report calls", () => {
    expect(extractToolTelemetry({ toolCalls: [{ name: "fs_read", ok: true }, { name: "fs_write", ok: false }] })).toEqual({ count: 2, names: ["fs_read", "fs_write"], failed: 1 });
    expect(extractToolTelemetry({ text: "no telemetry" })).toBeNull();
  });

  it("requires complete evidence and the requested provider before full comparability", () => {
    const base = { attempted: 2, modelEvidenceCoveragePct: 100, modelEvidence: { modelFamily: "x", provider: "p" } };
    expect(comparabilityLevel([{ agent: "a", ...base }, { agent: "b", ...base }], "x", "p").level).toBe("full");
    expect(comparabilityLevel([{ agent: "a", ...base }, { agent: "b", ...base, modelEvidenceCoveragePct: 50 }], "x", "p").level).toBe("uncomparable");
    expect(comparabilityLevel([{ agent: "a", ...base }, { agent: "b", ...base }], "x", "other").level).toBe("model-family");
  });

  it("charges failed-attempt tokens into tokens-per-success when coverage is complete", () => {
    const rows = [
      { fullSuccess: true, taskSuccess: true, policyCompliant: true, latencyMs: 10, usage: { totalTokens: 100, normalizedTotalTokens: 100, accountingMode: "inclusive-input-output-total" }, modelEvidence: { model: "p/x", modelFamily: "x", provider: "p" } },
      { fullSuccess: false, taskSuccess: false, policyCompliant: true, latencyMs: 20, usage: { totalTokens: 300, normalizedTotalTokens: 300, accountingMode: "inclusive-input-output-total" }, modelEvidence: { model: "p/x", modelFamily: "x", provider: "p" } },
    ];
    const out = aggregateAgent("mso", rows);
    expect(out.tokenCoveragePct).toBe(100); expect(out.totalReportedTokens).toBe(400); expect(out.tokensPerSuccessfulTask).toBe(400);
  });

  it("keeps ambiguous generic cost unknown unless currency is explicitly USD", () => {
    expect(extractUsage({ total_tokens: 10, cost: 0.1 })).toMatchObject({ totalTokens: 10 });
    expect(extractUsage({ total_tokens: 10, cost: 0.1 })?.estimatedCostUsd).toBeUndefined();
    expect(extractUsage({ total_tokens: 10, cost: 0.1, currency: "USD" })?.estimatedCostUsd).toBe(0.1);
  });

  it("derives a canonical total for explicit separate-component semantics without inventing a raw provider total", () => {
    const usage = extractUsage({ inputTokens: 10, outputTokens: 2, cacheReadTokens: 3, accountingMode: "separate-cache-input-output" })!;
    expect(usage.totalTokens).toBeUndefined();
    expect(usage).toMatchObject({ normalizedInputTokens: 13, normalizedOutputTokens: 2, normalizedTotalTokens: 15, accountingMode: "inclusive-input-output-total", accountingProof: "explicit-separate-components" });
  });

  it("normalizes exact Hermes-style exclusive components to the same canonical token semantics as MSO", () => {
    const mso = extractUsage({ inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheReadTokens: 60, reasoningTokens: 7, accountingMode: "inclusive-input-output-total" })!;
    const hermes = extractUsage({ input_tokens: 40, cache_read_tokens: 60, cache_write_tokens: 0, output_tokens: 20, reasoning_tokens: 7, total_tokens: 120 })!;
    expect(mso).toMatchObject({ accountingMode: "inclusive-input-output-total", accountingProof: "explicit-inclusive-contract", normalizedInputTokens: 100, normalizedOutputTokens: 20, normalizedTotalTokens: 120 });
    expect(hermes).toMatchObject({ reportedAccountingMode: "exclusive-cache-inclusive-output", accountingMode: "inclusive-input-output-total", accountingProof: "exact-exclusive-cache-sum", normalizedInputTokens: 100, normalizedOutputTokens: 20, normalizedTotalTokens: 120 });
    const rows = [
      { agent: "a", scenarioId: "x", fullSuccess: true, taskSuccess: true, policyCompliant: true, latencyMs: 10, usage: mso, modelEvidence: { modelFamily: "x", provider: "p" } },
      { agent: "b", scenarioId: "x", fullSuccess: true, taskSuccess: true, policyCompliant: true, latencyMs: 12, usage: hermes, modelEvidence: { modelFamily: "x", provider: "p" } },
    ];
    expect(summarizeCorpus(rows as any, { model: "x", provider: "p" }).efficiencyComparability.tokenSemanticsComparable).toBe(true);
  });

  it("keeps token semantics comparable when valid normalized proof shapes vary across scenarios", () => {
    const explicit = extractUsage({ inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheReadTokens: 0, accountingMode: "inclusive-input-output-total" })!;
    const identity = extractUsage({ input_tokens: 100, output_tokens: 20, total_tokens: 120, cache_read_tokens: 0 })!;
    const cached = extractUsage({ input_tokens: 40, cache_read_tokens: 60, output_tokens: 20, total_tokens: 120 })!;
    const rows = [
      { agent: "a", scenarioId: "x", fullSuccess: true, taskSuccess: true, policyCompliant: true, latencyMs: 10, usage: explicit, modelEvidence: { modelFamily: "x", provider: "p" } },
      { agent: "b", scenarioId: "x", fullSuccess: true, taskSuccess: true, policyCompliant: true, latencyMs: 12, usage: identity, modelEvidence: { modelFamily: "x", provider: "p" } },
      { agent: "a", scenarioId: "y", fullSuccess: true, taskSuccess: true, policyCompliant: true, latencyMs: 11, usage: explicit, modelEvidence: { modelFamily: "x", provider: "p" } },
      { agent: "b", scenarioId: "y", fullSuccess: true, taskSuccess: true, policyCompliant: true, latencyMs: 13, usage: cached, modelEvidence: { modelFamily: "x", provider: "p" } },
    ];
    const out = summarizeCorpus(rows as any, { model: "x", provider: "p" });
    expect(out.aggregates.find((row: any) => row.agent === "b")?.tokenAccountingProof).toBe("mixed");
    expect(out.efficiencyComparability.tokenSemanticsComparable).toBe(true);
  });

  it("can also normalize an exact representation where reasoning is outside output", () => {
    const usage = extractUsage({ input_tokens: 40, cache_read_tokens: 60, output_tokens: 13, reasoning_tokens: 7, total_tokens: 120 })!;
    expect(usage).toMatchObject({ reportedAccountingMode: "exclusive-cache-reasoning", accountingProof: "exact-exclusive-cache-reasoning-sum", normalizedInputTokens: 100, normalizedOutputTokens: 20, normalizedTotalTokens: 120 });
  });

  it("does not treat two equally opaque totals as comparable semantics", () => {
    const opaque = extractUsage({ input_tokens: 10, output_tokens: 5, cache_read_tokens: 3, reasoning_tokens: 7, total_tokens: 22 })!;
    const rows = [
      { agent: "a", scenarioId: "x", fullSuccess: true, taskSuccess: true, policyCompliant: true, latencyMs: 10, usage: opaque, modelEvidence: { modelFamily: "x", provider: "p" } },
      { agent: "b", scenarioId: "x", fullSuccess: true, taskSuccess: true, policyCompliant: true, latencyMs: 12, usage: opaque, modelEvidence: { modelFamily: "x", provider: "p" } },
    ];
    expect(summarizeCorpus(rows as any, { model: "x", provider: "p" }).efficiencyComparability.tokenSemanticsComparable).toBe(false);
  });

  it("withholds token comparability when expanded-component arithmetic does not prove the representation", () => {
    const ambiguous = extractUsage({ input_tokens: 10, output_tokens: 5, cache_read_tokens: 3, reasoning_tokens: 7, total_tokens: 22 })!;
    expect(ambiguous.accountingMode).toBe("opaque-total");
  });
});
