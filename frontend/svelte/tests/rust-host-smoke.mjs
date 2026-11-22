import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

// Synthetic backend only: proves compiled Rust Stage R3F+R4 `mso-shell-host` serves Svelte Increment 4E
// (33/33 slices, 56 route policies, Camoufox, Bot Desktops, n8n, Creative Editors, LazyModals, CSRF & minimal RSS).
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
const readBody = (req) => new Promise((r) => { let s = ""; req.on("data", (c) => { s += c; }); req.on("end", () => { try { r(s ? JSON.parse(s) : {}); } catch { r({}); } }); });

const ownerSession = { authenticated: true, deviceId: "rust-owner-0001", deviceLabel: "Rust Shell Owner", role: "owner" };
const signedOut = { authenticated: false, deviceId: null, deviceLabel: null, role: null };
const stats = { cpu: { pct: 18.5, cores: 4 }, mem: { used: 1024 ** 3, total: 4 * 1024 ** 3 }, disk: { used: 2 * 1024 ** 3, total: 8 * 1024 ** 3 }, uptime: 3_660_000 };
const camStatus = { running: true, enabled: true, installed: true, viewerReady: true, activeState: "active", unit: "camoufox-vnc.service" };
const camSession = { password: "masked-password", viewerOrigin: "https://viewer.mso.example.com", viewerTicket: "masked-ticket", viewerPathPrefix: "/vnc" };
const containers = { containers: [{ id: "bot-01", name: "rust-desktop", state: "running", status: "Up 1h", labels: { user: "ops", bot: "rust" }, created: "2026-11-22T00:00:00.000Z", ports: "5901" }] };
const managedApps = { apps: [{ id: "n8n", name: "n8n", description: "Rust n8n bridge", installed: true, installationType: "docker", state: "running", healthy: true, version: "1.80.0", dashboardAvailable: true, publicDashboardUrl: "https://n8n.mso.example.com", supportedActions: ["restart"], diagnostic: null }] };
let calls = [];
const devices = { approved: { "rust-owner-0001": { label: "Rust Shell Owner", approvedAt: 1_700_000_000_000, role: "owner" } }, pending: {} };

const backend = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  calls.push(`${req.method} ${url.pathname}`);
  const authed = req.headers.cookie?.includes("session=rust-r3f-owner") ?? false;
  res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
  if (url.pathname === "/api/auth/me") res.end(JSON.stringify(authed ? ownerSession : signedOut));
  else if (url.pathname === "/api/auth/login" && req.method === "POST") {
    const body = await readBody(req);
    if (body.password === "rust-pass") { res.setHeader("Set-Cookie", "session=rust-r3f-owner; Path=/; HttpOnly; SameSite=Strict"); res.end(JSON.stringify({ success: true })); }
    else { res.statusCode = 401; res.end(JSON.stringify({ error: "bad_password" })); }
  } else if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    res.setHeader("Set-Cookie", ["session=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict"]); res.end(JSON.stringify({ success: true }));
  } else if (url.pathname === "/api/auth/devices") { res.statusCode = authed ? 200 : 403; res.end(JSON.stringify(authed ? devices : {})); }
  else if (url.pathname === "/api/v1/sys/stats") { res.statusCode = authed ? 200 : 401; res.end(JSON.stringify(authed ? stats : {})); }
  else if (url.pathname === "/api/v1/camoufox/service") { res.statusCode = authed ? 200 : 401; res.end(JSON.stringify(authed ? camStatus : {})); }
  else if (url.pathname === "/api/v1/camoufox/session") { res.statusCode = authed ? 200 : 401; res.end(JSON.stringify(authed ? camSession : {})); }
  else if (url.pathname === "/api/v1/desktop/containers") { res.statusCode = authed ? 200 : 401; res.end(JSON.stringify(authed ? containers : {})); }
  else if (url.pathname === "/api/v1/managed-apps") { res.statusCode = authed ? 200 : 401; res.end(JSON.stringify(authed ? managedApps : {})); }
  else if (url.pathname === "/mcp" && req.method === "POST") res.end(JSON.stringify({ ok: true, auth: req.headers.authorization ?? null }));
  else if (url.pathname === "/api/v1/managed-apps/hermes/proxy/chat") res.end(JSON.stringify({ app: req.headers["x-os-managed-app-host"] ?? null }));
  else { res.statusCode = 404; res.end("{}"); }
});

