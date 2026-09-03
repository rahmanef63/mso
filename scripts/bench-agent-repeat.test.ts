import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createCorpus } from "./bench-agent-corpus-fixtures.mjs";
import { normalizeCorpusSeed, deriveRunSeed, rotateAgentOrder } from "./bench-agent-seed.mjs";
import { buildRepeatPlan, parseRepeatArgs } from "./bench-agent-repeat.mjs";
import { summarizeRepeatedCorpus } from "./bench-agent-repeat-metrics.mjs";
import { summarizeCorpus } from "./bench-agent-corpus.mjs";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

function row(agent: string, scenarioId: string, ok = true, tokens = 100) {
  return {
    agent, scenarioId, taskClass: "read", approvalScope: "read", exitCode: 0, signal: null, latencyMs: agent === "mso" ? 10 : 12,
    taskSuccess: ok, policyCompliant: true, fullSuccess: ok,
    verification: { taskSuccess: ok, policyCompliant: true },
    modelEvidence: { model: "p/x", modelFamily: "x", provider: "p" },
    usage: { normalizedTotalTokens: tokens, accountingMode: "inclusive-input-output-total", accountingProof: agent === "mso" ? "explicit" : "exact" },
    toolTelemetry: null, modelFamilyMatch: true, providerMatch: true,
  };
}

function fakeRun(runIndex: number, seed: string, agentOrder: string[], hermesSecondOk = true) {
  const rows = [row("mso", "a"), row("hermes", "a", true, 200), row("hermes", "b", hermesSecondOk, 200), row("mso", "b")];
  return { run: true, corpusVersion: "mso-agent-quality-v2", provider: "p", model: "x", runIndex, seed, agentOrder, scenarioCount: 2, rows,
    ...summarizeCorpus(rows as any, { model: "x", provider: "p" }) };
}

