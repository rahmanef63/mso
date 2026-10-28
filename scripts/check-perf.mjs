#!/usr/bin/env node
// Perf gate. Companion to check-bundle.mjs: that one reads build output from disk and
// is deterministic; this one needs a browser and is therefore advisory on timing.
//
// Why the split: bytes decide whether a regression shipped, timings decide whether
// anyone notices. Gating hard on wall-clock numbers on a box that also serves
// production produces flakes that get muted, and a muted gate is worse than none.
// So: bytes fail the run, timings only fail on a 2x blowup against the committed
// baseline, and targets are printed but never enforced.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { parsePerfReport, summarize, perfViolations, formatTable } from "./lib/perf-report.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`cannot read ${label} at ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function measure() {
  const result = spawnSync(process.execPath, [path.join(ROOT, "scripts/perf-probe.mjs"), "--json"], {
    cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`perf probe failed (exit ${result.status}): ${(result.stderr || "").trim()}`);
  }
  return result.stdout;
}

try {
  const { values } = parseArgs({
    options: {
      report: { type: "string" },
      "report-only": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  const budget = readJson(path.join(ROOT, "scripts/perf-budget.json"), "perf budget");
  // A missing baseline is not an error: the first run after a deliberate reset has
  // nothing to compare against, and inventing a zero baseline would fail every run.
  let baseline = null;
  try {
    baseline = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/perf-baseline.json"), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const report = parsePerfReport(values.report ? fs.readFileSync(values.report, "utf8") : measure());

  if (values.json) {
    console.log(JSON.stringify({ budget, baseline, report, summary: summarize(report) }, null, 2));
  } else {
    console.log(formatTable(report));
    const targets = budget.targets ?? {};
    for (const run of summarize(report)) {
      const misses = [];
      if (Number.isFinite(targets.tbtMs) && Number.isFinite(run.tbtMs) && run.tbtMs > targets.tbtMs) misses.push(`tbt ${run.tbtMs}ms > ${targets.tbtMs}ms`);
      if (Number.isFinite(targets.lcpMs) && Number.isFinite(run.lcpMs) && run.lcpMs > targets.lcpMs) misses.push(`lcp ${run.lcpMs}ms > ${targets.lcpMs}ms`);
      // Reported, never enforced: the target is the post-migration goal in
      // docs/MSO-MIGRATION.md §3, and holding today's Next build to it would just
      // make the gate permanently red and therefore ignored.
      if (misses.length) console.log(`perf ${run.label}: above target — ${misses.join(", ")} (advisory)`);
    }
  }

  if (values["report-only"]) {
    console.log("perf: report only, budget not enforced.");
  } else {
    const failures = perfViolations(report, budget, baseline);
    if (failures.length) {
      for (const failure of failures) console.error(`perf: ${failure}`);
      process.exitCode = 1;
    } else {
      console.log("perf: within budget.");
    }
  }
} catch (error) {
  console.error(`perf: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
