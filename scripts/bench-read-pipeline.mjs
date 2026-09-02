#!/usr/bin/env bun
import { runReadPipeline } from "../lib/mcp/read-pipeline-engine.ts";

const services = { rows: Array.from({ length: 500 }, (_, i) => ({
  name: `service-${String(i).padStart(3, "0")}`, status: i % 9 === 0 ? "degraded" : "healthy",
  cpu: (i * 17) % 100, memoryMb: 128 + (i % 24) * 64, detail: `bounded-service-metadata-${i}-`.repeat(4),
})) };
const projects = { rows: Array.from({ length: 400 }, (_, i) => ({
  id: `project-${i}`, state: i % 5 === 0 ? "paused" : "active", owner: `team-${i % 12}`, branch: `feature/${i}`,
  detail: `repository-metadata-${i}-`.repeat(3),
})) };
const sessions = { rows: Array.from({ length: 300 }, (_, i) => ({
  title: `Session ${i}`, updated: 1_800_000_000_000 - i * 1000, source: i % 2 ? "mcp" : "cli", note: `session-summary-${i}-`.repeat(3),
})) };
const apps = { apps: Array.from({ length: 200 }, (_, i) => ({
  id: `app-${i}`, running: i % 3 !== 0, version: `1.${i % 20}.${i % 7}`, statusDetail: `managed-app-status-${i}-`.repeat(4),
})) };

const fixtures = new Map([
  ["fixture_services", services], ["fixture_projects", projects], ["fixture_sessions", sessions], ["fixture_apps", apps],
]);
const tools = new Map([...fixtures].map(([name, value]) => [name, {
  name, description: name, scope: "read", annotations: { readOnlyHint: true, idempotentHint: true },
  inputSchema: { type: "object", properties: {} }, run: async () => value,
}]));
const input = { calls: [
  { id: "degraded", tool: "fixture_services", transform: { path: "rows", where: [{ field: "status", op: "eq", value: "degraded" }], sort: { field: "cpu", direction: "desc" }, limit: 10, select: ["name", "cpu", "memoryMb"] } },
  { id: "activeProjects", tool: "fixture_projects", transform: { path: "rows", where: [{ field: "state", op: "eq", value: "active" }], aggregate: { op: "count" } } },
  { id: "recentSessions", tool: "fixture_sessions", transform: { path: "rows", sort: { field: "updated", direction: "desc" }, limit: 5, select: ["title", "source", "updated"] } },
  { id: "runningApps", tool: "fixture_apps", transform: { path: "apps", where: [{ field: "running", op: "eq", value: true }], limit: 10, select: ["id", "version"] } },
] };

const bytes = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");
const stable = (out) => ({
  ok: out.ok, mode: out.mode, results: out.results,
  evidence: out.evidence.map(({ id, tool, ok, rawBytes, outputBytes, reductionPct }) => ({ id, tool, ok, rawBytes, outputBytes, reductionPct })),
});

export async function runReadPipelineBenchmark() {
  const baselineBytes = [...fixtures.values()].reduce((sum, value) => sum + bytes(value), 0);
  const resolve = (name) => tools.get(name);
  const a = await runReadPipeline(input, { scope: "read", actor: "bench:pipeline-a" }, resolve);
  const b = await runReadPipeline(input, { scope: "read", actor: "bench:pipeline-b" }, resolve);
  const returnedBytes = bytes(a), reductionPct = Math.round((1 - returnedBytes / baselineBytes) * 1000) / 10;
  const expectedActiveProjects = projects.rows.filter((row) => row.state === "active").length;
  const correctness = a.results.activeProjects?.value === expectedActiveProjects
    && Array.isArray(a.results.degraded) && a.results.degraded.length === 10
    && Array.isArray(a.results.recentSessions) && a.results.recentSessions.length === 5
    && Array.isArray(a.results.runningApps) && a.results.runningApps.length === 10;
  const deterministic = JSON.stringify(stable(a)) === JSON.stringify(stable(b));
  return {
    baseline: { toolRoundTrips: input.calls.length, modelVisibleBytes: baselineBytes },
    pipeline: { toolRoundTrips: 1, modelVisibleBytes: returnedBytes, callsInsidePipeline: input.calls.length },
    savings: { roundTripReductionPct: Math.round((1 - 1 / input.calls.length) * 1000) / 10, modelVisibleByteReductionPct: reductionPct },
    correctness, deterministic,
    passed: correctness && deterministic && reductionPct >= 80,
  };
}

if (import.meta.main) {
  const result = await runReadPipelineBenchmark();
  if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    console.log("MSO read_pipeline benchmark");
    console.log(`  raw baseline       ${result.baseline.toolRoundTrips} model round-trips · ${result.baseline.modelVisibleBytes.toLocaleString()} bytes`);
    console.log(`  read_pipeline      ${result.pipeline.toolRoundTrips} model round-trip · ${result.pipeline.modelVisibleBytes.toLocaleString()} bytes`);
    console.log(`  savings            ${result.savings.roundTripReductionPct}% round-trips · ${result.savings.modelVisibleByteReductionPct}% model-visible bytes`);
    console.log(`  correctness        ${result.correctness ? "PASS" : "FAIL"} · deterministic=${result.deterministic}`);
  }
  if (!result.passed) process.exitCode = 1;
}
