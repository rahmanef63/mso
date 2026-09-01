#!/usr/bin/env bun
import { summarizeWorkflowQuality, listLearnedRecipes } from "../lib/skills/memory.ts";

function pct(n, d) { return d ? Math.round((n / d) * 1000) / 10 : 0; }

export function aggregateTaskQuality(recipes = []) {
  const totals = {
    recipes: recipes.length, attempts: 0, successes: 0, failures: 0,
    stepAttempts: 0, completedSteps: 0, failedSteps: 0, deniedSteps: 0,
    rateLimitedSteps: 0, invalidArgSteps: 0, retries: 0, rollbackSignals: 0,
    timedSteps: 0, totalStepDurationMs: 0,
  };
  let telemetryRecipes = 0;
  for (const recipe of recipes) {
    totals.attempts += Number(recipe.attempts) || 0;
    totals.successes += Number(recipe.successes) || 0;
    totals.failures += Number(recipe.failures) || 0;
    const q = recipe.quality;
    if (recipe.qualityVersion !== 1 || !q || typeof q !== "object") continue;
    telemetryRecipes += 1;
    for (const key of ["stepAttempts", "completedSteps", "failedSteps", "deniedSteps", "rateLimitedSteps", "invalidArgSteps", "retries", "rollbackSignals", "timedSteps", "totalStepDurationMs"]) totals[key] += Number(q[key]) || 0;
  }
  return {
    ...totals,
    telemetryRecipes,
    telemetryCoveragePct: pct(telemetryRecipes, totals.recipes),
    workflowSuccessPct: pct(totals.successes, totals.attempts),
    toolCompletionPct: pct(totals.completedSteps, totals.stepAttempts),
    toolFailurePct: pct(totals.failedSteps, totals.stepAttempts),
    policyDenialPct: pct(totals.deniedSteps, totals.stepAttempts),
    invalidArgPct: pct(totals.invalidArgSteps, totals.stepAttempts),
    rateLimitPct: pct(totals.rateLimitedSteps, totals.stepAttempts),
    retryPct: pct(totals.retries, totals.stepAttempts),
    averageStepDurationMs: totals.timedSteps ? Math.round(totals.totalStepDurationMs / totals.timedSteps) : 0,
  };
}

const now = "2026-09-01T00:00:00.000Z";
const fixtureSteps = [
  { id: "1", tool: "fs_read", state: "completed", durationMs: 10, ts: now },
  { id: "2", tool: "fs_write", state: "invalid_args", ts: now },
  { id: "3", tool: "fs_write", state: "failed", durationMs: 30, ts: now },
  { id: "4", tool: "fs_write", state: "completed", durationMs: 20, ts: now },
  { id: "5", tool: "exec_run", state: "completed", target: "restore backup", durationMs: 40, ts: now },
];
const expectedFixture = {
  stepAttempts: 5, completedSteps: 3, failedSteps: 1, deniedSteps: 0, rateLimitedSteps: 0,
  invalidArgSteps: 1, retries: 2, rollbackSignals: 1, timedSteps: 4, totalStepDurationMs: 100, averageStepDurationMs: 25,
};

export function runTaskQualityFixture() {
  const quality = summarizeWorkflowQuality(fixtureSteps);
  const deterministic = JSON.stringify(quality) === JSON.stringify(summarizeWorkflowQuality(fixtureSteps));
  const exact = Object.entries(expectedFixture).every(([key, value]) => quality[key] === value);
  return { exact, deterministic, quality, passed: exact && deterministic };
}

export const externalAgentContract = {
  requiresSameModel: true,
  sideEffectsAllowedOnlyInScratchFixture: true,
  metrics: ["taskSuccess", "toolErrors", "invalidArgs", "retries", "policyDenials", "latencyMs", "inputTokens", "outputTokens", "estimatedCost"],
  runners: {
    mso: { comparable: true, invocation: "mso agent --oneshot <prompt> --json --approve-scope <scope>", safety: "read by default; write/exec require explicit approval scope" },
    hermes: { comparable: true, invocation: "hermes --oneshot <prompt> --model <same-model> --usage-file <file>" },
    openclaw: { comparable: true, invocation: "openclaw agent --local --message <prompt> --model <same-model> --json" },
  },
};

async function main() {
  const fixture = runTaskQualityFixture();
  const live = process.argv.includes("--live") ? aggregateTaskQuality(await listLearnedRecipes({ ownerView: true })) : null;
  const result = { generatedAt: new Date().toISOString(), fixture, live, externalAgentContract };
  if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    console.log("MSO task-quality benchmark");
    console.log(`  fixture           ${fixture.passed ? "PASS" : "FAIL"} · deterministic=${fixture.deterministic}`);
    if (live) {
      console.log(`  learned recipes   ${live.recipes} · telemetry coverage ${live.telemetryCoveragePct}%`);
      console.log(`  workflow success  ${live.workflowSuccessPct}% (${live.successes}/${live.attempts})`);
      console.log(`  tool completion   ${live.toolCompletionPct}% · failure ${live.toolFailurePct}% · invalid args ${live.invalidArgPct}% · retries ${live.retryPct}%`);
      console.log(`  avg tool latency  ${live.averageStepDurationMs}ms across ${live.timedSteps} timed steps`);
    }
    console.log("  cross-agent       contract ready; all runners expose non-interactive agent turns, but ranking still requires the same model + scratch-only scenarios");
  }
  if (!fixture.passed) process.exitCode = 1;
}
if (import.meta.main) await main();
