import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

// Synthetic backend only: proves the Stage R0 Rust static host (`mso-shell-host`) serves
// the compiled Svelte build with per-request CSP nonces, read-only proxy allowlist, and tiny RSS.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SVELTE_DIR = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(SVELTE_DIR, "../..");
const BUILD_DIR = process.env.MSO_SVELTE_BUILD_DIR || path.join(SVELTE_DIR, "build");
const RUST_BIN = process.env.MSO_RUST_SHELL_BIN
  || path.join(REPO_ROOT, "rust-shell/target/release/mso-shell-host");

assert.ok(existsSync(path.join(BUILD_DIR, "index.html")), `missing Svelte build at ${BUILD_DIR}; run bun run svelte:build`);
assert.ok(existsSync(RUST_BIN), `missing Rust binary at ${RUST_BIN}; run cargo build --release in rust-shell/`);

function readVmRssKiB(pid) {
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    const m = /^VmRSS:\s+(\d+)\s+kB/m.exec(status);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

function rawHttpStatus(port, target) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
    });
    let data = "";
    socket.on("data", (chunk) => { data += chunk.toString("utf8"); });
    socket.on("error", reject);
    socket.on("end", () => {
      const m = /^HTTP\/1\.1\s+(\d{3})/.exec(data);
      resolve(m ? Number(m[1]) : 0);
    });
  });
}

const session = { authenticated: true, deviceId: "fixture", deviceLabel: "Rust Shell fixture", role: "viewer" };
const stats = { cpu: { pct: 18.5, cores: 4 }, mem: { used: 1024 ** 3, total: 4 * 1024 ** 3 }, disk: { used: 2 * 1024 ** 3, total: 8 * 1024 ** 3 }, uptime: 3_660_000 };
let calls = [];
let cookieSeen = false;
const seenHosts = new Set();

const backend = createServer((req, res) => {
  calls.push(`${req.method} ${req.url}`);
  seenHosts.add(req.headers.host);
  cookieSeen ||= req.headers.cookie?.includes("mso_fixture=rust_r0") ?? false;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (req.url === "/api/auth/me") res.end(JSON.stringify(session));
  else if (req.url === "/api/v1/sys/stats") res.end(JSON.stringify(stats));
  else { res.statusCode = 404; res.end("{}"); }
});

let hostProc;
let browser;
try {
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  const apiOrigin = `http://127.0.0.1:${backend.address().port}`;

  hostProc = spawn(RUST_BIN, ["--assets", BUILD_DIR, "--port", "0", "--api-origin", apiOrigin], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`mso-shell-host timeout: ${stderr}`)), 10_000);
    hostProc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const match = /MSO_RUST_SHELL_READY\s+(http:\/\/127\.0\.0\.1:\d+)/.exec(stdout);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    hostProc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    hostProc.once("exit", (code) => { clearTimeout(timer); reject(new Error(`mso-shell-host exited ${code}: ${stderr}`)); });
  });

  const hostPort = Number(new URL(ready).port);
  const idleRssKiB = readVmRssKiB(hostProc.pid);

  // Verify nonce-CSP and HTTP guard headers directly.
  const htmlRes = await fetch(`${ready}/`);
  assert.equal(htmlRes.status, 200);
  const nonce = htmlRes.headers.get("x-nonce");
  const csp = htmlRes.headers.get("content-security-policy") ?? "";
  assert.ok(nonce && nonce.length === 32, "expected 32-char hex X-Nonce header");
  assert.ok(csp.includes(`script-src 'self' 'nonce-${nonce}'`), `unexpected CSP: ${csp}`);
  assert.ok(csp.includes("frame-ancestors 'none'"), `missing frame-ancestors in CSP: ${csp}`);
  const htmlBody = await htmlRes.text();
  assert.ok(htmlBody.includes(`<script nonce="${nonce}">`), "expected nonced SvelteKit bootstrap script");

  // Verify security boundaries (method restriction, unlisted API, wire-level traversal, missing chunk).
  const beforeSec = calls.length;
  for (const method of ["POST", "PUT", "DELETE"]) {
    assert.equal((await fetch(`${ready}/api/v1/sys/stats`, { method })).status, 405);
  }
  const unlisted = await fetch(`${ready}/api/config`);
  assert.equal(unlisted.status, 404);
  assert.ok((unlisted.headers.get("content-type") ?? "").includes("application/json"));
  assert.equal(calls.length, beforeSec, "blocked routes must never reach loopback backend");
  assert.equal(await rawHttpStatus(hostPort, "/../etc/passwd"), 400);
  assert.equal(await rawHttpStatus(hostPort, "/%2e%2e/secret"), 400);
  const missingChunk = await fetch(`${ready}/_app/immutable/missing-chunk.js`);
  assert.equal(missingChunk.status, 404);
  assert.ok(!(missingChunk.headers.get("content-type") ?? "").includes("text/html"));

  // Real Chromium render under strict nonce CSP across themes and viewports.
  browser = await chromium.launch({ headless: true });
  const expectedHost = new URL(ready).host;
  for (const [colorScheme, width] of [["light", 1440], ["dark", 390]]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, colorScheme });
    await context.addCookies([{ name: "mso_fixture", value: "rust_r0", url: ready }]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
    await page.goto(ready);
    await page.waitForSelector("[data-monitor-state='ready']", { timeout: 10_000 });
    await page.getByText("1.0 GiB / 4.0 GiB", { exact: true }).waitFor();
    assert.deepEqual(errors, [], `unexpected browser/CSP errors: ${errors.join("; ")}`);
    await context.close();
  }
  assert.ok(cookieSeen, "same-origin cookie must be forwarded to loopback backend");
  assert.deepEqual([...seenHosts], [expectedHost], "Host header must be preserved");

  const activeRssKiB = readVmRssKiB(hostProc.pid);
  console.log(JSON.stringify({
    pass: true,
    origin: ready,
    idleRssKiB,
    activeRssKiB,
    apiCalls: calls.length,
    nonceCspVerified: true,
  }, null, 2));
} finally {
  await browser?.close();
  if (hostProc && hostProc.exitCode === null) {
    hostProc.kill("SIGTERM");
    await once(hostProc, "exit");
  }
  backend.closeAllConnections();
  await new Promise((resolve) => backend.close(resolve));
}
