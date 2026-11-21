#!/usr/bin/env node
// Change-aware modular gate planner. Classifies changed paths into domains and
// computes the minimum sound verification plan without silently dropping checks.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASE_E2E_JOURNEYS, selectJourneys } from "../e2e/manifest.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ALL_CHECKS = ["architecture", "cycles", "features", "docs", "changelog", "contrast", "instance-literals"];
const ALL_E2E = RELEASE_E2E_JOURNEYS.map((j) => j.id);
const CORE_PREFIXES = [
  "app/", "components/", "frontend/slices/appshell/", "frontend/slices/os-shell/",
  "lib/auth/", "lib/host/", "lib/api/", "lib/contracts/", "lib/security/",
  "lib/mcp/", "lib/capabilities/", "scripts/", "bin/",
];
const CORE_FILES = new Set([
  "package.json", "bun.lock", "next.config.mjs", "proxy.ts", "instrumentation.ts",
  "tsconfig.json", "vitest.config.mts", "eslint.config.mjs",
  "architecture.boundaries.json", "feature.boundaries.json",
]);

export function classifyChanges(changedFiles) {
  const files = [...new Set(changedFiles.map((f) => f.trim()).filter(Boolean))].sort();
  const slices = new Set();
  const libDomains = new Set();
  let core = false, svelte = false, deps = false, docs = false, nonDoc = false;

  for (const file of files) {
    if (file.endsWith(".md") || file.startsWith("docs/")) { docs = true; continue; }
    nonDoc = true;
    if (file === "package.json" || file === "bun.lock" || file.startsWith("patches/")) {
      deps = true; core = true; continue;
    }
    if (file.startsWith("frontend/svelte/")) { svelte = true; continue; }
    if (CORE_FILES.has(file) || CORE_PREFIXES.some((p) => file.startsWith(p))) core = true;
    const sliceMatch = file.match(/^frontend\/slices\/([^/]+)\//);
    if (sliceMatch) { slices.add(sliceMatch[1]); continue; }
    const libMatch = file.match(/^lib\/([^/]+)\//);
    if (libMatch) { libDomains.add(libMatch[1]); continue; }
    if (!file.startsWith("public/") && !file.startsWith("templates/")) core = true;
  }

  return {
    files, core, svelte, deps, docs,
    docsOnly: files.length > 0 && !nonDoc,
    slices: [...slices].sort(),
    libDomains: [...libDomains].sort(),
  };
}

export function buildGatePlan(changedFiles, { forceFull = false, repoRoot = ROOT } = {}) {
  const c = classifyChanges(changedFiles);
  if (forceFull || c.files.length === 0) {
    return {
      mode: "full",
      reason: forceFull ? "forced full mode" : "no diff detected; defaulting safely to full",
      classification: c,
      steps: {
        typecheck: true, lintTargets: ["."], staticChecks: ALL_CHECKS,
        vitestTargets: "all", svelte: true, auditStrict: true,
        buildAndE2e: true, e2eJourneys: ALL_E2E,
      },
    };
  }
  if (c.docsOnly) {
    return {
      mode: "docs-only",
      reason: "only documentation/markdown files changed",
      classification: c,
      steps: {
        typecheck: false, lintTargets: [], staticChecks: ["docs", "changelog", "instance-literals"],
        vitestTargets: [], svelte: false, auditStrict: false,
        buildAndE2e: false, e2eJourneys: [],
      },
    };
  }
  if (c.svelte && !c.core && c.slices.length === 0 && c.libDomains.length === 0) {
    return {
      mode: "svelte-only",
      reason: "only isolated frontend/svelte package changed",
      classification: c,
      steps: {
        typecheck: false, lintTargets: [], staticChecks: ["instance-literals"],
        vitestTargets: [], svelte: true, auditStrict: false,
        buildAndE2e: false, e2eJourneys: [],
      },
    };
  }
  if (!c.core && (c.slices.length > 0 || c.libDomains.length > 0)) {
    const vitestTargets = [
      ...c.slices.map((s) => `frontend/slices/${s}`),
      ...c.libDomains.map((d) => `lib/${d}`),
    ].filter((dir) => existsSync(path.join(repoRoot, dir)));
    const lintTargets = c.files.filter((f) => /\.(ts|tsx|js|mjs|cjs)$/.test(f) && existsSync(path.join(repoRoot, f)));
    return {
      mode: "modular",
      reason: `scoped to ${[...c.slices.map((s) => `slice:${s}`), ...c.libDomains.map((d) => `lib:${d}`)].join(", ")}`,
      classification: c,
      steps: {
        typecheck: true,
        lintTargets: lintTargets.length ? lintTargets : ["."],
        staticChecks: ["architecture", "cycles", "features", "docs", "contrast", "instance-literals"],
        vitestTargets: vitestTargets.length ? vitestTargets : "all",
        svelte: c.svelte, auditStrict: false, buildAndE2e: true,
        e2eJourneys: selectJourneys({ core: false, slices: c.slices, domains: c.libDomains }),
      },
    };
  }
  return {
    mode: "full",
    reason: "core shell, host API, scripts, or dependencies changed",
    classification: c,
    steps: {
      typecheck: true, lintTargets: ["."], staticChecks: ALL_CHECKS,
      vitestTargets: "all", svelte: c.svelte || c.deps, auditStrict: true,
      buildAndE2e: true, e2eJourneys: ALL_E2E,
    },
  };
}

export function detectChangedFiles({ base = "origin/main", cwd = ROOT } = {}) {
  const out = new Set();
  const runGit = (args) => {
    try {
      return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
        .split("\n").map((s) => s.trim()).filter(Boolean);
    } catch { return []; }
  };
  for (const args of [
    ["diff", "--name-only", `${base}...HEAD`],
    ["diff", "--name-only"],
    ["diff", "--name-only", "--cached"],
    ["ls-files", "--others", "--exclude-standard"],
  ]) {
    for (const f of runGit(args)) out.add(f);
  }
  return [...out].sort();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const baseIdx = args.indexOf("--base");
  const base = baseIdx >= 0 && args[baseIdx + 1] ? args[baseIdx + 1] : "origin/main";
  const filesIdx = args.indexOf("--files");
  const changed = filesIdx >= 0 && args[filesIdx + 1]
    ? args[filesIdx + 1].split(",").map((s) => s.trim()).filter(Boolean)
    : detectChangedFiles({ base });
  const plan = buildGatePlan(changed, { forceFull: args.includes("--full") });
  if (args.includes("--json")) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    console.log(`gate-plan: mode=${plan.mode} (${plan.reason})`);
    console.log(`  changed files : ${plan.classification.files.length}`);
    console.log(`  typecheck     : ${plan.steps.typecheck}`);
    console.log(`  lint targets  : ${plan.steps.lintTargets.length ? plan.steps.lintTargets.join(", ") : "skip"}`);
    console.log(`  static checks : ${plan.steps.staticChecks.join(", ")}`);
    console.log(`  vitest        : ${Array.isArray(plan.steps.vitestTargets) ? (plan.steps.vitestTargets.join(", ") || "skip") : plan.steps.vitestTargets}`);
    console.log(`  svelte        : ${plan.steps.svelte}`);
    console.log(`  e2e journeys  : ${plan.steps.e2eJourneys.length ? plan.steps.e2eJourneys.join(", ") : "skip"}`);
  }
}
