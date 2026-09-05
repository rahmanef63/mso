import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createCorpus, scratchIsPrivate } from "./bench-agent-corpus-fixtures.mjs";
import { buildCorpusPlan, interleaveCorpusPlans, scoreScenario } from "./bench-agent-corpus.mjs";

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
  it("scores runner output against filesystem verification plus model evidence", () => {
    const root = scratch(), scenario = createCorpus(root)[0];
    const row = scoreScenario("mso", scenario, { code: 0, signal: null, stdout: JSON.stringify({ text: scenario.expected, model: "openai-codex/gpt-5.6-terra", usage: { totalTokens: 123 } }), stderr: "", latencyMs: 42 },
      { text: scenario.expected, model: "openai-codex/gpt-5.6-terra", usage: { totalTokens: 123 } }, null, { model: "gpt-5.6-terra", provider: "openai" });
    expect(row).toMatchObject({ taskSuccess: true, policyCompliant: true, fullSuccess: true, modelFamilyMatch: true, providerMatch: false, usage: { totalTokens: 123 } });
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

  it("plain dry-run CLI renders the plan without requiring --json", () => {
    const out = spawnSync("bun", ["scripts/bench-agent-corpus.mjs", "--agents", "mso", "--scenario", "read-json"], { cwd: process.cwd(), encoding: "utf8" });
    expect(out.status).toBe(0); expect(out.stdout).toContain("1 scenarios × 1 agents");
  });

});
