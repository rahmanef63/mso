#!/usr/bin/env node
// Runs the dynamic, change-aware gate plan from scripts/ci/affected.mjs.
// Use --with-build to include out-of-tree Next build + selected E2E journeys,
// or --full to run the complete pre-push release gate.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGatePlan, detectChangedFiles } from "./ci/affected.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const forceFull = args.includes("--full");
const withBuild = args.includes("--with-build");
const baseIdx = args.indexOf("--base");
const base = baseIdx >= 0 && args[baseIdx + 1] ? args[baseIdx + 1] : "origin/main";

const plan = buildGatePlan(detectChangedFiles({ base, cwd: ROOT }), { forceFull, repoRoot: ROOT });

function execStep(label, cmd, cmdArgs, extraEnv = {}) {
  console.log(`\n▶ [smart-gate] ${label}`);
  const result = spawnSync(cmd, cmdArgs, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) {
    console.error(`❌ [smart-gate] failed at: ${label}`);
    process.exit(result.status ?? 1);
  }
}

console.log(`MSO Smart Gate | mode=${plan.mode} | reason=${plan.reason}`);

if (forceFull) {
  execStep("full repository gates", "bash", ["scripts/gates.sh"]);
  process.exit(0);
}

const CHECK_MAP = {
  architecture: ["node", ["scripts/check-architecture.mjs"]],
  cycles: ["node", ["scripts/check-cycles.mjs"]],
  features: ["node", ["scripts/check-features.mjs"]],
  docs: ["node", ["scripts/check-docs.mjs"]],
  changelog: ["node", ["scripts/gen-changelog.mjs", "--check"]],
  contrast: ["node", ["scripts/check-contrast.mjs"]],
  "instance-literals": ["node", ["scripts/check-instance-literals.mjs"]],
};

if (plan.steps.typecheck) {
  execStep("typecheck", "bun", ["run", "typecheck"]);
}
if (plan.steps.lintTargets.length > 0) {
  execStep(
    `lint (${plan.steps.lintTargets.length} target(s))`,
    "node",
    ["node_modules/eslint/bin/eslint.js", "--max-warnings=0", ...plan.steps.lintTargets],
  );
}
for (const check of plan.steps.staticChecks) {
  const entry = CHECK_MAP[check];
  if (entry) execStep(`check:${check}`, entry[0], entry[1]);
}
if (plan.steps.vitestTargets === "all") {
  execStep("vitest (all)", "bun", ["run", "test"]);
} else if (Array.isArray(plan.steps.vitestTargets) && plan.steps.vitestTargets.length > 0) {
  execStep(
    `vitest (${plan.steps.vitestTargets.join(", ")})`,
    "node",
    ["node_modules/vitest/vitest.mjs", "run", ...plan.steps.vitestTargets],
  );
}
if (plan.steps.svelte) {
  execStep("svelte checks", "node", ["scripts/run-svelte-if-changed.mjs"], { MSO_VERIFY_FULL: "1" });
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
