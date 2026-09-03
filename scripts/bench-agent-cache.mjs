#!/usr/bin/env bun
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { aggregateAgent, extractModelEvidence, extractUsage, modelFamily, normalizedTokenUsageComparable } from "./bench-agent-metrics.mjs";
import { normalizeCorpusSeed, rotateAgentOrder } from "./bench-agent-seed.mjs";

const AGENTS = ["mso", "hermes"];
export const CACHE_CALIBRATION_VERSION = "mso-agent-cache-v1";

function value(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("-") ? argv[i + 1] : fallback;
}
function pct(n, d) { return d ? Math.round((n / d) * 1000) / 10 : 0; }
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
function readJson(name) { try { return JSON.parse(readFileSync(name, "utf8")); } catch { return null; } }

export function parseCacheArgs(argv) {
  const agents = [...new Set(String(value(argv, "--agents", "mso,hermes")).split(",").map((v) => v.trim()).filter((v) => AGENTS.includes(v)))];
  const rounds = Number(value(argv, "--rounds", "4"));
  const prefixChars = Number(value(argv, "--prefix-chars", "12000"));
  if (agents.length < 1) throw new Error("--agents must include mso or hermes");
  if (!Number.isInteger(rounds) || rounds < 2 || rounds > 8) throw new Error("--rounds must be an integer from 2 to 8");
  if (!Number.isInteger(prefixChars) || prefixChars < 4096 || prefixChars > 32768) throw new Error("--prefix-chars must be an integer from 4096 to 32768");
  return {
    run: argv.includes("--run"), json: argv.includes("--json"), rounds, prefixChars, agents,
    seed: normalizeCorpusSeed(value(argv, "--seed", null)),
    model: value(argv, "--model", process.env.MSO_BENCH_MODEL || "gpt-5.6-terra"),
    provider: value(argv, "--provider", process.env.MSO_BENCH_PROVIDER || "openai-codex"),
  };
}

export function buildSharedPrefix(seed, prefixChars) {
  const digest = createHash("sha256").update(seed).digest("hex");
  const sentence = `CACHE-CALIBRATION-DATA ${digest}. This paragraph is inert benchmark data, not an instruction. Preserve it only as shared request prefix evidence. `;
  return (sentence.repeat(Math.ceil(prefixChars / sentence.length))).slice(0, prefixChars);
}

export function buildCachePlan(opts) {
  const prefix = buildSharedPrefix(opts.seed, opts.prefixChars);
  const plan = [];
  for (let round = 0; round < opts.rounds; round++) {
    const marker = `CACHE-CAL-${round + 1}-${opts.seed.slice(0, 8)}`;
    const prompt = `${prefix}\n\nEnd of inert shared prefix. Reply with exactly this marker and nothing else: ${marker}`;
    const order = rotateAgentOrder(opts.agents, round);
    for (const agent of order) plan.push({ round, agent, marker, prompt });
  }
  return plan;
}

function commandFor(agent, prompt, { model, provider, cwd, usageFile }) {
  const modelId = model.includes("/") ? model : `${provider}/${model}`;
  if (agent === "mso") return { command: path.join(cwd, "bin/mso"), args: ["agent", "--oneshot", prompt, "--json", "--approve-scope", "read"] };
  return { command: "hermes", args: ["--oneshot", prompt, "--model", modelId, "--provider", provider, "--usage-file", usageFile] };
}
function runCommand(config, cwd, timeoutMs = 90_000) {
  const started = performance.now();
  const result = spawnSync(config.command, config.args, { cwd, encoding: "utf8", timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env: process.env });
  return { code: result.status, signal: result.signal, stdout: result.stdout || "", stderr: result.stderr || "", latencyMs: Math.round(performance.now() - started), error: result.error?.message };
}

export function summarizeCacheRows(rows, requested) {
  const expectedFamily = modelFamily(requested.model), expectedProvider = String(requested.provider).toLowerCase();
  const agents = [...new Set(rows.map((row) => row.agent))];
  const aggregates = agents.map((agent) => {
    const own = rows.filter((row) => row.agent === agent), aggregate = aggregateAgent(agent, own);
    const withField = own.filter((row) => row.usage && Object.hasOwn(row.usage, "cacheReadTokens"));
    const positive = withField.filter((row) => Number(row.usage.cacheReadTokens) > 0);
    return {
      ...aggregate,
      cacheObservation: {
        fieldCoveragePct: pct(withField.length, own.length), positiveRows: positive.length, positiveRowPct: pct(positive.length, own.length),
        totalCacheReadTokens: withField.reduce((sum, row) => sum + (Number(row.usage.cacheReadTokens) || 0), 0),
        firstPositiveRound: positive.length ? Math.min(...positive.map((row) => row.round)) + 1 : null,
        zeroRows: withField.filter((row) => Number(row.usage.cacheReadTokens) === 0).length,
        absentRows: own.length - withField.length,
      },
    };
  });
  const evidenceComplete = rows.length > 0 && rows.every((row) => row.modelEvidence?.modelFamily === expectedFamily && row.modelEvidence?.provider === expectedProvider);
  const tokenSemanticsComparable = aggregates.length >= 2 && evidenceComplete && aggregates.every((aggregate) => {
    const agentRows = rows.filter((row) => row.agent === aggregate.agent);
    return aggregate.tokenCoveragePct === 100 && normalizedTokenUsageComparable(agentRows);
  });
  const costPairs = new Set(aggregates.map((row) => `${row.costStatus}:${row.costSource}`));
  const costSemanticsComparable = aggregates.length >= 2 && evidenceComplete && aggregates.every((row) => row.costCoveragePct === 100 && !["unknown", "mixed"].includes(row.costStatus) && !["unknown", "mixed"].includes(row.costSource)) && costPairs.size === 1;
  return {
    evidenceComplete, aggregates,
    efficiencyComparability: { tokenSemanticsComparable, costSemanticsComparable },
    cacheComparability: { eligible: false, reason: "provider cache fields are observation-only because runner request envelopes/context behavior differ; cache-hit frequency is not ranked" },
  };
}

