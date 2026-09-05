#!/usr/bin/env node
// Run each test area in a separate Vitest process; never call an untested slice PASS.
import { classifyFeatureResult, featureSelectionMatches } from "./lib/feature-test-result.mjs";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--output")) {
  console.error("usage: node scripts/test-features.mjs [--output /path/to/report.json]");
  process.exit(2);
}
const outputDir = mkdtempSync(join(tmpdir(), "mso-feature-tests-"));
chmodSync(outputDir, 0o700);
const output = args.length ? resolve(args[1]) : join(outputDir, "summary.json");
const git = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  cwd: root, encoding: "utf8",
});
if (git.status !== 0) throw new Error("Cannot enumerate repository test files");
const allFiles = [...new Set(git.stdout.split("\0").filter(Boolean))];
const tests = allFiles.filter((file) => /\.test\.(ts|tsx)$/.test(file)
  && !file.split("/").some((part) => part.startsWith("zz-")));
const groups = new Map();
function groupFor(file) {
  const parts = file.split("/");
  if (file.startsWith("frontend/slices/")) return parts.slice(0, 3).join("/");
  if (file.startsWith("lib/")) return parts.length > 2 ? parts.slice(0, 2).join("/") : "lib/root";
  if (file.startsWith("app/api/v1/")) return parts.slice(0, 4).join("/");
  if (file.startsWith("app/api/")) return parts.slice(0, 3).join("/");
  if (file.startsWith("app/")) return parts.slice(0, 2).join("/");
  if (file.startsWith("scripts/")) return parts.length > 2 ? parts.slice(0, 2).join("/") : "scripts/root";
  return parts.length > 1 ? parts[0] : "root";
}
for (const file of tests) {
  const group = groupFor(file);
  groups.set(group, [...(groups.get(group) ?? []), file]);
}
const untestedSlices = readdirSync(join(root, "frontend/slices"), { withFileTypes: true })
  .filter((item) => item.isDirectory() && !groups.has(`frontend/slices/${item.name}`))
  .map((item) => item.name).sort();
const report = {
  revision: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(),
  startedAt: new Date().toISOString(), testFiles: tests.length,
  scope: "Repository unit/integration contracts, not live third-party or complete UI acceptance",
  untestedSlices, groups: [],
};
let failed = false;
for (const [name, files] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
  const basename = name.replaceAll("/", "-");
  const resultFile = join(outputDir, `${basename}.json`);
  const configFile = join(outputDir, `${basename}.config.mts`);
  // CLI filters match substrings, even with absolute paths. Override include
  // instead, then independently verify the exact result-file inventory below.
  const exactIncludes = files.map((file) => file.replace(/[\\?*{}\[\]]/g, "\\$&"));
  writeFileSync(configFile,
    `import base from ${JSON.stringify(join(root, "vitest.config.mts"))};\nexport default {...base, test: {...base.test, include: ${JSON.stringify(exactIncludes)}}};\n`,
    { mode: 0o600 });
  const started = Date.now();
  const result = spawnSync(join(root, "node_modules/.bin/vitest"), [
    "run", "--config", configFile, "--maxWorkers=2", "--reporter=json", `--outputFile=${resultFile}`,
  ], { cwd: root, encoding: "utf8", timeout: 240_000, maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, CI: "1", NO_COLOR: "1" } });
  let parsed = {};
  try { parsed = JSON.parse(readFileSync(resultFile, "utf8")); } catch { /* reported as failure */ }
  const row = {
    name, files: files.length, total: parsed.numTotalTests ?? 0,
    passed: parsed.numPassedTests ?? 0, failed: parsed.numFailedTests ?? 0,
    skipped: (parsed.numPendingTests ?? 0) + (parsed.numTodoTests ?? 0),
    status: featureSelectionMatches(files.map((file) => resolve(root, file)), parsed.testResults)
      ? classifyFeatureResult(result.status, parsed) : "FAIL",
    durationMs: Date.now() - started,
  };
  if (row.status === "FAIL") {
    failed = true;
    writeFileSync(join(outputDir, `${basename}.log`), `${result.stdout ?? ""}\n${result.stderr ?? ""}`, { mode: 0o600 });
  }
  report.groups.push(row);
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`${row.status} ${name}: ${row.passed}/${row.total} tests, ${row.skipped} skipped (${files.length} files)`);
}
report.finishedAt = new Date().toISOString();
report.success = !failed && report.groups.every((row) => row.status === "PASS");
report.incomplete = !failed && !report.success;
report.totals = report.groups.reduce((sum, row) => ({
  total: sum.total + row.total, passed: sum.passed + row.passed,
  failed: sum.failed + row.failed, skipped: sum.skipped + row.skipped,
}), { total: 0, passed: 0, failed: 0, skipped: 0 });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(`No colocated unit tests (not a PASS): ${untestedSlices.join(", ") || "none"}`);
console.log(`Report: ${output}`);
console.log(`Private diagnostics: ${outputDir}`);
console.log(`Evidence: ${failed ? "FAIL" : report.incomplete ? "INCOMPLETE (skipped tests)" : "PASS"}`);
process.exit(failed ? 1 : report.incomplete ? 2 : 0);
