import { describe, expect, it } from "vitest";
import { buildCachePlan, buildSharedPrefix, parseCacheArgs, summarizeCacheRows } from "./bench-agent-cache.mjs";
import { describeObservedRuns } from "./bench-agent-repeat-metrics.mjs";

function usage(agent: string, cacheReadTokens: number | undefined, cost = false) {
  return {
    normalizedTotalTokens: agent === "mso" ? 100 : 200,
    accountingMode: "inclusive-input-output-total", accountingProof: agent === "mso" ? "explicit-inclusive-contract" : "exact-exclusive-cache-sum",
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cost ? { estimatedCostUsd: 0.1, costStatus: "billed", costSource: "provider-usd" } : {}),
  };
}
function row(agent: string, round: number, cache: number | undefined, cost = false) {
  return {
    agent, round, scenarioId: `cache-round-${round + 1}`, taskClass: "cache-calibration", approvalScope: "read", exitCode: 0, latencyMs: agent === "mso" ? 10 : 12,
    taskSuccess: true, policyCompliant: true, fullSuccess: true, verification: { taskSuccess: true, policyCompliant: true },
    modelEvidence: { model: agent === "mso" ? "openai-codex/x" : "x", modelFamily: "x", provider: "openai-codex" }, usage: usage(agent, cache, cost), toolTelemetry: null,
  };
}

describe("P8 calibration", () => {
  it("describes observed run spread without fabricating dispersion for one value", () => {
    expect(describeObservedRuns([10, 20, 30])).toEqual({ count: 3, min: 10, max: 30, mean: 20, median: 20, range: 20, sampleStdDev: 10, coefficientOfVariationPct: 50 });
    expect(describeObservedRuns([7])).toMatchObject({ count: 1, mean: 7, sampleStdDev: null, coefficientOfVariationPct: null });
  });

  it("builds one identical bounded shared prefix and rotates starting agent by round", () => {
    const opts = parseCacheArgs(["--rounds", "3", "--prefix-chars", "4096", "--seed", "cache-seed", "--agents", "mso,hermes"]);
    const plan = buildCachePlan(opts);
    expect(buildSharedPrefix("cache-seed", 4096)).toHaveLength(4096);
    expect(plan.map((x) => x.agent)).toEqual(["mso", "hermes", "hermes", "mso", "mso", "hermes"]);
    expect(new Set(plan.map((x) => x.prompt.slice(0, 4096))).size).toBe(1);
  });

  it("distinguishes positive, zero, and absent cache fields and withholds cache ranking", () => {
    const rows = [row("mso", 0, 0), row("hermes", 0, 30), row("hermes", 1, 40), row("mso", 1, undefined)];
    const out = summarizeCacheRows(rows as any, { model: "x", provider: "openai-codex" });
    expect(out.evidenceComplete).toBe(true);
    expect(out.aggregates.find((x: any) => x.agent === "mso")?.cacheObservation).toMatchObject({ positiveRows: 0, zeroRows: 1, absentRows: 1 });
    expect(out.aggregates.find((x: any) => x.agent === "hermes")?.cacheObservation).toMatchObject({ positiveRows: 2, totalCacheReadTokens: 70 });
    expect(out.cacheComparability.eligible).toBe(false);
    expect(out.efficiencyComparability.tokenSemanticsComparable).toBe(true);
    expect(out.efficiencyComparability.costSemanticsComparable).toBe(false);
  });

  it("keeps token semantics comparable when one agent uses multiple independently valid accounting proofs", () => {
    const rows: any[] = [row("mso", 0, 0), row("hermes", 0, 0), row("mso", 1, 0), row("hermes", 1, 30)];
    rows[1].usage.accountingProof = "exact-input-output-identity";
    rows[3].usage.accountingProof = "exact-exclusive-cache-sum";
    expect(summarizeCacheRows(rows, { model: "x", provider: "openai-codex" }).efficiencyComparability.tokenSemanticsComparable).toBe(true);
  });

  it("allows cost comparability only when both agents expose the same attributed contract", () => {
    const rows = [row("mso", 0, 0, true), row("hermes", 0, 30, true), row("mso", 1, 20, true), row("hermes", 1, 40, true)];
    expect(summarizeCacheRows(rows as any, { model: "x", provider: "openai-codex" }).efficiencyComparability.costSemanticsComparable).toBe(true);
  });

  it("rejects unsafe cache calibration bounds", () => {
    expect(() => parseCacheArgs(["--rounds", "1"])).toThrow(/rounds/);
    expect(() => parseCacheArgs(["--prefix-chars", "1000"])).toThrow(/prefix-chars/);
  });
});