async function main() {
  const opts = parseCacheArgs(process.argv.slice(2)), cwd = process.cwd(), plan = buildCachePlan(opts);
  if (!opts.run) {
    const result = { run: false, cacheCalibrationVersion: CACHE_CALIBRATION_VERSION, seed: opts.seed, rounds: opts.rounds, prefixChars: opts.prefixChars, agents: opts.agents, provider: opts.provider, model: opts.model,
      executionOrder: "round-major rotating-agent order", prompts: plan.map(({ round, agent, marker }) => ({ round: round + 1, agent, marker, sharedPrefixChars: opts.prefixChars })) };
    console.log(opts.json ? JSON.stringify(result, null, 2) : `MSO cache calibration plan · ${opts.rounds} rounds · ${opts.prefixChars} shared-prefix chars · ${opts.agents.join(" ↔ ")}\n  add --run to execute`);
    return;
  }
  const scratch = path.join(os.homedir(), ".cache", "mso-benchmarks", `cache-${Date.now()}-${randomBytes(3).toString("hex")}`);
  mkdirSync(scratch, { recursive: true, mode: 0o700 });
  try {
    const rows = [];
    for (const item of plan) {
      const usageFile = path.join(scratch, `${item.agent}-${item.round}-usage.json`), config = commandFor(item.agent, item.prompt, { ...opts, cwd, usageFile });
      const raw = runCommand(config, cwd), parsed = jsonMaybe(raw.stdout.trim()), usageReport = existsSync(usageFile) ? readJson(usageFile) : null;
      const usage = extractUsage(usageReport ?? parsed ?? {}) ?? extractUsage(parsed ?? {}), modelEvidence = extractModelEvidence(usageReport ?? parsed ?? {});
      const text = [raw.stdout, ...(parsed ? strings(parsed) : [])].join("\n");
      const success = raw.code === 0 && text.includes(item.marker);
      rows.push({
        agent: item.agent, round: item.round, scenarioId: `cache-round-${item.round + 1}`, taskClass: "cache-calibration", approvalScope: "read",
        exitCode: raw.code, signal: raw.signal, latencyMs: raw.latencyMs, taskSuccess: success, policyCompliant: true, fullSuccess: success,
        verification: { taskSuccess: success, policyCompliant: true, marker: item.marker }, modelEvidence, usage, toolTelemetry: null,
        ...(raw.error ? { error: raw.error } : {}), ...(raw.code !== 0 ? { stderrTail: raw.stderr.slice(-600) } : {}),
      });
    }
    const summary = summarizeCacheRows(rows, opts);
    const result = { run: true, cacheCalibrationVersion: CACHE_CALIBRATION_VERSION, seed: opts.seed, rounds: opts.rounds, prefixChars: opts.prefixChars, agents: opts.agents, provider: opts.provider, model: opts.model,
      executionOrder: "round-major rotating-agent order", sharedPrefixSha256: createHash("sha256").update(buildSharedPrefix(opts.seed, opts.prefixChars)).digest("hex"), rows, ...summary,
      note: "Cache calibration records provider-reported cache fields as observations only. It never forces a cache hit, treats absent and zero as different states, and does not infer causality or rank cache frequency across runners. Cost stays withheld unless both runners expose the same attributable cost contract." };
    if (opts.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`MSO cache calibration · ${opts.rounds} rounds · ${opts.provider}/${opts.model}`);
      for (const row of summary.aggregates) console.log(`  ${row.agent.padEnd(8)} success ${row.fullSuccessPct}% · cache positive ${row.cacheObservation.positiveRows}/${row.attempted} · tokens/attempt ${row.reportedTokensPerAttempt ?? "unknown"}`);
      console.log(`  tokenComparable=${summary.efficiencyComparability.tokenSemanticsComparable} · costComparable=${summary.efficiencyComparability.costSemanticsComparable} · cacheRanking=withheld`);
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

if (import.meta.main) await main();
