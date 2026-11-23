#!/usr/bin/env node
// Runs the isolated Svelte verification steps only when frontend/svelte/** or
// root dependencies changed, in CI, or when MSO_VERIFY_FULL=1 is set.
// Skips redundant `bun install` on local parallel worktrees when node_modules is already present
// and Svelte dependencies did not change, avoiding concurrent install races across worktrees.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyChanges, detectChangedFiles } from "./ci/affected.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const forced = process.env.CI === "true" || process.env.MSO_VERIFY_FULL === "1";
const changed = detectChangedFiles({ base: "origin/main", cwd: ROOT });
const c = classifyChanges(changed);

if (!forced && changed.length > 0 && !c.svelte) {
  console.log("svelte: skipped (no frontend/svelte changes; set MSO_VERIFY_FULL=1 to force).");
  process.exit(0);
}

const hasSvelteNodeModules = existsSync(path.join(ROOT, "frontend/svelte/node_modules"));
const needsInstall = process.env.CI === "true" || !hasSvelteNodeModules || c.deps;
const scripts = [
  ...(needsInstall ? ["svelte:install"] : []),
  "svelte:check",
  "svelte:build",
  "svelte:e2e",
  "svelte:audit",
];

for (const script of scripts) {
  const res = spawnSync("bun", ["run", script], { cwd: ROOT, stdio: "inherit" });
  if (res.status !== 0) process.exit(res.status ?? 1);
}
