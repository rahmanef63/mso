#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roundMs = (value) => Number(value.toFixed(3));

function parseArgs(argv) {
  const opts = {
    rustBin: path.join(REPO_ROOT, "rust-shell/target/release/mso-shell-host"),
    assetsDir: path.join(REPO_ROOT, "frontend/svelte/build"),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--rust-bin=")) opts.rustBin = arg.slice(11);
    else if (arg === "--rust-bin") opts.rustBin = argv[++i] ?? opts.rustBin;
    else if (arg.startsWith("--assets=")) opts.assetsDir = arg.slice(9);
    else if (arg === "--assets") opts.assetsDir = argv[++i] ?? opts.assetsDir;
  }
  return opts;
}

function readGitSha() {
  try { return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim(); }
  catch { return "unknown"; }
}

function readVmRssKiB(pid) {
  try {
    const match = /^VmRSS:\s+(\d+)\s+kB/m.exec(readFileSync(`/proc/${pid}/status`, "utf8"));
    return match ? Number(match[1]) : null;
  } catch { return null; }
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const pick = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    samples: sorted.length,
    minMs: roundMs(sorted[0]),
    p50Ms: roundMs(pick(50)),
    p95Ms: roundMs(pick(95)),
    p99Ms: roundMs(pick(99)),
    maxMs: roundMs(sorted[sorted.length - 1]),
    meanMs: roundMs(sum / sorted.length),
  };
}

function httpGet({ port, target, headers = {} }) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const req = http.request({ host: "127.0.0.1", port, path: target, method: "GET", headers, agent: false }, (res) => {
      const ttfbMs = performance.now() - start;
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        body: Buffer.concat(chunks).toString("utf8"),
        ttfbMs,
        totalMs: performance.now() - start,
      }));
    });
    req.on("error", reject);
    req.end();
  });
}

const opts = parseArgs(process.argv.slice(2));
assert.ok(existsSync(opts.rustBin), `missing compiled Rust binary: ${opts.rustBin}`);
assert.ok(existsSync(path.join(opts.assetsDir, "index.html")), `missing Svelte build: ${opts.assetsDir}`);

const jailDir = mkdtempSync(path.join(os.tmpdir(), "mso-bench-jail-"));
mkdirSync(path.join(jailDir, "nested"), { recursive: true });
writeFileSync(path.join(jailDir, "bench-alpha.txt"), "alpha");
writeFileSync(path.join(jailDir, "bench-beta.md"), "beta");
writeFileSync(path.join(jailDir, "nested", "bench-gamma.json"), '{"ok":true}');
writeFileSync(path.join(jailDir, "readme.txt"), "other");
writeFileSync(path.join(jailDir, ".env"), "SECRET=never-expose");

let backendHits = 0;
const syntheticStats = JSON.stringify({
  cpu: { pct: 5, cores: os.cpus().length },
  mem: { used: 1024 ** 3, total: os.totalmem() },
  disk: { used: 2 * 1024 ** 3, total: 8 * 1024 ** 3 },
  uptime: Math.floor(os.uptime() * 1000),
});
const backend = http.createServer((req, res) => {
  backendHits += 1;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (req.url === "/api/v1/sys/stats") res.end(syntheticStats);
  else if (req.url === "/api/auth/me") res.end('{"authenticated":true,"role":"owner"}');
  else { res.statusCode = 404; res.end("{}"); }
});

