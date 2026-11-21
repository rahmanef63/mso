import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

// Synthetic backend only: proves Stage R2A `mso-shell-host` serves the Svelte build
// with nonce CSP, CSRF depth-2, auth/device proxy, multi Set-Cookie, and minimal RSS.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SVELTE_DIR = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(SVELTE_DIR, "../..");
const BUILD_DIR = process.env.MSO_SVELTE_BUILD_DIR || path.join(SVELTE_DIR, "build");
const RUST_BIN = process.env.MSO_RUST_SHELL_BIN || path.join(REPO_ROOT, "rust-shell/target/release/mso-shell-host");

assert.ok(existsSync(path.join(BUILD_DIR, "index.html")), `missing Svelte build at ${BUILD_DIR}`);
assert.ok(existsSync(RUST_BIN), `missing Rust binary at ${RUST_BIN}`);

const readVmRssKiB = (pid) => {
  try { return Number(/^VmRSS:\s+(\d+)\s+kB/m.exec(readFileSync(`/proc/${pid}/status`, "utf8"))?.[1] ?? 0) || null; }
  catch { return null; }
};
const rawHttp = (port, wire) => new Promise((resolve, reject) => {
  const socket = createConnection({ host: "127.0.0.1", port }, () => socket.write(wire));
  let data = "";
  socket.on("data", (chunk) => { data += chunk.toString("utf8"); });
  socket.on("error", reject);
  socket.on("end", () => resolve({ status: Number(/^HTTP\/1\.1\s+(\d{3})/.exec(data)?.[1] ?? 0), raw: data }));
});
const readBody = (req) => new Promise((resolve) => {
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
});

const ownerSession = { authenticated: true, deviceId: "rust-owner-0001", deviceLabel: "Rust Shell Owner", role: "owner" };
const signedOut = { authenticated: false, deviceId: null, deviceLabel: null, role: null };
const stats = { cpu: { pct: 18.5, cores: 4 }, mem: { used: 1024 ** 3, total: 4 * 1024 ** 3 }, disk: { used: 2 * 1024 ** 3, total: 8 * 1024 ** 3 }, uptime: 3_660_000 };
let calls = [];
const seenHosts = new Set();
const devices = {
  approved: { "rust-owner-0001": { label: "Rust Shell Owner", approvedAt: 1_700_000_000_000, role: "owner" } },
  pending: { "rust-pend-0002": { label: "Mobile Safari", firstSeen: 1_700_000_001_000, lastSeen: 1_700_000_002_000, ip: "127.0.0.1", attempts: 1 } },
};

const backend = createServer(async (req, res) => {
  calls.push(`${req.method} ${req.url}`);
  seenHosts.add(req.headers.host);
  const authed = req.headers.cookie?.includes("session=rust-r2a-owner") ?? false;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.url === "/api/auth/me" && req.method === "GET") {
    res.end(JSON.stringify(authed ? ownerSession : signedOut));
  } else if (req.url === "/api/auth/login" && req.method === "POST") {
    const body = await readBody(req);
    if (body.password === "rust-pass") {
      res.setHeader("Set-Cookie", "session=rust-r2a-owner; Path=/; HttpOnly; SameSite=Strict");
      res.end(JSON.stringify({ success: true }));
    } else { res.statusCode = 401; res.end(JSON.stringify({ error: "bad_password" })); }
  } else if (req.url === "/api/auth/logout" && req.method === "POST") {
    res.setHeader("Set-Cookie", ["session=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict", "mso_aux=; Max-Age=0; Path=/"]);
    res.end(JSON.stringify({ success: true }));
  } else if (req.url === "/api/auth/devices" && req.method === "GET") {
    if (!authed) { res.statusCode = 403; res.end(JSON.stringify({ error: "Owner role required" })); return; }
    res.end(JSON.stringify(devices));
  } else if (req.url === "/api/auth/devices" && req.method === "POST") {
    if (!authed) { res.statusCode = 403; res.end(JSON.stringify({ error: "Owner role required" })); return; }
    const body = await readBody(req);
    if (body.action === "approve") {
      delete devices.pending[body.deviceId];
      devices.approved[body.deviceId] = { label: body.label || "Approved", approvedAt: Date.now(), role: body.role || "viewer" };
    }
    res.end(JSON.stringify({ ok: true, ...devices }));
  } else if (req.url === "/api/v1/sys/stats" && req.method === "GET") {
    if (!authed) { res.statusCode = 401; res.end(JSON.stringify({ error: "Unauthorized" })); return; }
    res.end(JSON.stringify(stats));
  } else { res.statusCode = 404; res.end("{}"); }
});

