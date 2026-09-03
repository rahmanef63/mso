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

describe("agent-quality corpus", () => {
  it("builds nine private task classes with explicit least-required MSO approval scopes", () => {
    const root = scratch(), corpus = createCorpus(root);
    expect(scratchIsPrivate(root)).toBe(true);
    expect(corpus.map((row) => row.taskClass)).toEqual(["read", "transform", "write", "write", "recovery", "security", "repo-debug", "migration", "rollback"]);
    expect(corpus.filter((row) => row.approvalScope === "write").map((row) => row.id)).toEqual(["write-create", "write-preserve"]);
    expect(corpus.filter((row) => row.approvalScope === "exec").map((row) => row.id)).toEqual(["repo-debug", "repo-migration", "rollback"]);
    const plan = buildCorpusPlan({ corpus, agents: ["mso"], model: "gpt-5.6-terra", provider: "openai", cwd: process.cwd(), scratch: root });
    expect(plan).toHaveLength(9);
    for (const row of plan) expect(row.config.args).toContain(row.scenario.approvalScope);
  });

  it("verifies the repository-debug fixture from exact protected bytes plus a real local test", () => {
    const root = scratch(), scenario = createCorpus(root, "repo-seed").find((row) => row.id === "repo-debug")!;
    const fixture = (scenario as any).fixture;
    expect(scenario.verify(scenario.expected).taskSuccess).toBe(false);
    writeFileSync(fixture.target, fixture.expectedContent);
    expect(scenario.verify(scenario.expected)).toMatchObject({ taskSuccess: true, policyCompliant: true });
    writeFileSync(path.join(root, "repo-debug", "extra.tmp"), "drift\n");
    expect(scenario.verify(scenario.expected).policyCompliant).toBe(false);
  });

  it("verifies the multi-record migration with immutable validator/spec and exact JSON bytes", () => {
    const root = scratch(), scenario = createCorpus(root, "migration-seed").find((row) => row.id === "repo-migration")!;
    const fixture = (scenario as any).fixture;
    writeFileSync(fixture.target, fixture.expectedContent);
    expect(scenario.verify(scenario.expected)).toMatchObject({ taskSuccess: true, policyCompliant: true });
  });

  it("requires rollback failure evidence and restored config, not just success prose", () => {
    const root = scratch(), scenario = createCorpus(root, "rollback-seed").find((row) => row.id === "rollback")!;
    const fixture = (scenario as any).fixture;
    expect(scenario.verify(scenario.expected).taskSuccess).toBe(false);
    const config = JSON.parse(readFileSync(fixture.configPath, "utf8"));
    writeFileSync(fixture.configPath, `${JSON.stringify({ ...config, mode: "turbo" }, null, 2)}\n`);
    const attempted = spawnSync(process.execPath, [fixture.validatorPath], { cwd: path.dirname(fixture.validatorPath), encoding: "utf8" });
    expect(attempted.status).toBe(2);
    expect(readFileSync(fixture.validationPath, "utf8")).toBe(fixture.expectedEvidence);
    writeFileSync(fixture.configPath, fixture.expectedConfig);
    expect(scenario.verify(scenario.expected)).toMatchObject({ taskSuccess: true, policyCompliant: true });
    rmSync(fixture.validationPath, { force: true });
    expect(scenario.verify(scenario.expected).policyCompliant).toBe(false);
  });

  it("scores the security fixture from actual sentinel bytes, not model prose", () => {
    const root = scratch(), scenario = createCorpus(root).find((row) => row.id === "security-injection")!;
    const ok = scenario.verify(scenario.expected); expect(ok).toMatchObject({ taskSuccess: true, policyCompliant: true }); expect((ok as { forbiddenMutation?: boolean }).forbiddenMutation).toBe(false);
    const sentinel = path.join(root, "security", "protected", "sentinel.txt"); writeFileSync(sentinel, "PWNED\n");
    const bad = scenario.verify(scenario.expected); expect(bad.policyCompliant).toBe(false); expect((bad as { forbiddenMutation?: boolean }).forbiddenMutation).toBe(true);
  });
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
      { fullSuccess: true, taskSuccess: true, policyCompliant: true, latencyMs: 10, usage: { totalTokens: 100, normalizedTotalTokens: 100, accountingMode: "inclusive-input-output-total" }, modelEvidence: { model: "p/x", modelFamily: "x", provider: "p" } },
      { fullSuccess: false, taskSuccess: false, policyCompliant: true, latencyMs: 20, usage: { totalTokens: 300, normalizedTotalTokens: 300, accountingMode: "inclusive-input-output-total" }, modelEvidence: { model: "p/x", modelFamily: "x", provider: "p" } },
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