describe("P7 repeatable corpus", () => {
  it("normalizes bounded explicit seeds and derives deterministic per-run seeds", () => {
    expect(normalizeCorpusSeed("p7.seed-1")).toBe("p7.seed-1");
    expect(deriveRunSeed("p7.seed-1", 0)).toBe(deriveRunSeed("p7.seed-1", 0));
    expect(deriveRunSeed("p7.seed-1", 0)).not.toBe(deriveRunSeed("p7.seed-1", 1));
    expect(() => normalizeCorpusSeed("bad seed")).toThrow(/--seed/);
  });

  it("keeps semantic fixtures identical for one explicit seed and different across seeds", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "mso-repeat-seed-"));
    try {
      const a = createCorpus(path.join(root, "a"), "same-seed"), b = createCorpus(path.join(root, "b"), "same-seed"), c = createCorpus(path.join(root, "c"), "other-seed");
      expect(a.map((x) => x.expected)).toEqual(b.map((x) => x.expected));
      expect(a.map((x) => x.expected)).not.toEqual(c.map((x) => x.expected));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("alternates the starting agent across repeated runs", () => {
    expect(rotateAgentOrder(["mso", "hermes"], 0)).toEqual(["mso", "hermes"]);
    expect(rotateAgentOrder(["mso", "hermes"], 1)).toEqual(["hermes", "mso"]);
    const opts = parseRepeatArgs(["--runs", "3", "--seed", "stable", "--agents", "mso,hermes"]);
    const plan = buildRepeatPlan(opts);
    expect(plan.map((r) => r.agentOrder)).toEqual([["mso", "hermes"], ["hermes", "mso"], ["mso", "hermes"]]);
    expect(new Set(plan.map((r) => r.seed)).size).toBe(3);
  });

  it("keeps the single-run CLI backward compatible while exposing an explicit seed", () => {
    const out = spawnSync("bun", ["scripts/bench-agent-corpus.mjs", "--agents", "mso", "--scenario", "read-json", "--seed", "p7-cli", "--json"], { cwd: process.cwd(), encoding: "utf8" });
    expect(out.status).toBe(0);
    const parsed = JSON.parse(out.stdout);
    expect(parsed).toMatchObject({ run: false, corpusVersion: "mso-agent-quality-v2", seed: "p7-cli", agentOrder: ["mso"] });
  });

  it("aggregates complete repeated runs and counts perfect runs separately from scenario success", () => {
    const plan = [
      { runIndex: 0, seed: "s0", agentOrder: ["mso", "hermes"] },
      { runIndex: 1, seed: "s1", agentOrder: ["hermes", "mso"] },
    ];
    const runs = [fakeRun(0, "s0", plan[0].agentOrder), fakeRun(1, "s1", plan[1].agentOrder, false)];
    const out = summarizeRepeatedCorpus(runs, { agents: ["mso", "hermes"], expectedRuns: 2, plan, provider: "p", model: "x" });
    expect(out).toMatchObject({ completedRuns: 2, exactCoverage: true, plannedIdentity: true, comparability: { level: "full" } });
    expect(out.aggregates.find((x: any) => x.agent === "mso")).toMatchObject({ attempted: 4, fullSuccesses: 4, perfectRuns: 2, perfectRunPct: 100 });
    expect(out.aggregates.find((x: any) => x.agent === "hermes")).toMatchObject({ attempted: 4, fullSuccesses: 3, perfectRuns: 1, perfectRunPct: 50 });
    expect(out.ranking).toMatchObject({ eligible: true, order: ["mso", "hermes"] });
  });

  it("withholds ranking on an incomplete run or a seed/order identity mismatch", () => {
    const plan = [{ runIndex: 0, seed: "s0", agentOrder: ["mso", "hermes"] }, { runIndex: 1, seed: "s1", agentOrder: ["hermes", "mso"] }];
    const incomplete = summarizeRepeatedCorpus([fakeRun(0, "s0", plan[0].agentOrder)], { agents: ["mso", "hermes"], expectedRuns: 2, plan, provider: "p", model: "x" });
    expect(incomplete.ranking.eligible).toBe(false); expect(incomplete.exactCoverage).toBe(false);
    const wrongSeed = [fakeRun(0, "WRONG", plan[0].agentOrder), fakeRun(1, "s1", plan[1].agentOrder)];
    const mismatched = summarizeRepeatedCorpus(wrongSeed, { agents: ["mso", "hermes"], expectedRuns: 2, plan, provider: "p", model: "x" });
    expect(mismatched.plannedIdentity).toBe(false); expect(mismatched.ranking.eligible).toBe(false);
  });

  it("withholds ranking when runs have equal counts but different scenario identities", () => {
    const plan = [{ runIndex: 0, seed: "s0", agentOrder: ["mso", "hermes"] }, { runIndex: 1, seed: "s1", agentOrder: ["hermes", "mso"] }];
    const runs: any[] = [fakeRun(0, "s0", plan[0].agentOrder), fakeRun(1, "s1", plan[1].agentOrder)];
    runs[1].rows = runs[1].rows.map((r: any) => r.scenarioId === "b" ? { ...r, scenarioId: "different" } : r);
    const out = summarizeRepeatedCorpus(runs, { agents: ["mso", "hermes"], expectedRuns: 2, plan, provider: "p", model: "x" });
    expect(out.scenarioSignature).toBeNull(); expect(out.exactCoverage).toBe(false); expect(out.ranking.eligible).toBe(false);
  });


  it("rejects duplicated per-agent scenario rows even when global counts still look complete", () => {
    const plan = [{ runIndex: 0, seed: "s0", agentOrder: ["mso", "hermes"] }, { runIndex: 1, seed: "s1", agentOrder: ["hermes", "mso"] }];
    const runs: any[] = [fakeRun(0, "s0", plan[0].agentOrder), fakeRun(1, "s1", plan[1].agentOrder)];
    runs[1].rows = runs[1].rows.map((r: any, index: number) => r.agent === "mso" && r.scenarioId === "b" ? { ...r, scenarioId: "a", duplicateMarker: index } : r);
    const out = summarizeRepeatedCorpus(runs, { agents: ["mso", "hermes"], expectedRuns: 2, plan, provider: "p", model: "x" });
    expect(out.scenarioSignature).toBe("a|b");
    expect(out.exactScenarioCoverage).toBe(false);
    expect(out.exactCoverage).toBe(false);
    expect(out.ranking.eligible).toBe(false);
  });

  it("rejects cross-run provider or model drift even when each child run is internally comparable", () => {
    const plan = [{ runIndex: 0, seed: "s0", agentOrder: ["mso", "hermes"] }, { runIndex: 1, seed: "s1", agentOrder: ["hermes", "mso"] }];
    const providerDrift: any[] = [fakeRun(0, "s0", plan[0].agentOrder), fakeRun(1, "s1", plan[1].agentOrder)];
    providerDrift[0].provider = "p"; providerDrift[0].model = "x";
    providerDrift[1].provider = "other"; providerDrift[1].model = "x";
    let out = summarizeRepeatedCorpus(providerDrift, { agents: ["mso", "hermes"], expectedRuns: 2, plan, provider: "p", model: "x" });
    expect(out.providerModelIdentity).toBe(false); expect(out.ranking.eligible).toBe(false);

    const modelDrift: any[] = [fakeRun(0, "s0", plan[0].agentOrder), fakeRun(1, "s1", plan[1].agentOrder)];
    modelDrift[0].provider = "p"; modelDrift[0].model = "x";
    modelDrift[1].provider = "p"; modelDrift[1].model = "y";
    out = summarizeRepeatedCorpus(modelDrift, { agents: ["mso", "hermes"], expectedRuns: 2, plan, provider: "p", model: "x" });
    expect(out.providerModelIdentity).toBe(false); expect(out.ranking.eligible).toBe(false);
  });

  it("withholds repeat token/cost comparability if any child run cannot prove it", () => {
    const plan = [{ runIndex: 0, seed: "s0", agentOrder: ["mso", "hermes"] }, { runIndex: 1, seed: "s1", agentOrder: ["hermes", "mso"] }];
    const runs: any[] = [fakeRun(0, "s0", plan[0].agentOrder), fakeRun(1, "s1", plan[1].agentOrder)];
    runs[1].efficiencyComparability.tokenSemanticsComparable = false;
    const out = summarizeRepeatedCorpus(runs, { agents: ["mso", "hermes"], expectedRuns: 2, plan, provider: "p", model: "x" });
    expect(out.efficiencyComparability.tokenSemanticsComparable).toBe(false);
    expect(out.efficiencyComparability.costSemanticsComparable).toBe(false);
  });
});