let hostProc, browser;
try {
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  const apiOrigin = `http://127.0.0.1:${backend.address().port}`;
  hostProc = spawn(RUST_BIN, ["--assets", BUILD_DIR, "--port", "0", "--api-origin", apiOrigin], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
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
  const expectedHost = new URL(ready).host;
  const idleRssKiB = readVmRssKiB(hostProc.pid);

  // 1. Nonce CSP check on HTML.
  const htmlRes = await fetch(`${ready}/`);
  assert.equal(htmlRes.status, 200);
  const nonce = htmlRes.headers.get("x-nonce");
  const csp = htmlRes.headers.get("content-security-policy") ?? "";
  assert.ok(nonce && nonce.length === 32, "expected 32-char hex X-Nonce header");
  assert.ok(csp.includes(`script-src 'self' 'nonce-${nonce}'`), `unexpected CSP: ${csp}`);
  assert.ok((await htmlRes.text()).includes(`<script nonce="${nonce}">`), "expected nonced bootstrap script");

  // 2. Security boundary checks (CSRF 403, 413 body limit, 405 method, 404 unlisted, 400 traversal).
  const beforeSec = calls.length;
  const csrfBlocked = await rawHttp(
    hostPort,
    `POST /api/auth/login HTTP/1.1\r\nHost: ${expectedHost}\r\nSec-Fetch-Site: cross-site\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`,
  );
  assert.equal(csrfBlocked.status, 403);
  assert.ok(csrfBlocked.raw.includes("cross_origin_blocked"));

  const tooLarge = await rawHttp(
    hostPort,
    `POST /api/auth/login HTTP/1.1\r\nHost: ${expectedHost}\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 999999\r\nConnection: close\r\n\r\n`,
  );
  assert.equal(tooLarge.status, 413);
  assert.ok(tooLarge.raw.includes("request_too_large"));
  assert.equal((await rawHttp(hostPort, `DELETE /api/auth/devices HTTP/1.1\r\nHost: ${expectedHost}\r\nSec-Fetch-Site: same-origin\r\nConnection: close\r\n\r\n`)).status, 405);

  const unlisted = await fetch(`${ready}/api/config`);
  assert.equal(unlisted.status, 404);
  assert.ok((unlisted.headers.get("content-type") ?? "").includes("application/json"));
  assert.equal((await rawHttp(hostPort, `GET /../etc/passwd HTTP/1.1\r\nHost: ${expectedHost}\r\nConnection: close\r\n\r\n`)).status, 400);
  assert.equal((await rawHttp(hostPort, `GET /%2e%2e/secret HTTP/1.1\r\nHost: ${expectedHost}\r\nConnection: close\r\n\r\n`)).status, 400);
  assert.equal((await fetch(`${ready}/_app/immutable/missing-chunk.js`)).status, 404);
  assert.equal(calls.length, beforeSec, "blocked requests must never reach loopback backend");

  // 3. Full Chromium auth + owner device approval + logout journey through Rust Stage R2A proxy.
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });

  await page.goto(ready);
  await page.getByRole("heading", { name: "Sign in to the existing cockpit" }).waitFor();
  await page.getByLabel("Cockpit password").fill("rust-pass");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForSelector("[data-monitor-state='ready']", { timeout: 10_000 });
  await page.getByText("1.0 GiB / 4.0 GiB", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "Devices & Approvals" }).waitFor();

  await page.getByRole("button", { name: "Approve" }).click();
  await page.getByText("Device approved.").waitFor();
  assert.equal(devices.approved["rust-pend-0002"]?.role, "viewer");

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Sign in to the existing cockpit" }).waitFor();
  assert.deepEqual(errors, [], `unexpected browser/CSP errors: ${errors.join("; ")}`);
  assert.deepEqual([...seenHosts], [expectedHost], "Host header must be preserved");
  await context.close();

  const activeRssKiB = readVmRssKiB(hostProc.pid);
  console.log(JSON.stringify({
    pass: true, stage: "R2A", origin: ready, idleRssKiB, activeRssKiB,
    apiCalls: calls.length, nonceCspVerified: true, csrfDepth2Verified: true, authAndDeviceJourneyVerified: true,
  }, null, 2));
} finally {
  await browser?.close();
  if (hostProc && hostProc.exitCode === null) { hostProc.kill("SIGTERM"); await once(hostProc, "exit"); }
  backend.closeAllConnections();
  await new Promise((resolve) => backend.close(resolve));
}
