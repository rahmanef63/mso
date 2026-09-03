#!/usr/bin/env bun
import { randomBytes } from "node:crypto";
import { normalizeCorpusSeed } from "./bench-agent-seed.mjs";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { aggregateAgent, comparabilityLevel, eligibleRanking, extractModelEvidence, extractToolTelemetry, extractUsage, modelFamily, normalizedTokenUsageComparable } from "./bench-agent-metrics.mjs";
import { createCorpus, scratchIsPrivate } from "./bench-agent-corpus-fixtures.mjs";

export const CORPUS_VERSION = "mso-agent-quality-v2";
const AGENTS = ["mso", "hermes", "openclaw"];

function parseArgs(argv) {
  const get = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("-") ? argv[i + 1] : fallback; };
  const agents = [...new Set(get("--agents", AGENTS.join(",")).split(",").map((v) => v.trim()).filter((v) => AGENTS.includes(v)))];
  return { run: argv.includes("--run"), json: argv.includes("--json"), model: get("--model", process.env.MSO_BENCH_MODEL || "gpt-5.6-terra"), provider: get("--provider", process.env.MSO_BENCH_PROVIDER || "openai-codex"), agents, scenario: get("--scenario", null), seed: get("--seed", null) };
}

function jsonMaybe(text) {
  try { return JSON.parse(text); } catch {}
  for (const line of String(text).trim().split(/\r?\n/).reverse()) try { return JSON.parse(line); } catch {}
  return null;
}
function strings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((row) => strings(row, out));
  else if (value && typeof value === "object") Object.values(value).forEach((row) => strings(row, out));
  return out;
}
function responseText(raw, parsed) { return [raw.stdout, ...(parsed ? strings(parsed) : [])].join("\n"); }
function readJson(name) { try { return JSON.parse(readFileSync(name, "utf8")); } catch { return null; } }

function commandFor(agent, scenario, { model, provider, cwd, usageFile, sessionId }) {
  const modelId = model.includes("/") ? model : `${provider}/${model}`;
  if (agent === "mso") return { command: path.join(cwd, "bin/mso"), args: ["agent", "--oneshot", scenario.prompt, "--json", "--approve-scope", scenario.approvalScope] };
  if (agent === "hermes") return { command: "hermes", args: ["--oneshot", scenario.prompt, "--model", modelId, "--provider", provider, "--usage-file", usageFile] };
  return { command: "openclaw", args: ["agent", "--local", "--message", scenario.prompt, "--model", modelId, "--json", "--session-id", sessionId] };
}

function runCommand(config, cwd, timeoutMs = 60_000) {
  const started = performance.now();
  const result = spawnSync(config.command, config.args, { cwd, encoding: "utf8", timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env: process.env });
  return { code: result.status, signal: result.signal, stdout: result.stdout || "", stderr: result.stderr || "", latencyMs: Math.round(performance.now() - started), error: result.error?.message };
}

export function scoreScenario(agent, scenario, raw, parsed, usageReport, requested) {
  const text = responseText(raw, parsed), verification = scenario.verify(text);
  const evidence = extractModelEvidence(usageReport ?? parsed ?? {}), fallbackEvidence = extractModelEvidence(parsed ?? {});
  const modelEvidence = evidence.modelFamily ? evidence : fallbackEvidence;
  const usage = extractUsage(usageReport ?? parsed ?? {} ) ?? extractUsage(parsed ?? {});
  const toolTelemetry = extractToolTelemetry(parsed ?? {}) ?? extractToolTelemetry(usageReport ?? {});
  return {
    agent, scenarioId: scenario.id, taskClass: scenario.taskClass, approvalScope: scenario.approvalScope,
    exitCode: raw.code, signal: raw.signal, latencyMs: raw.latencyMs,
    taskSuccess: verification.taskSuccess === true,
    policyObservationScope: "scenario-tree",
    policyCompliant: verification.policyCompliant === true && verification.forbiddenMutation !== true,
    fullSuccess: raw.code === 0 && verification.taskSuccess === true && verification.policyCompliant === true && verification.forbiddenMutation !== true,
    verification, modelEvidence, usage, toolTelemetry,
    modelFamilyMatch: modelEvidence.modelFamily ? modelEvidence.modelFamily === modelFamily(requested.model) : null,
    providerMatch: modelEvidence.provider ? modelEvidence.provider === requested.provider.toLowerCase() : null,
    ...(raw.error ? { error: raw.error } : {}), ...(raw.code !== 0 ? { stderrTail: raw.stderr.slice(-600) } : {}),
  };
}

export function summarizeCorpus(rows, requested) {
  const aggregates = [...new Set(rows.map((row) => row.agent))].map((agent) => aggregateAgent(agent, rows.filter((row) => row.agent === agent)));
  const comparability = comparabilityLevel(aggregates, requested.model, requested.provider);
  const expectedScenarios = new Set(rows.map((row) => row.scenarioId)).size;
  const tokenModes = new Set(aggregates.map((row) => row.tokenAccountingMode));
  const tokenSemanticsComparable = aggregates.length >= 2
    && aggregates.every((aggregate) => {
      const agentRows = rows.filter((row) => row.agent === aggregate.agent);
      return aggregate.tokenCoveragePct === 100 && normalizedTokenUsageComparable(agentRows);
    });
  const costPairs = new Set(aggregates.map((row) => `${row.costStatus}:${row.costSource}`));
  const costSemanticsComparable = aggregates.length >= 2
    && aggregates.every((row) => row.costCoveragePct === 100 && !["unknown", "mixed"].includes(row.costStatus) && !["unknown", "mixed"].includes(row.costSource))
    && costPairs.size === 1;
  return {
    aggregates, comparability,
    efficiencyComparability: {
      tokenSemanticsComparable, costSemanticsComparable, tokenAccountingModes: [...tokenModes],
      tokenAccountingProofs: Object.fromEntries(aggregates.map((row) => [row.agent, row.tokenAccountingProof])),
    },
    ranking: eligibleRanking(aggregates, comparability, expectedScenarios),
  };
}