let hostProc = null;
try {
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  const backendPort = backend.address().port;
  const apiOrigin = `http://127.0.0.1:${backendPort}`;

  const spawnStart = performance.now();
  hostProc = spawn(opts.rustBin, [
    "--assets", opts.assetsDir, "--port", "0", "--api-origin", apiOrigin,
    "--native-metrics", "--native-fs-root", jailDir,
  ], { stdio: ["ignore", "pipe", "pipe"] });

  let stdout = "", stderr = "";
  const readyUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`mso-shell-host timeout: ${stderr}`)), 10_000);
    hostProc.stdout.on("data", (c) => {
      stdout += c.toString();
      const m = /MSO_RUST_SHELL_READY\s+(http:\/\/127\.0\.0\.1:\d+)/.exec(stdout);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    hostProc.stderr.on("data", (c) => { stderr += c.toString(); });
    hostProc.once("exit", (code) => { clearTimeout(timer); reject(new Error(`mso-shell-host exited ${code}: ${stderr}`)); });
  });
  const startupReadyMs = roundMs(performance.now() - spawnStart);
  const rustPort = Number(new URL(readyUrl).port);
  const idleRssKiB = readVmRssKiB(hostProc.pid);

  const healthz = await httpGet({ port: rustPort, target: "/healthz" });
  assert.equal(healthz.status, 200);

  const hitsBeforeNative = backendHits;
  const nativeStatsSamples = [];
  for (let i = 0; i < 100; i += 1) {
    const res = await httpGet({ port: rustPort, target: "/api/v1/sys/stats", headers: { Cookie: "session=bench-owner" } });
    assert.equal(res.status, 200);
    assert.equal(res.headers["x-mso-native-handler"], "sys_metrics");
    nativeStatsSamples.push(res.totalMs);
  }

  const rootHtmlTtfbSamples = [];
  for (let i = 0; i < 50; i += 1) {
    const res = await httpGet({ port: rustPort, target: "/" });
    assert.equal(res.status, 200);
    assert.ok(res.headers["content-security-policy"] && res.headers["x-nonce"], "missing CSP or X-Nonce");
    assert.ok(res.body.includes(`nonce="${res.headers["x-nonce"]}"`), "missing injected script nonce");
    rootHtmlTtfbSamples.push(res.ttfbMs);
  }

  const nativeFsSamples = [];
  for (let i = 0; i < 50; i += 1) {
    const res = await httpGet({ port: rustPort, target: "/api/v1/fs/search?q=bench", headers: { Cookie: "session=bench-owner" } });
    assert.equal(res.status, 200);
    assert.equal(res.headers["x-mso-native-handler"], "fs_jail");
    const parsed = JSON.parse(res.body);
    assert.ok(Array.isArray(parsed.matches) && parsed.matches.length >= 3);
    assert.equal(parsed.matches.some((m) => m.includes(".env")), false);
    nativeFsSamples.push(res.totalMs);
  }
  const upstreamCallsDuringNative = backendHits - hitsBeforeNative;
  assert.equal(upstreamCallsDuringNative, 0, "native endpoints must not hit synthetic backend");
  const activeRssKiB = readVmRssKiB(hostProc.pid);

  const syntheticBackendSamples = [];
  for (let i = 0; i < 100; i += 1) {
    const res = await httpGet({ port: backendPort, target: "/api/v1/sys/stats" });
    assert.equal(res.status, 200);
    syntheticBackendSamples.push(res.totalMs);
  }

  console.log(JSON.stringify({
    kind: "same-host-hybrid-benchmark",
    timestamp: new Date().toISOString(),
    host: {
      gitSha: readGitSha(), nodeVersion: process.version, cpus: os.cpus().length,
      totalMemMiB: Math.round(os.totalmem() / (1024 * 1024)), platform: os.platform(), arch: os.arch(),
    },
    rustHost: {
      binary: path.relative(REPO_ROOT, opts.rustBin), assetsDir: path.relative(REPO_ROOT, opts.assetsDir),
      startupReadyMs, idleRssKiB, activeRssKiB, healthzLatencyMs: roundMs(healthz.totalMs), upstreamCallsDuringNative,
      nativeSysStats: { handler: "sys_metrics", ...summarize(nativeStatsSamples) },
      rootHtmlCspTtfb: summarize(rootHtmlTtfbSamples),
      nativeFsSearch: { handler: "fs_jail", query: "bench", ...summarize(nativeFsSamples) },
    },
    syntheticLoopbackBackend: {
      note: "Same-host Node http.createServer fixture returning static JSON (not full Next.js SSR).",
      sysStats: summarize(syntheticBackendSamples),
    },
  }, null, 2));
} finally {
  if (hostProc && hostProc.exitCode === null) {
    hostProc.kill("SIGTERM");
    await Promise.race([once(hostProc, "exit"), new Promise((r) => setTimeout(r, 2_000))]);
    if (hostProc.exitCode === null) hostProc.kill("SIGKILL");
  }
  backend.closeAllConnections();
  await new Promise((resolve) => backend.close(resolve));
  rmSync(jailDir, { recursive: true, force: true });
}
