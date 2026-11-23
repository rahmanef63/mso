#!/usr/bin/env node
// Runs the dynamic, change-aware gate plan from scripts/ci/affected.mjs.
//   --pr-fast    Fast feature-branch push gate: typecheck, changed-file lint,
//                affected static checks, Vitest, Svelte, and Rust targets (~5-45s).
//   --docs-main  Verified docs-only push gate for main (docs, comparison, changelog, contracts).
//   --with-build Include isolated Svelte + Rust build + browser E2E.
//   --full       Run the complete release gate (scripts/gates.sh).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DOCS_CONTRACT_TESTS, buildGatePlan, detectChangedFiles } from "./ci/affected.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const forceFull = args.includes("--full");
const prFast = args.includes("--pr-fast");
const docsMain = args.includes("--docs-main");
const withBuild = args.includes("--with-build");
const baseIdx = args.indexOf("--base");
const base = baseIdx >= 0 && args[baseIdx + 1] ? args[baseIdx + 1] : "origin/main";
const rangeIdx = args.indexOf("--range");
const range = rangeIdx >= 0 && args[rangeIdx + 1] ? args[rangeIdx + 1] : "";

const changedFiles = detectChangedFiles({ base, range, cwd: ROOT });
const plan = buildGatePlan(changedFiles, { forceFull, repoRoot: ROOT });
const parallelEnv = { VITEST_MAX_WORKERS: process.env.VITEST_MAX_WORKERS || "2" };

function execStep(label, cmd, cmdArgs, extraEnv = {}, cwd = ROOT) {
  console.log(`\n▶ [smart-gate] ${label}`);
  const result = spawnSync(cmd, cmdArgs, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) {
    console.error(`❌ [smart-gate] failed at: ${label}`);
    process.exit(result.status ?? 1);
  }
}

function affectedVitestDirs(files, isDocsOnly) {
  const targets = new Set();
  if (isDocsOnly) {
    for (const docTest of DOCS_CONTRACT_TESTS) {
      if (existsSync(path.join(ROOT, docTest))) targets.add(docTest);
    }
    return [...targets].sort();
  }
  for (const file of files) {
    if (!existsSync(path.join(ROOT, file))) continue;
    if (file.startsWith("frontend/svelte/") || file.startsWith("rust-shell/")) continue;
    const mLib = file.match(/^(lib\/[^/]+)\//);
    if (mLib) { targets.add(mLib[1]); continue; }
    const mApi = file.match(/^(app\/api\/v1\/[^/]+)\//);
    if (mApi) { targets.add(mApi[1]); continue; }
    if (file.startsWith("scripts/ci/")) { targets.add("scripts/ci"); continue; }
    if (/\.test\.(ts|tsx)$/.test(file)) { targets.add(file); continue; }
    const stem = file.replace(/\.(ts|tsx|mjs|js)$/, "");
    for (const ext of [".test.ts", ".test.tsx"]) {
      if (existsSync(path.join(ROOT, stem + ext))) targets.add(stem + ext);
    }
  }
  return [...targets].sort();
}

function runRustWorkspaceTests() {
  const rustDir = path.join(ROOT, "rust-shell");
  if (!existsSync(path.join(rustDir, "Cargo.toml"))) return;
  execStep("rust workspace tests (cargo test --workspace)", "cargo", ["test", "--workspace"], {}, rustDir);
}

const modeLabel = docsMain ? `${plan.mode}/docs-main` : prFast ? `${plan.mode}/pr-fast` : plan.mode;
console.log(`MSO Smart Gate | mode=${modeLabel} | reason=${plan.reason}`);

if (forceFull || (docsMain && plan.mode !== "docs-only")) {
  execStep("full repository gates", "bash", ["scripts/gates.sh"], { MSO_GATE_FULL: "1" });
  process.exit(0);
}

const CHECK_MAP = {
  architecture: ["node", ["scripts/check-architecture.mjs"]],
  cycles: ["node", ["scripts/check-cycles.mjs"]],
  features: ["node", ["scripts/check-features.mjs"]],
  docs: ["node", ["scripts/check-docs.mjs"]],
  comparison: ["node", ["scripts/gen-comparison.mjs", "--check"]],
  changelog: ["node", ["scripts/gen-changelog.mjs", "--check"]],
  contrast: ["node", ["scripts/check-contrast.mjs"]],
  "instance-literals": ["node", ["scripts/check-instance-literals.mjs"]],
};

if (plan.steps.typecheck) {
  execStep("typecheck", "bun", ["run", "typecheck"]);
}

const lintTargets = prFast
  ? changedFiles.filter((f) => /\.(ts|tsx|js|mjs|cjs)$/.test(f) && !f.startsWith("frontend/svelte/") && existsSync(path.join(ROOT, f)))
  : plan.steps.lintTargets;
if (lintTargets.length > 0) {
  execStep(
    `lint (${lintTargets.length} target(s))`,
    "node",
    ["node_modules/eslint/bin/eslint.js", "--max-warnings=0", ...lintTargets],
  );
}

for (const check of plan.steps.staticChecks) {
  const entry = CHECK_MAP[check];
  if (entry) execStep(`check:${check}`, entry[0], entry[1]);
}

if (prFast || docsMain) {
  const fastTests = affectedVitestDirs(changedFiles, plan.classification.docsOnly);
  if (fastTests.length > 0) {
    execStep(
      `vitest (${fastTests.length} affected target(s))`,
      "node",
      ["node_modules/vitest/vitest.mjs", "run", ...fastTests],
      parallelEnv,
    );
  }
  if (plan.classification.svelte) {
    execStep("svelte checks", "node", ["scripts/run-svelte-if-changed.mjs"], { MSO_VERIFY_FULL: "1" });
  }
  if (plan.classification.rust) {
    runRustWorkspaceTests();
  }
  console.log(`\n✅ smart-gate passed (${modeLabel}; GitHub Actions CI + bun run pr:local cover full release verification)`);
  process.exit(0);
}

if (plan.steps.vitestTargets === "all") {
  execStep("vitest (all)", "bun", ["run", "test"], parallelEnv);
} else if (Array.isArray(plan.steps.vitestTargets) && plan.steps.vitestTargets.length > 0) {
  execStep(
    `vitest (${plan.steps.vitestTargets.join(", ")})`,
    "node",
    ["node_modules/vitest/vitest.mjs", "run", ...plan.steps.vitestTargets],
    parallelEnv,
  );
}
if (plan.steps.svelte) {
  execStep("svelte checks", "node", ["scripts/run-svelte-if-changed.mjs"], { MSO_VERIFY_FULL: "1" });
}
if (plan.steps.rust) {
  runRustWorkspaceTests();
}
if (plan.steps.auditStrict) {
  execStep("dependency audit (strict)", "node", ["scripts/audit.mjs", "--strict"]);
}
if (withBuild && plan.steps.buildAndE2e) {
  const filter = plan.steps.e2eJourneys.join(",");
  execStep(
    `isolated build + affected E2E (${filter})`,
    "bash",
    ["scripts/verify-build.sh"],
    { MSO_VERIFY_E2E_FILTER: filter, MSO_E2E_JOBS: process.env.MSO_E2E_JOBS || "2" },
  );
} else if (plan.steps.buildAndE2e) {
  console.log(`\nℹ [smart-gate] build/E2E skipped (pass --with-build to run: ${plan.steps.e2eJourneys.join(", ")})`);
}

console.log(`\n✅ smart-gate passed (mode=${plan.mode})`);
