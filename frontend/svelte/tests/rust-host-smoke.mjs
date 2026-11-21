import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

// Synthetic backend only: proves Stage R2B `mso-shell-host` serves Svelte Increment 3A
// with nonce CSP, CSRF depth-2, split-origin managed hosts, MCP passthrough, Files, Processes, and tiny RSS.
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
const procs = [{ pid: 77, name: "mso-shell-host", status: "S", cpu: 0.2, mem: 3 }];
const fsHome = { path: "/home/demo", parent: "/home", entries: [{ name: "hello.txt", kind: "file", size: 15, mtime: 1_700_000_000_000 }] };

let calls = [];
const devices = {
  approved: { "rust-owner-0001": { label: "Rust Shell Owner", approvedAt: 1_700_000_000_000, role: "owner" } },
  pending: { "rust-pend-0002": { label: "Mobile Safari", firstSeen: 1_700_000_001_000, lastSeen: 1_700_000_002_000, ip: "127.0.0.1", attempts: 1 } },
};

const backend = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  calls.push(`${req.method} ${url.pathname}`);
  const authed = req.headers.cookie?.includes("session=rust-r2b-owner") ?? false;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (url.pathname === "/api/auth/me" && req.method === "GET") res.end(JSON.stringify(authed ? ownerSession : signedOut));
  else if (url.pathname === "/api/auth/login" && req.method === "POST") {
    const body = await readBody(req);
    if (body.password === "rust-pass") { res.setHeader("Set-Cookie", "session=rust-r2b-owner; Path=/; HttpOnly; SameSite=Strict"); res.end(JSON.stringify({ success: true })); }
    else { res.statusCode = 401; res.end(JSON.stringify({ error: "bad_password" })); }
  } else if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    res.setHeader("Set-Cookie", ["session=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict", "mso_aux=; Max-Age=0; Path=/"]);
    res.end(JSON.stringify({ success: true }));
  } else if (url.pathname === "/api/auth/devices" && req.method === "GET") {
    res.statusCode = authed ? 200 : 403; res.end(JSON.stringify(authed ? devices : { error: "Owner role required" }));
  } else if (url.pathname === "/api/auth/devices" && req.method === "POST") {
    const body = await readBody(req);
    if (authed && body.action === "approve") { delete devices.pending[body.deviceId]; devices.approved[body.deviceId] = { label: body.label || "Approved", approvedAt: Date.now(), role: body.role || "viewer" }; }
    res.statusCode = authed ? 200 : 403; res.end(JSON.stringify(authed ? { ok: true, ...devices } : { error: "Owner role required" }));
  } else if (url.pathname === "/api/v1/sys/stats") { res.statusCode = authed ? 200 : 401; res.end(JSON.stringify(authed ? stats : { error: "Unauthorized" })); }
  else if (url.pathname === "/api/v1/sys/processes") { res.statusCode = authed ? 200 : 401; res.end(JSON.stringify(authed ? procs : { error: "Unauthorized" })); }
  else if (url.pathname === "/api/v1/fs/list") { res.statusCode = authed ? 200 : 401; res.end(JSON.stringify(authed ? fsHome : { error: "Unauthorized" })); }
  else if (url.pathname === "/api/v1/fs/read") { res.statusCode = authed ? 200 : 401; res.end(JSON.stringify(authed ? "hello from rust" : { error: "Unauthorized" })); }
  else if (url.pathname === "/mcp" && req.method === "POST") {
    res.end(JSON.stringify({ ok: true, auth: req.headers.authorization ?? null }));
  } else if (url.pathname === "/api/v1/managed-apps/hermes/proxy/chat") {
    res.end(JSON.stringify({ app: req.headers["x-os-managed-app-host"] ?? null, routed: true }));
  } else { res.statusCode = 404; res.end("{}"); }
});

