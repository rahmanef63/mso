import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createCorpus, scratchIsPrivate } from "./bench-agent-corpus-fixtures.mjs";
import { aggregateAgent, comparabilityLevel, eligibleRanking, extractModelEvidence, extractToolTelemetry, extractUsage } from "./bench-agent-metrics.mjs";
import { buildCorpusPlan, interleaveCorpusPlans, scoreScenario, summarizeCorpus } from "./bench-agent-corpus.mjs";

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });
function scratch() { const dir = mkdtempSync(path.join(os.tmpdir(), "mso-corpus-")); dirs.push(dir); return dir; }

describe("P4 agent-quality corpus", () => {
  it("builds six private scratch-only task classes with explicit MSO approval scope", () => {
    const root = scratch(), corpus = createCorpus(root);
    expect(scratchIsPrivate(root)).toBe(true);
    expect(corpus.map((row) => row.taskClass)).toEqual(["read", "transform", "write", "write", "recovery", "security"]);
    expect(corpus.filter((row) => row.approvalScope === "write").map((row) => row.id)).toEqual(["write-create", "write-preserve"]);
    const plan = buildCorpusPlan({ corpus, agents: ["mso"], model: "gpt-5.6-terra", provider: "openai", cwd: process.cwd(), scratch: root });
    expect(plan).toHaveLength(6);
    for (const row of plan) expect(row.config.args).toContain(row.scenario.approvalScope);
  });

  it("scores the security fixture from actual sentinel bytes, not model prose", () => {
    const root = scratch(), scenario = createCorpus(root).find((row) => row.id === "security-injection")!;
    const ok = scenario.verify(scenario.expected); expect(ok).toMatchObject({ taskSuccess: true, policyCompliant: true }); expect((ok as { forbiddenMutation?: boolean }).forbiddenMutation).toBe(false);
    const sentinel = path.join(root, "security", "protected", "sentinel.txt"); writeFileSync(sentinel, "PWNED\n");
    const bad = scenario.verify(scenario.expected); expect(bad.policyCompliant).toBe(false); expect((bad as { forbiddenMutation?: boolean }).forbiddenMutation).toBe(true);
  });

  it("keeps missing usage and cost unknown rather than converting null to zero", () => {
    expect(extractUsage({ usage: { input_tokens: null, output_tokens: null, cost_usd: null } })).toBeNull();
    expect(extractUsage({ usage: { input_tokens: 10, output_tokens: 5 } })).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15, unattributedTokens: 0, accountingMode: "input-output-total" });
    expect(extractUsage({ input_tokens: 10, output_tokens: 5, reasoning_tokens: 7, total_tokens: 22, cache_read_tokens: 3, cost_status: "estimated", cost_source: "catalog" })).toMatchObject({ reasoningTokens: 7, cacheReadTokens: 3, unattributedTokens: 7, accountingMode: "expanded-components", costStatus: "estimated", costSource: "catalog" });
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
      { fullSuccess: true, taskSuccess: true, policyCompliant: true, latencyMs: 10, usage: { totalTokens: 100, estimatedCostUsd: 0.01 }, modelEvidence: { model: "p/x", modelFamily: "x", provider: "p" } },
      { fullSuccess: true, taskSuccess: true, policyCompliant: true, latencyMs: 20, usage: null, modelEvidence: { model: "p/x", modelFamily: "x", provider: "p" } },
    ];
    const out = aggregateAgent("mso", rows);
    expect(out.tokenCoveragePct).toBe(50); expect(out.costCoveragePct).toBe(50);
    expect(out.reportedTokensPerAttempt).toBe(100); expect(out.reportedCostPerAttemptUsd).toBe(0.01);
    expect(out.tokensPerSuccessfulTask).toBeNull(); expect(out.costPerSuccessfulTaskUsd).toBeNull();
  });

  it("scores runner output against filesystem verification plus model evidence", () => {
    const root = scratch(), scenario = createCorpus(root)[0];
    const row = scoreScenario("mso", scenario, { code: 0, signal: null, stdout: JSON.stringify({ text: scenario.expected, model: "openai-codex/gpt-5.6-terra", usage: { totalTokens: 123 } }), stderr: "", latencyMs: 42 },
      { text: scenario.expected, model: "openai-codex/gpt-5.6-terra", usage: { totalTokens: 123 } }, null, { model: "gpt-5.6-terra", provider: "openai" });
    expect(row).toMatchObject({ taskSuccess: true, policyCompliant: true, fullSuccess: true, modelFamilyMatch: true, providerMatch: false, usage: { totalTokens: 123 } });
  });
  it("extracts optional tool telemetry without inventing it for runners that do not report calls", () => {
    expect(extractToolTelemetry({ toolCalls: [{ name: "fs_read", ok: true }, { name: "fs_write", ok: false }] })).toEqual({ count: 2, names: ["fs_read", "fs_write"], failed: 1 });
    expect(extractToolTelemetry({ text: "no telemetry" })).toBeNull();
  });

  it("builds isolated fixture paths per agent so write tasks cannot contaminate competitors", () => {
    const root = scratch(), a = createCorpus(path.join(root, "a"), "same-seed"), b = createCorpus(path.join(root, "b"), "same-seed");
    expect(a.map((row) => row.expected)).toEqual(b.map((row) => row.expected));
    const pa = buildCorpusPlan({ corpus: a, agents: ["mso"], model: "x", provider: "p", cwd: process.cwd(), scratch: path.join(root, "a") });
    const pb = buildCorpusPlan({ corpus: b, agents: ["hermes"], model: "x", provider: "p", cwd: process.cwd(), scratch: path.join(root, "b") });
    expect(pa.find((r) => r.scenario.id === "write-preserve")!.scenario.prompt).toContain(path.join(root, "a"));
    expect(pb.find((r) => r.scenario.id === "write-preserve")!.scenario.prompt).toContain(path.join(root, "b"));
    expect(pa.find((r) => r.scenario.id === "write-preserve")!.scenario.prompt).not.toBe(pb.find((r) => r.scenario.id === "write-preserve")!.scenario.prompt);
  });


  it("requires complete evidence and the requested provider before full comparability", () => {
    const base = { attempted: 2, modelEvidenceCoveragePct: 100, modelEvidence: { modelFamily: "x", provider: "p" } };
    expect(comparabilityLevel([{ agent: "a", ...base }, { agent: "b", ...base }], "x", "p").level).toBe("full");
    expect(comparabilityLevel([{ agent: "a", ...base }, { agent: "b", ...base, modelEvidenceCoveragePct: 50 }], "x", "p").level).toBe("uncomparable");
    expect(comparabilityLevel([{ agent: "a", ...base }, { agent: "b", ...base }], "x", "other").level).toBe("model-family");
  });

  it("charges failed-attempt tokens into tokens-per-success when coverage is complete", () => {
    const rows = [
      { fullSuccess: true, taskSuccess: true, policyCompliant: true, latencyMs: 10, usage: { totalTokens: 100, accountingMode: "input-output-total" }, modelEvidence: { model: "p/x", modelFamily: "x", provider: "p" } },
      { fullSuccess: false, taskSuccess: false, policyCompliant: true, latencyMs: 20, usage: { totalTokens: 300, accountingMode: "input-output-total" }, modelEvidence: { model: "p/x", modelFamily: "x", provider: "p" } },
    ];
    const out = aggregateAgent("mso", rows);
    expect(out.tokenCoveragePct).toBe(100); expect(out.totalReportedTokens).toBe(400); expect(out.tokensPerSuccessfulTask).toBe(400);
  });

  it("rotates agent order by scenario instead of running one agent's whole corpus first", () => {
    const root = scratch(), agents = ["mso", "hermes"], seed = "balanced";
    const plans = new Map(agents.map((agent) => {
      const corpus = createCorpus(path.join(root, agent), seed).slice(0, 3);
      return [agent, buildCorpusPlan({ corpus, agents: [agent], model: "x", provider: "p", cwd: process.cwd(), scratch: path.join(root, agent) })];
    }));
    const out = interleaveCorpusPlans(plans, agents, ["read-json", "multi-read", "write-create"]);
    expect(out.map((row) => `${row.scenario.id}:${row.agent}`)).toEqual([
      "read-json:mso", "read-json:hermes", "multi-read:hermes", "multi-read:mso", "write-create:mso", "write-create:hermes",
    ]);
  });


  it("scores destructive fixture deletion as failure instead of crashing the corpus verifier", () => {
    const root = scratch(), corpus = createCorpus(root);
    const readScenario = corpus.find((row) => row.id === "read-json")!;
    rmSync(path.join(root, "read-json"), { recursive: true, force: true });
    expect(() => readScenario.verify(readScenario.expected)).not.toThrow();
    expect(readScenario.verify(readScenario.expected).policyCompliant).toBe(false);

    const writeScenario = corpus.find((row) => row.id === "write-preserve")!;
    rmSync(path.join(root, "write-preserve", "config.env"), { force: true });
    expect(() => writeScenario.verify(writeScenario.expected)).not.toThrow();
    expect(writeScenario.verify(writeScenario.expected)).toMatchObject({ taskSuccess: false, policyCompliant: false });
  });

  it("treats extra scenario files as policy drift", () => {
    const root = scratch(), scenario = createCorpus(root).find((row) => row.id === "security-injection")!;
    writeFileSync(path.join(root, "security", "extra.txt"), "unexpected\n");
    expect(scenario.verify(scenario.expected).policyCompliant).toBe(false);
  });

  it("keeps ambiguous generic cost unknown unless currency is explicitly USD", () => {
    expect(extractUsage({ total_tokens: 10, cost: 0.1 })).toMatchObject({ totalTokens: 10 });
    expect(extractUsage({ total_tokens: 10, cost: 0.1 })?.estimatedCostUsd).toBeUndefined();
    expect(extractUsage({ total_tokens: 10, cost: 0.1, currency: "USD" })?.estimatedCostUsd).toBe(0.1);
  });

  it("plain dry-run CLI renders the plan without requiring --json", () => {
    const out = spawnSync("bun", ["scripts/bench-agent-corpus.mjs", "--agents", "mso", "--scenario", "read-json"], { cwd: process.cwd(), encoding: "utf8" });
    expect(out.status).toBe(0); expect(out.stdout).toContain("1 scenarios × 1 agents");
  });

  it("keeps model/provider comparability separate from incompatible token accounting semantics", () => {
    const rows = [
      { agent: "a", scenarioId: "x", fullSuccess: true, taskSuccess: true, policyCompliant: true, latencyMs: 10, usage: { totalTokens: 10, accountingMode: "input-output-total" }, modelEvidence: { modelFamily: "x", provider: "p" } },
      { agent: "b", scenarioId: "x", fullSuccess: true, taskSuccess: true, policyCompliant: true, latencyMs: 12, usage: { totalTokens: 12, accountingMode: "expanded-components" }, modelEvidence: { modelFamily: "x", provider: "p" } },
    ];
    const out = summarizeCorpus(rows as any, { model: "x", provider: "p" });
    expect(out.comparability.level).toBe("full");
    expect(out.efficiencyComparability.tokenSemanticsComparable).toBe(false);
  });

});
