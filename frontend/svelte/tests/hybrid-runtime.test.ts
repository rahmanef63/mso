import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildRollbackPlan, parseCliArgs, selectRuntime } from "../../../scripts/hybrid-runtime.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SCRIPT_PATH = path.join(REPO_ROOT, "scripts/hybrid-runtime.mjs");

function makeFixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mso-runtime-test-"));
  const rustBin = path.join(dir, "mso-shell-host");
  const assetsDir = path.join(dir, "build");
  const jailDir = path.join(dir, "jail");
  mkdirSync(assetsDir, { recursive: true });
  mkdirSync(jailDir, { recursive: true });
  writeFileSync(rustBin, "#!/bin/sh\n");
  writeFileSync(path.join(assetsDir, "index.html"), "<html></html>");
  return { dir, rustBin, assetsDir, jailDir };
}

test("selectRuntime defaults to next when requested is omitted or next", () => {
  const def = selectRuntime({});
  assert.equal(def.runtime, "next");
  assert.equal(def.fallback, false);
  assert.equal(def.command, null);
  assert.deepEqual(def.args, []);
  assert.equal(selectRuntime({ requested: "next" }).runtime, "next");
});

test("selectRuntime chooses hybrid when binary, build, and loopback apiOrigin exist", () => {
  const fx = makeFixture();
  try {
    for (const apiOrigin of ["http://127.0.0.1:4005", "http://localhost:4005", "https://[::1]:4443"]) {
      const res = selectRuntime({
        requested: "hybrid",
        rustBin: fx.rustBin,
        assetsDir: fx.assetsDir,
        apiOrigin,
        port: 4174,
        nativeMetrics: true,
        nativeFsRoot: fx.jailDir,
      });
      assert.equal(res.runtime, "hybrid", apiOrigin);
      assert.equal(res.fallback, false);
      assert.equal(res.command, fx.rustBin);
      assert.deepEqual(res.args, [
        "--assets", fx.assetsDir, "--port", "4174",
        "--api-origin", new URL(apiOrigin).origin, "--native-metrics", "--native-fs-root", fx.jailDir,
      ]);
    }
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("selectRuntime falls back cleanly to next on missing binary, build, or bad origin", () => {
  const fx = makeFixture();
  try {
    const noBin = selectRuntime({
      requested: "hybrid", rustBin: path.join(fx.dir, "missing"), assetsDir: fx.assetsDir, apiOrigin: "http://127.0.0.1:4005",
    });
    assert.equal(noBin.runtime, "next");
    assert.equal(noBin.fallback, true);
    assert.equal(noBin.reason, "missing_rust_binary");

    const noBuild = selectRuntime({
      requested: "hybrid", rustBin: fx.rustBin, assetsDir: path.join(fx.dir, "missing-build"), apiOrigin: "http://127.0.0.1:4005",
    });
    assert.equal(noBuild.runtime, "next");
    assert.equal(noBuild.fallback, true);
    assert.equal(noBuild.reason, "missing_svelte_build");

    for (const badOrigin of [
      "", "https://mso.example.com", "http://10.0.0.4:4005", "http://user:pass@127.0.0.1:4005",
      "http://127.0.0.1:4005/api", "http://127.0.0.1:4005/?q=1", "file:///etc/passwd",
    ]) {
      const bad = selectRuntime({ requested: "hybrid", rustBin: fx.rustBin, assetsDir: fx.assetsDir, apiOrigin: badOrigin });
      assert.equal(bad.runtime, "next", badOrigin);
      assert.equal(bad.fallback, true);
      assert.equal(bad.reason, "invalid_loopback_api_origin");
    }

    const badFs = selectRuntime({
      requested: "hybrid", rustBin: fx.rustBin, assetsDir: fx.assetsDir,
      apiOrigin: "http://127.0.0.1:4005", nativeFsRoot: path.join(fx.dir, "no-jail"),
    });
    assert.equal(badFs.fallback, true);
    assert.equal(badFs.reason, "missing_native_fs_root");

    const unknown = selectRuntime({ requested: "wasm" });
    assert.equal(unknown.runtime, "next");
    assert.equal(unknown.fallback, true);
    assert.equal(unknown.reason, "unsupported_runtime");
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("selectRuntime accepts injected env parameter and CLI --check outputs JSON", () => {
  const fx = makeFixture();
  try {
    const fromEnv = selectRuntime({
      env: {
        MSO_RUNTIME: "hybrid",
        MSO_RUST_SHELL_BIN: fx.rustBin,
        MSO_SVELTE_BUILD_DIR: fx.assetsDir,
        MSO_SVELTE_API_ORIGIN: "http://127.0.0.1:4005",
      },
    });
    assert.equal(fromEnv.runtime, "hybrid");
    assert.equal(fromEnv.fallback, false);

    const parsed = parseCliArgs(["--check", "--runtime=hybrid", `--rust-bin=${fx.rustBin}`, "--native-metrics"]);
    assert.equal(parsed.check, true);
    assert.equal(parsed.nativeMetrics, true);

    const cliOut = JSON.parse(execFileSync(process.execPath, [
      SCRIPT_PATH, "--check", "--runtime=hybrid",
      `--rust-bin=${fx.rustBin}`, `--assets=${fx.assetsDir}`, "--api-origin=http://127.0.0.1:4005",
    ], { encoding: "utf8" }));
    assert.equal(cliOut.runtime, "hybrid");
    assert.equal(cliOut.fallback, false);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("buildRollbackPlan returns deterministic zero-conversion rollback steps", () => {
  const plan = buildRollbackPlan({ currentRuntime: "hybrid", lastKnownGoodSha: "6bcb8d65" });
  assert.equal(plan.fromRuntime, "hybrid");
  assert.equal(plan.toRuntime, "next");
  assert.equal(plan.nextIntact, true);
  assert.equal(plan.stateDirectory, "~/.mso");
  assert.equal(plan.stateConversionRequired, false);
  assert.equal(plan.lastKnownGoodSha, "6bcb8d65");
  assert.equal(plan.steps.length, 4);
  assert.equal(plan.steps[0].action, "select_next_runtime");
  assert.equal(plan.steps[1].target, "~/.mso");
  assert.equal(plan.steps[3].sha, "6bcb8d65");
});