let hostProc, browser;
try {
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  const apiOrigin = `http://127.0.0.1:${backend.address().port}`;
  hostProc = spawn(RUST_BIN, [
    "--assets", BUILD_DIR, "--port", "0", "--api-origin", apiOrigin,
    "--managed-host-template", "{id}.mso.example.com",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`mso-shell-host timeout: ${stderr}`)), 10_000);
    hostProc.stdout.on("data", (c) => {
      stdout += c.toString();
      const m = /MSO_RUST_SHELL_READY\s+(http:\/\/127\.0\.0\.1:\d+)/.exec(stdout);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    hostProc.stderr.on("data", (c) => { stderr += c.toString(); });
    hostProc.once("exit", (code) => { clearTimeout(timer); reject(new Error(`mso-shell-host exited ${code}: ${stderr}`)); });
  });

  const hostPort = Number(new URL(ready).port);
  const expectedHost = new URL(ready).host;
  const idleRssKiB = readVmRssKiB(hostProc.pid);

  // 1. Nonce CSP check on HTML.
  const htmlRes = await fetch(`${ready}/`);
  const nonce = htmlRes.headers.get("x-nonce");
  assert.ok(nonce && nonce.length === 32);
  assert.ok((htmlRes.headers.get("content-security-policy") ?? "").includes(`script-src 'self' 'nonce-${nonce}'`));
  assert.ok((await htmlRes.text()).includes(`<script nonce="${nonce}">`));

  // 2. Stage R2A/R2B security boundaries (CSRF 403, 413, 405, 404, 400 traversal, split-origin & MCP).
  const beforeSec = calls.length;
  assert.equal((await rawHttp(hostPort, `POST /api/auth/login HTTP/1.1\r\nHost: ${expectedHost}\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`)).status, 403);
  assert.equal((await rawHttp(hostPort, `POST /api/auth/login HTTP/1.1\r\nHost: ${expectedHost}\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 999999\r\nConnection: close\r\n\r\n`)).status, 413);
  assert.equal((await rawHttp(hostPort, `DELETE /api/auth/devices HTTP/1.1\r\nHost: ${expectedHost}\r\nSec-Fetch-Site: same-origin\r\nConnection: close\r\n\r\n`)).status, 405);
  assert.equal((await fetch(`${ready}/api/config`)).status, 404);
  assert.equal((await rawHttp(hostPort, `GET /../etc/passwd HTTP/1.1\r\nHost: ${expectedHost}\r\nConnection: close\r\n\r\n`)).status, 400);
  assert.equal((await rawHttp(hostPort, `GET /%2e%2e/secret HTTP/1.1\r\nHost: ${expectedHost}\r\nConnection: close\r\n\r\n`)).status, 400);
  assert.equal((await rawHttp(hostPort, `GET / HTTP/1.1\r\nHost: staging.mso.example.com\r\nConnection: close\r\n\r\n`)).status, 404);
  assert.equal((await rawHttp(hostPort, `GET /_next/static/x.js HTTP/1.1\r\nHost: hermes.mso.example.com\r\nConnection: close\r\n\r\n`)).status, 404);
  assert.equal(calls.length, beforeSec, "blocked requests must never reach loopback backend");

  const mcp = await rawHttp(hostPort, `POST /mcp HTTP/1.1\r\nHost: ${expectedHost}\r\nAuthorization: Bearer tok123\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`);
  assert.equal(mcp.status, 200);
  assert.ok(mcp.raw.includes(`"auth":"Bearer tok123"`));
  const managed = await rawHttp(hostPort, `GET /chat HTTP/1.1\r\nHost: hermes.mso.example.com\r\nConnection: close\r\n\r\n`);
  assert.equal(managed.status, 200);
  assert.ok(managed.raw.includes(`"app":"hermes"`));

  // 3. Full Chromium E2E through Rust Stage R2B proxy: login -> approve -> Files -> Processes -> logout.
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });

  await page.goto(ready);
  await page.getByLabel("Cockpit password").fill("rust-pass");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForSelector("[data-monitor-state='ready']", { timeout: 10_000 });
  await page.getByRole("button", { name: "Approve" }).click();
  await page.getByText("Device approved.").waitFor();
  await page.getByRole("button", { name: "Open Files" }).click();
  await page.getByRole("button", { name: /hello\.txt/ }).click();
  await page.getByText("hello from rust").waitFor();
  await page.getByRole("button", { name: "Open Processes" }).click();
  await page.getByText("mso-shell-host").waitFor();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Sign in to the existing cockpit" }).waitFor();
  assert.deepEqual(errors, [], `unexpected browser/CSP errors: ${errors.join("; ")}`);
  await context.close();

  const activeRssKiB = readVmRssKiB(hostProc.pid);
  console.log(JSON.stringify({
    pass: true, stage: "R2B", origin: ready, idleRssKiB, activeRssKiB, apiCalls: calls.length,
    nonceCspVerified: true, csrfDepth2Verified: true, splitOriginAndMcpVerified: true, inc3aFilesAndProcessesVerified: true,
  }, null, 2));
} finally {
  await browser?.close();
  if (hostProc && hostProc.exitCode === null) { hostProc.kill("SIGTERM"); await once(hostProc, "exit"); }
  backend.closeAllConnections();
  await new Promise((resolve) => backend.close(resolve));
}