let hostProc, browser;
try {
  backend.listen(0, "127.0.0.1"); await once(backend, "listening");
  const apiOrigin = `http://127.0.0.1:${backend.address().port}`;
  hostProc = spawn(RUST_BIN, ["--assets", BUILD_DIR, "--port", "0", "--api-origin", apiOrigin, "--managed-host-template", "{id}.mso.example.com"], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`mso-shell-host timeout: ${stderr}`)), 10_000);
    hostProc.stdout.on("data", (c) => { stdout += c.toString(); const m = /MSO_RUST_SHELL_READY\s+(http:\/\/127\.0\.0\.1:\d+)/.exec(stdout); if (m) { clearTimeout(timer); resolve(m[1]); } });
    hostProc.stderr.on("data", (c) => { stderr += c.toString(); });
    hostProc.once("exit", (code) => { clearTimeout(timer); reject(new Error(`mso-shell-host exited ${code}: ${stderr}`)); });
  });

  const hostPort = Number(new URL(ready).port), expectedHost = new URL(ready).host;
  const idleRssKiB = readVmRssKiB(hostProc.pid);

  const htmlRes = await fetch(`${ready}/`);
  const nonce = htmlRes.headers.get("x-nonce");
  assert.ok(nonce && nonce.length === 32);
  assert.ok((htmlRes.headers.get("content-security-policy") ?? "").includes(`script-src 'self' 'nonce-${nonce}'`));
  assert.ok((await htmlRes.text()).includes(`<script nonce="${nonce}">`));

  const beforeSec = calls.length;
  assert.equal((await rawHttp(hostPort, `POST /api/v1/fs/move HTTP/1.1\r\nHost: ${expectedHost}\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`)).status, 403);
  assert.equal((await rawHttp(hostPort, `POST /api/v1/desktop/screenshot HTTP/1.1\r\nHost: ${expectedHost}\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`)).status, 405);
  assert.equal((await fetch(`${ready}/api/config`)).status, 404);
  assert.equal((await rawHttp(hostPort, `POST /api/v1/exec/run HTTP/1.1\r\nHost: ${expectedHost}\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`)).status, 404);
  assert.equal((await rawHttp(hostPort, `POST /api/v1/editor/exec HTTP/1.1\r\nHost: ${expectedHost}\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`)).status, 404);
  assert.equal((await rawHttp(hostPort, `GET /../etc/passwd HTTP/1.1\r\nHost: ${expectedHost}\r\nConnection: close\r\n\r\n`)).status, 400);
  assert.equal(calls.length, beforeSec);

  assert.ok((await rawHttp(hostPort, `POST /mcp HTTP/1.1\r\nHost: ${expectedHost}\r\nAuthorization: Bearer tok123\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`)).raw.includes(`"auth":"Bearer tok123"`));
  assert.ok((await rawHttp(hostPort, `GET /chat HTTP/1.1\r\nHost: hermes.mso.example.com\r\nConnection: close\r\n\r\n`)).raw.includes(`"app":"hermes"`));

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });

  await page.goto(ready);
  await page.getByLabel("Cockpit password").fill("rust-pass");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForSelector("[data-monitor-state='ready']", { timeout: 10_000 });
  await page.locator(".app-dock").getByRole("button", { name: "Camoufox" }).click();
  await page.getByText("https://viewer.mso.example.com").waitFor();
  await page.getByRole("button", { name: "Close Camoufox Browser" }).click();
  await page.locator(".app-dock").getByRole("button", { name: "Bot Desktops" }).click();
  await page.getByText("rust-desktop").waitFor();
  await page.getByRole("button", { name: "Close Bot Desktops" }).click();
  await page.locator(".app-dock").getByRole("button", { name: "n8n" }).click();
  await page.getByText("Rust n8n bridge").waitFor();
  await page.getByRole("button", { name: "Close n8n" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Sign in to the existing cockpit" }).waitFor();
  assert.deepEqual(errors, [], `unexpected browser/CSP errors: ${errors.join("; ")}`);
  await context.close();

  const activeRssKiB = readVmRssKiB(hostProc.pid);
  console.log(JSON.stringify({
    pass: true, stage: "R3F+R4+Inc4E", origin: ready, idleRssKiB, activeRssKiB, apiCalls: calls.length,
    routePolicies: 56, slicesPorted: "33/33", camoufoxVerified: true, botDesktopsVerified: true, n8nVerified: true,
  }, null, 2));
} finally {
  await browser?.close();
  if (hostProc && hostProc.exitCode === null) { hostProc.kill("SIGTERM"); await once(hostProc, "exit"); }
  backend.closeAllConnections();
  await new Promise((resolve) => backend.close(resolve));
}
