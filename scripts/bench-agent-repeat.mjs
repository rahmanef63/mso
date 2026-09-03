#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import path from "node:path";
import { deriveRunSeed, normalizeCorpusSeed, rotateAgentOrder } from "./bench-agent-seed.mjs";
import { summarizeRepeatedCorpus } from "./bench-agent-repeat-metrics.mjs";

const AGENTS = ["mso", "hermes", "openclaw"];

function value(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("-") ? argv[i + 1] : fallback;
}

export function parseRepeatArgs(argv) {
  const agents = [...new Set(String(value(argv, "--agents", "mso,hermes")).split(",").map((v) => v.trim()).filter((v) => AGENTS.includes(v)))];
  const runs = Number(value(argv, "--runs", "2"));
  if (agents.length < 1) throw new Error("--agents must include mso, hermes, or openclaw");
  if (!Number.isInteger(runs) || runs < 2 || runs > 10) throw new Error("--runs must be an integer from 2 to 10");
  return {
    run: argv.includes("--run"), json: argv.includes("--json"), runs, agents,
    seed: normalizeCorpusSeed(value(argv, "--seed", null)),
    model: value(argv, "--model", process.env.MSO_BENCH_MODEL || "gpt-5.6-terra"),
    provider: value(argv, "--provider", process.env.MSO_BENCH_PROVIDER || "openai-codex"),
    scenario: value(argv, "--scenario", null),
  };
}

export function buildRepeatPlan(opts) {
  return Array.from({ length: opts.runs }, (_, runIndex) => ({
    runIndex,
    seed: deriveRunSeed(opts.seed, runIndex),
    agentOrder: rotateAgentOrder(opts.agents, runIndex),
  }));
}

function runOne(entry, opts) {
  const script = path.join(process.cwd(), "scripts/bench-agent-corpus.mjs");
  const args = [script, "--agents", entry.agentOrder.join(","), "--provider", opts.provider, "--model", opts.model, "--seed", entry.seed, "--run", "--json"];
  if (opts.scenario) args.push("--scenario", opts.scenario);
  const timeout = opts.scenario ? 3 * 60_000 : 9 * 60_000;
  const out = spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: "utf8", timeout, maxBuffer: 16 * 1024 * 1024, env: process.env });
  if (out.status !== 0) return { run: false, runIndex: entry.runIndex, seed: entry.seed, agentOrder: entry.agentOrder, exitCode: out.status, error: out.error?.message || out.stderr.slice(-600) };
  try { return { ...JSON.parse(out.stdout), runIndex: entry.runIndex }; }
  catch { return { run: false, runIndex: entry.runIndex, seed: entry.seed, agentOrder: entry.agentOrder, exitCode: out.status, error: "child corpus returned non-JSON output" }; }
}

async function main() {
  const opts = parseRepeatArgs(process.argv.slice(2));
  const plan = buildRepeatPlan(opts);
  if (!opts.run) {
    const result = { run: false, repeatVersion: "mso-agent-repeat-v1", baseSeed: opts.seed, requestedRuns: opts.runs, model: opts.model, provider: opts.provider, scenario: opts.scenario, plan };
    console.log(opts.json ? JSON.stringify(result, null, 2) : `MSO repeated corpus plan · ${opts.runs} runs · ${opts.agents.join(" ↔ ")}\n  base seed ${opts.seed}\n  add --run to execute`);
    return;
  }
  const runs = plan.map((entry) => runOne(entry, opts));
  const summary = summarizeRepeatedCorpus(runs, { agents: opts.agents, expectedRuns: opts.runs, plan, provider: opts.provider, model: opts.model });
  const result = { run: true, repeatVersion: "mso-agent-repeat-v1", baseSeed: opts.seed, requestedRuns: opts.runs, model: opts.model, provider: opts.provider, scenario: opts.scenario, plan, runs, ...summary,
    note: "Repeated aggregation reports counts/rates and observed latency/token metrics only. It does not infer statistical confidence or broad product superiority. Ranking is withheld unless every requested run has complete matching corpus/provider/model evidence." };
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`MSO repeated corpus · ${summary.completedRuns}/${opts.runs} complete · ${summary.scenarioCount ?? "?"} scenarios/run`);
    for (const row of summary.aggregates) console.log(`  ${row.agent.padEnd(8)} success ${row.fullSuccessPct}% · perfect runs ${row.perfectRuns}/${opts.runs} · p50 ${row.p50LatencyMs ?? "?"}ms · tokens/attempt ${row.reportedTokensPerAttempt ?? "unknown"}`);
    console.log(`  comparability=${summary.comparability.level} · ranking=${summary.ranking.eligible ? summary.ranking.order.join(" > ") : `withheld · ${summary.ranking.reason}`}`);
  }
}

if (import.meta.main) await main();
