#!/usr/bin/env bun
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function modelFamily(value = "") {
  const raw = String(value).toLowerCase().trim();
  return raw.split("/").at(-1)?.replace(/^models\//, "") || raw;
}
export function sameModelFamily(reported, requested) { return modelFamily(reported) === modelFamily(requested); }

export function benchmarkPrompt(file) {
  return [
    "READ-ONLY benchmark. You must use a filesystem/read tool to inspect the JSON file at:", file,
    "Do not modify any file and do not use information from the prompt as a substitute for reading the file.",
    "From the file, read nonce, alpha, beta, gamma. Compute alpha*2 + beta*3 + gamma.",
    "Reply with exactly BENCH:<nonce>:<integer> and no other text.",
  ].join("\n");
}

export function expectedAnswer(fixture) { return `BENCH:${fixture.nonce}:${fixture.alpha * 2 + fixture.beta * 3 + fixture.gamma}`; }

function strings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => strings(v, out));
  return out;
}
function jsonMaybe(text) {
  try { return JSON.parse(text); } catch {}
  const lines = String(text).trim().split(/\r?\n/).reverse();
  for (const line of lines) { try { return JSON.parse(line); } catch {} }
  return null;
}
function reportedModel(value) {
  if (!value || typeof value !== "object") return null;
  for (const [key, candidate] of Object.entries(value)) {
    if (["model", "modelId", "model_id"].includes(key) && typeof candidate === "string") return candidate;
    const nested = reportedModel(candidate); if (nested) return nested;
  }
  return null;
}
function tokenUsage(value) {
  if (!value || typeof value !== "object") return null;
  const obj = value;
  const n = (value) => value === null || value === undefined || value === "" ? Number.NaN : Number(value);
  const input = n(obj.inputTokens ?? obj.input_tokens ?? obj.prompt_tokens);
  const output = n(obj.outputTokens ?? obj.output_tokens ?? obj.completion_tokens);
  const total = n(obj.totalTokens ?? obj.total_tokens);
  if ([input, output, total].some(Number.isFinite)) return { inputTokens: Number.isFinite(input) ? input : undefined, outputTokens: Number.isFinite(output) ? output : undefined, totalTokens: Number.isFinite(total) ? total : (Number.isFinite(input) && Number.isFinite(output) ? input + output : undefined) };
  for (const candidate of Object.values(obj)) { const nested = tokenUsage(candidate); if (nested) return nested; }
  return null;
}

function run(command, args, cwd, timeoutMs = 180_000) {
  const start = performance.now();
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env: process.env });
  return { command, args, code: result.status, signal: result.signal, stdout: result.stdout || "", stderr: result.stderr || "", latencyMs: Math.round(performance.now() - start), error: result.error?.message };
}

function scoreRun(agent, raw, expected, requestedModel, usageFile = null) {
  const parsed = jsonMaybe(raw.stdout.trim());
  let usage = parsed ? tokenUsage(parsed) : null;
  let model = parsed ? reportedModel(parsed) : null;
  if (usageFile) {
    try { const report = JSON.parse(readFileSync(usageFile, "utf8")); usage = tokenUsage(report) ?? usage; model = reportedModel(report) ?? model; } catch {}
  }
  const textPool = [raw.stdout, ...(parsed ? strings(parsed) : [])];
  const matched = textPool.some((text) => text.includes(expected));
  return {
    agent, success: raw.code === 0 && matched, matched, exitCode: raw.code, signal: raw.signal,
    latencyMs: raw.latencyMs, reportedModel: model, modelFamilyMatch: model ? sameModelFamily(model, requestedModel) : null,
    usage, ...(raw.error ? { error: raw.error } : {}),
    ...(raw.code !== 0 ? { stderrTail: raw.stderr.slice(-700) } : {}),
  };
}

