import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runCutoverDrill } from "../../../scripts/cutover-drill.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DRILL_SCRIPT = path.join(REPO_ROOT, "scripts/cutover-drill.mjs");

test("runCutoverDrill verifies hybrid cutover, native endpoints, rollback, fail-safe, and state immutability", async () => {
  const result = await runCutoverDrill({ repoRoot: REPO_ROOT });

  assert.equal(result.pass, true);
  assert.equal(result.cutoverVerified, true);
  assert.equal(result.nativeEndpointsVerified, true);
  assert.equal(result.rollbackVerified, true);
  assert.equal(result.failSafeFallbackVerified, true);
  assert.equal(result.stateChecksumsIdentical, true);
  assert.equal(result.upstreamNativeCalls, 0);

  assert.equal(result.checks.healthzRuntime, "mso-shell-host");
  assert.equal(result.checks.cspNonceVerified, true);
  assert.equal(result.checks.sysStatsHandler, "sys_metrics");
  assert.equal(result.checks.fsListHandler, "fs_jail");
  assert.equal(result.checks.fsReadHandler, "fs_jail");
  assert.equal(result.checks.fsEnvDeniedStatus, 403);

  assert.equal(result.rollbackPlan.toRuntime, "next");
  assert.equal(result.rollbackPlan.nextIntact, true);
  assert.equal(result.rollbackPlan.stateConversionRequired, false);

  assert.equal(result.failSafeSelection.runtime, "next");
  assert.equal(result.failSafeSelection.fallback, true);
  assert.equal(result.failSafeSelection.reason, "missing_rust_binary");
  assert.deepEqual(result.stateFiles, ["devices.json", "prefs.json", "sessions.json"]);
});

test("scripts/cutover-drill.mjs CLI prints structured JSON passing report", () => {
  const raw = execFileSync(process.execPath, [DRILL_SCRIPT], { cwd: REPO_ROOT, encoding: "utf8" });
  const parsed = JSON.parse(raw);

  assert.equal(parsed.pass, true);
  assert.equal(parsed.cutoverVerified, true);
  assert.equal(parsed.nativeEndpointsVerified, true);
  assert.equal(parsed.rollbackVerified, true);
  assert.equal(parsed.failSafeFallbackVerified, true);
  assert.equal(parsed.stateChecksumsIdentical, true);
  assert.equal(parsed.upstreamNativeCalls, 0);
});
