#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRollbackPlan, selectRuntime } from "./hybrid-runtime.mjs";

const MODULE_PATH = fileURLToPath(import.meta.url);
const DEFAULT_REPO_ROOT = path.resolve(path.dirname(MODULE_PATH), "..");
const README_CONTENT = "MSO cutover drill native fs fixture\n";
const DRILL_COOKIE = { cookie: "session=drill" };

function resolveHeadSha(repoRoot) {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch { return null; }
}

function hashStateDir(dirPath) {
  const hashes = {};
  for (const name of readdirSync(dirPath).sort()) {
    hashes[name] = createHash("sha256").update(readFileSync(path.join(dirPath, name))).digest("hex");
  }
  return hashes;
}

function seedFixtures() {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "mso-cutover-state-"));
  const jailDir = mkdtempSync(path.join(os.tmpdir(), "mso-cutover-jail-"));
  chmodSync(stateDir, 0o700);
  chmodSync(jailDir, 0o700);
  const stateFiles = {
    "devices.json": { approved: { "drill-owner": { role: "owner", approvedAt: 1700000000000 } }, pending: {} },
    "prefs.json": { theme: "dark", dockPinned: ["monitor", "files"] },
    "sessions.json": { active: [{ id: "drill", deviceId: "drill-owner", issuedAt: 1700000000000 }] },
  };
  for (const [name, data] of Object.entries(stateFiles)) {
    writeFileSync(path.join(stateDir, name), `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  }
  writeFileSync(path.join(jailDir, "readme.txt"), README_CONTENT, { mode: 0o600 });
  writeFileSync(path.join(jailDir, ".env"), "DRILL_SECRET=must-never-leak\n", { mode: 0o600 });
  return { stateDir, jailDir };
}

function waitForHostReady(child, timeoutMs = 10_000) {
  let stdout = "";
  let stderr = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`mso-shell-host timeout: ${stderr}`)), timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      const m = /MSO_RUST_SHELL_READY\s+(http:\/\/127\.0\.0\.1:\d+)/.exec(stdout);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`mso-shell-host exited ${code}: ${stderr}`)); });
  });
}

async function stopHost(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  let timer;
  const done = await Promise.race([
    once(child, "exit").then(() => true),
    new Promise((r) => { timer = setTimeout(() => r(false), 5_000); timer.unref(); }),
  ]);
  clearTimeout(timer);
  if (!done && child.exitCode === null) { child.kill("SIGKILL"); await once(child, "exit"); }
}

async function verifyEndpoints(hostOrigin, upstreamCalls) {
  const healthRes = await fetch(`${hostOrigin}/healthz`);
  assert.equal(healthRes.status, 200);
  const healthJson = await healthRes.json();
  assert.equal(healthJson.runtime, "mso-shell-host");

  const rootRes = await fetch(`${hostOrigin}/`);
  assert.equal(rootRes.status, 200);
  const nonceMatch = /'nonce-([0-9a-f]+)'/.exec(rootRes.headers.get("content-security-policy") ?? "");
  assert.ok(nonceMatch, "expected CSP nonce header on GET /");
  const rootHtml = await rootRes.text();
  assert.ok(/<html/i.test(rootHtml) && rootHtml.includes(`nonce="${nonceMatch[1]}"`), "expected HTML with CSP nonce");

  const statsRes = await fetch(`${hostOrigin}/api/v1/sys/stats`, { headers: DRILL_COOKIE });
  assert.equal(statsRes.status, 200);
  assert.equal(statsRes.headers.get("x-mso-native-handler"), "sys_metrics");
  const statsJson = await statsRes.json();
  assert.equal(typeof statsJson.cpu?.cores, "number");
  assert.equal(typeof statsJson.mem?.total, "number");

  const listRes = await fetch(`${hostOrigin}/api/v1/fs/list`, { headers: DRILL_COOKIE });
  assert.equal(listRes.status, 200);
  assert.equal(listRes.headers.get("x-mso-native-handler"), "fs_jail");
  const names = ((await listRes.json()).entries ?? []).map((e) => e.name);
  assert.ok(names.includes("readme.txt") && !names.includes(".env"), "expected readme.txt visible and .env hidden");

  const readRes = await fetch(`${hostOrigin}/api/v1/fs/read?path=readme.txt`, { headers: DRILL_COOKIE });
  assert.equal(readRes.status, 200);
  assert.equal(readRes.headers.get("x-mso-native-handler"), "fs_jail");
  assert.equal(await readRes.json(), README_CONTENT);

  const envRes = await fetch(`${hostOrigin}/api/v1/fs/read?path=.env`, { headers: DRILL_COOKIE });
  assert.equal(envRes.status, 403);
  assert.equal(envRes.headers.get("x-mso-native-handler"), "fs_jail");
  assert.equal(upstreamCalls.length, 0, `expected 0 upstream calls, got ${upstreamCalls.join(", ")}`);

  return {
    healthzRuntime: healthJson.runtime, cspNonceVerified: true,
    sysStatsHandler: statsRes.headers.get("x-mso-native-handler"),
    fsListHandler: listRes.headers.get("x-mso-native-handler"),
    fsReadHandler: readRes.headers.get("x-mso-native-handler"),
    fsEnvDeniedStatus: envRes.status,
  };
}

export async function runCutoverDrill(opts = {}) {
  const repoRoot = opts.repoRoot ? path.resolve(opts.repoRoot) : DEFAULT_REPO_ROOT;
  const rustBin = opts.rustBin ?? path.join(repoRoot, "rust-shell/target/release/mso-shell-host");
  const assetsDir = opts.assetsDir ?? path.join(repoRoot, "frontend/svelte/build");
  const lastKnownGoodSha = opts.lastKnownGoodSha ?? resolveHeadSha(repoRoot);
  const { stateDir, jailDir } = seedFixtures();
  const beforeHashes = hashStateDir(stateDir);
  const upstreamCalls = [];
  const upstream = createServer((req, res) => {
    upstreamCalls.push(`${req.method} ${req.url ?? "/"}`);
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end('{"error":"unexpected_upstream_call"}');
  });

  let hostProc = null;
  try {
    const cutoverSel = selectRuntime({
      requested: "hybrid", rustBin, assetsDir,
      apiOrigin: "http://127.0.0.1:4005", nativeMetrics: true, nativeFsRoot: jailDir,
    });
    assert.equal(cutoverSel.runtime, "hybrid", `expected hybrid, got ${cutoverSel.runtime} (${cutoverSel.reason})`);
    assert.equal(cutoverSel.fallback, false);

    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const addr = upstream.address();
    assert.ok(addr && typeof addr === "object");

    const spawnSel = selectRuntime({
      requested: "hybrid", rustBin, assetsDir,
      apiOrigin: `http://127.0.0.1:${addr.port}`, port: 0, nativeMetrics: true, nativeFsRoot: jailDir,
    });
    assert.equal(spawnSel.runtime, "hybrid");
    assert.equal(spawnSel.fallback, false);

    hostProc = spawn(spawnSel.command, spawnSel.args, { stdio: ["ignore", "pipe", "pipe"] });
    const checks = await verifyEndpoints(await waitForHostReady(hostProc), upstreamCalls);
    await stopHost(hostProc);
    hostProc = null;

    const rollbackPlan = buildRollbackPlan({ currentRuntime: "hybrid", lastKnownGoodSha });
    assert.equal(rollbackPlan.fromRuntime, "hybrid");
    assert.equal(rollbackPlan.toRuntime, "next");
    assert.ok(rollbackPlan.nextIntact && !rollbackPlan.stateConversionRequired && rollbackPlan.steps.length >= 3);

    const nextSel = selectRuntime({ requested: "next" });
    assert.ok(nextSel.runtime === "next" && nextSel.fallback === false);

    const failSafe = selectRuntime({
      requested: "hybrid", rustBin: "/nonexistent/mso-shell-host", assetsDir, apiOrigin: "http://127.0.0.1:4005",
    });
    assert.deepEqual(
      { runtime: failSafe.runtime, fallback: failSafe.fallback, reason: failSafe.reason },
      { runtime: "next", fallback: true, reason: "missing_rust_binary" },
    );

    const afterHashes = hashStateDir(stateDir);
    assert.deepEqual(afterHashes, beforeHashes, "temp state directory checksums changed during drill");

    return {
      pass: true, cutoverVerified: true, nativeEndpointsVerified: true,
      rollbackVerified: true, failSafeFallbackVerified: true, stateChecksumsIdentical: true,
      upstreamNativeCalls: upstreamCalls.length, checks, rollbackPlan,
      failSafeSelection: { runtime: failSafe.runtime, fallback: failSafe.fallback, reason: failSafe.reason },
      stateFiles: Object.keys(beforeHashes), stateChecksums: afterHashes,
    };
  } finally {
    await stopHost(hostProc);
    upstream.closeAllConnections();
    if (upstream.listening) await new Promise((resolve) => upstream.close(resolve));
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(jailDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === MODULE_PATH) {
  console.log(JSON.stringify(await runCutoverDrill(), null, 2));
}