export function buildRunnerPlan({ prompt, model, provider = "openai-codex", cwd, usageFile }) {
  return {
    mso: { command: path.join(cwd, "bin/mso"), args: ["agent", "--oneshot", prompt, "--json"] },
    hermes: { command: "hermes", args: ["--oneshot", prompt, "--model", `${provider}/${model}`, "--provider", provider, "--usage-file", usageFile] },
    openclaw: { command: "openclaw", args: ["agent", "--local", "--message", prompt, "--model", `${provider}/${model}`, "--json", "--session-id", `mso-bench-${Date.now()}`] },
  };
}

async function main() {
  const args = process.argv.slice(2), runIt = args.includes("--run"), json = args.includes("--json");
  const mi = args.indexOf("--model"), model = mi >= 0 ? args[mi + 1] : "gpt-5.6-terra";
  const pi = args.indexOf("--provider"), provider = pi >= 0 ? args[pi + 1] : (process.env.MSO_BENCH_PROVIDER || "openai-codex");
  if (!model || model.startsWith("-")) throw new Error("--model requires a model family such as gpt-5.6-terra");
  if (!provider || provider.startsWith("-")) throw new Error("--provider requires a provider id such as openai-codex");
  const scratch = path.join(os.homedir(), ".cache", "mso-benchmarks", `agent-compare-${Date.now()}-${randomBytes(3).toString("hex")}`);
  mkdirSync(scratch, { recursive: true, mode: 0o700 });
  const fixture = { nonce: randomBytes(6).toString("hex"), alpha: 17, beta: 29, gamma: 41 };
  const file = path.join(scratch, "fixture.json"); writeFileSync(file, `${JSON.stringify(fixture)}\n`, { mode: 0o600 });
  const prompt = benchmarkPrompt(file), expected = expectedAnswer(fixture), usageFile = path.join(scratch, "hermes-usage.json");
  const cwd = process.cwd(), plan = buildRunnerPlan({ prompt, model, provider, cwd, usageFile });
  if (!runIt) {
    const result = { run: false, model, provider, scratchOnly: true, promptContract: "read file via tool; exact validated answer", runners: Object.fromEntries(Object.entries(plan).map(([name, row]) => [name, { command: path.basename(row.command), args: row.args.map((v) => v === prompt ? "<prompt>" : v) }])) };
    console.log(json ? JSON.stringify(result, null, 2) : `MSO cross-agent benchmark plan\n  model ${provider}/${model}\n  runners ${Object.keys(plan).join(", ")}\n  add --run to execute the scratch-only read task`);
    rmSync(scratch, { recursive: true, force: true }); return;
  }
  const rows = [];
  try {
    for (const [agent, cfg] of Object.entries(plan)) rows.push(scoreRun(agent, run(cfg.command, cfg.args, cwd), expected, model, agent === "hermes" ? usageFile : null));
    const successful = rows.filter((row) => row.success);
    const allModelEvidenceMatches = successful.every((row) => row.modelFamilyMatch !== false);
    const result = {
      run: true, model, provider, scratchOnly: true, expectedMatchedAgents: successful.length,
      comparable: successful.length >= 2 && allModelEvidenceMatches,
      rows,
      latencyOrder: successful.slice().sort((a, b) => a.latencyMs - b.latencyMs).map((row) => row.agent),
      note: "Latency order is not an overall-agent ranking. Overall claims require multiple task classes and identical model/provider evidence.",
    };
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`MSO cross-agent read-task benchmark · model=${model}`);
      for (const row of rows) console.log(`  ${row.success ? "PASS" : "FAIL"} ${row.agent.padEnd(8)} ${row.latencyMs}ms${row.reportedModel ? ` · ${row.reportedModel}` : ""}${row.usage?.totalTokens ? ` · ${row.usage.totalTokens} tokens` : ""}`);
      console.log(`  comparable=${result.comparable} · successful=${successful.length}/3`);
      console.log(`  ${result.note}`);
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
if (import.meta.main) await main();