export function buildCorpusPlan({ corpus, agents, model, provider, cwd, scratch }) {
  const plan = [];
  for (const scenario of corpus) for (const agent of agents) {
    const usageFile = path.join(scratch, `${agent}-${scenario.id}-usage.json`), sessionId = `mso-bench-${scenario.id}-${randomBytes(5).toString("hex")}`;
    plan.push({ agent, scenario, usageFile, config: commandFor(agent, scenario, { model, provider, cwd, usageFile, sessionId }) });
  }
  return plan;
}

export function interleaveCorpusPlans(plansByAgent, agents, scenarioIds) {
  const byAgent = new Map(agents.map((agent) => [agent, new Map((plansByAgent.get(agent) ?? []).map((row) => [row.scenario.id, row]))]));
  const out = [];
  for (let i = 0; i < scenarioIds.length; i++) {
    const offset = i % agents.length, order = [...agents.slice(offset), ...agents.slice(0, offset)];
    for (const agent of order) {
      const row = byAgent.get(agent)?.get(scenarioIds[i]);
      if (row) out.push(row);
    }
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.agents.length) throw new Error("--agents must include mso, hermes, or openclaw");
  const scratch = path.join(os.homedir(), ".cache", "mso-benchmarks", `corpus-${Date.now()}-${randomBytes(3).toString("hex")}`);
  mkdirSync(scratch, { recursive: true, mode: 0o700 });
  try {
    const corpusSeed = normalizeCorpusSeed(opts.seed);
    const corpora = new Map(opts.agents.map((agent) => [agent, createCorpus(path.join(scratch, agent), corpusSeed).filter((row) => !opts.scenario || row.id === opts.scenario)]));
    const referenceCorpus = corpora.get(opts.agents[0]) ?? [];
    if (!referenceCorpus.length) throw new Error(`unknown --scenario ${opts.scenario}`);
    const cwd = process.cwd();
    const plansByAgent = new Map(opts.agents.map((agent) => [agent, buildCorpusPlan({ corpus: corpora.get(agent) ?? [], agents: [agent], model: opts.model, provider: opts.provider, cwd, scratch: path.join(scratch, agent) })]));
    const plan = interleaveCorpusPlans(plansByAgent, opts.agents, referenceCorpus.map((row) => row.id));
    if (!opts.run) {
      const result = { run: false, corpusVersion: CORPUS_VERSION, seed: corpusSeed, agentOrder: opts.agents, scratchFixtures: true, runnerAuthoritySandboxed: false, policyObservationScope: "scenario-tree", isolatedPerAgent: true, privateScratch: scratchIsPrivate(scratch), model: opts.model, provider: opts.provider,
        scenarios: referenceCorpus.map(({ id, taskClass, approvalScope }) => ({ id, taskClass, approvalScope })),
        runners: plan.map(({ agent, scenario, config }) => ({ agent, scenarioId: scenario.id, command: path.basename(config.command), args: config.args.map((v) => v === scenario.prompt ? "<prompt>" : v) })) };
      console.log(opts.json ? JSON.stringify(result, null, 2) : `MSO agent-quality corpus plan · ${referenceCorpus.length} scenarios × ${opts.agents.length} agents\n  add --run to execute isolated scratch-fixture tasks`);
      return;
    }
    const rows = [];
    for (const item of plan) {
      const raw = runCommand(item.config, cwd, item.scenario.timeoutMs ?? 60_000), parsed = jsonMaybe(raw.stdout.trim()), usageReport = existsSync(item.usageFile) ? readJson(item.usageFile) : null;
      rows.push(scoreScenario(item.agent, item.scenario, raw, parsed, usageReport, opts));
    }
    const summary = summarizeCorpus(rows, opts);
    const result = { run: true, corpusVersion: CORPUS_VERSION, seed: corpusSeed, agentOrder: opts.agents, scratchFixtures: true, runnerAuthoritySandboxed: false, policyObservationScope: "scenario-tree", model: opts.model, provider: opts.provider, scenarioCount: referenceCorpus.length, isolatedPerAgent: true, executionOrder: "scenario-major rotating-agent order", rows, ...summary,
      note: "Fixture state is isolated per agent, but each runner keeps its normal tool authority; policy scoring is limited to the exact observable scenario tree and must not be read as whole-host or syscall-sandbox proof. Ranking requires complete matching model-family + requested-provider evidence. Token/cost efficiency remains diagnostic unless efficiencyComparability explicitly marks accounting semantics comparable; missing usage/cost stays unknown." };
    if (opts.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`MSO cross-agent quality corpus · ${referenceCorpus.length} scenarios · requested ${opts.provider}/${opts.model}`);
      for (const row of summary.aggregates) console.log(`  ${row.agent.padEnd(8)} success ${row.fullSuccessPct}% · scenario-policy ${row.policyCompliancePct}% · p50 ${row.p50LatencyMs ?? "?"}ms · tokens/success ${row.tokensPerSuccessfulTask ?? "unknown"} · cost/success ${row.costPerSuccessfulTaskUsd ?? "unknown"}`);
      console.log(`  comparability=${summary.comparability.level}${summary.comparability.reason ? ` · ${summary.comparability.reason}` : ""}`);
      console.log(`  ranking=${summary.ranking.eligible ? summary.ranking.order.join(" > ") : `withheld · ${summary.ranking.reason}`}`);
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

if (import.meta.main) await main();
