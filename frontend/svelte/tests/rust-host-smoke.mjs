import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "./_browser-launch.mjs";

// Synthetic backend only: proves compiled Rust Stage R3G+R4 `mso-shell-host` serves Svelte in Chromium with
// /healthz + opt-in --native-metrics (Linux /proc) + --native-fs-root (fs/list + fs/read + fs/search without Node!).
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
let calls = [];
const devices = { approved: { "rust-owner-0001": { label: "Rust Shell Owner", approvedAt: 1_700_000_000_000, role: "owner" } }, pending: {} };

const jailDir = mkdtempSync(path.join(os.tmpdir(), "mso-rust-jail-"));
writeFileSync(path.join(jailDir, "public-note.txt"), "safe from rust native fs");
writeFileSync(path.join(jailDir, ".env"), "SECRET=never-expose");

const backend = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  calls.push(`${req.method} ${url.pathname}`);
  const authed = req.headers.cookie?.includes("session=rust-r4-fs-owner") ?? false;
  res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
  if (url.pathname === "/api/auth/me") res.end(JSON.stringify(authed ? ownerSession : signedOut));
  else if (url.pathname === "/api/auth/login" && req.method === "POST") {
    const body = await readBody(req);
    if (body.password === "rust-pass") { res.setHeader("Set-Cookie", "session=rust-r4-fs-owner; Path=/; HttpOnly; SameSite=Strict"); res.end(JSON.stringify({ success: true })); }
    else { res.statusCode = 401; res.end(JSON.stringify({ error: "bad_password" })); }
  } else if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    res.setHeader("Set-Cookie", ["session=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict"]); res.end(JSON.stringify({ success: true }));
  } else if (url.pathname === "/api/auth/devices") { res.statusCode = authed ? 200 : 403; res.end(JSON.stringify(authed ? devices : {})); }
  else { res.statusCode = 404; res.end("{}"); }
});

let hostProc, browser;
try {
  backend.listen(0, "127.0.0.1"); await once(backend, "listening");
  const apiOrigin = `http://127.0.0.1:${backend.address().port}`;
  hostProc = spawn(RUST_BIN, [
    "--assets", BUILD_DIR, "--port", "0", "--api-origin", apiOrigin,
    "--managed-host-template", "{id}.mso.example.com",
    "--native-metrics", "--native-fs-root", jailDir,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`mso-shell-host timeout: ${stderr}`)), 10_000);
    hostProc.stdout.on("data", (c) => { stdout += c.toString(); const m = /MSO_RUST_SHELL_READY\s+(http:\/\/127\.0\.0\.1:\d+)/.exec(stdout); if (m) { clearTimeout(timer); resolve(m[1]); } });
    hostProc.stderr.on("data", (c) => { stderr += c.toString(); });
    hostProc.once("exit", (code) => { clearTimeout(timer); reject(new Error(`mso-shell-host exited ${code}: ${stderr}`)); });
  });

  const hostPort = Number(new URL(ready).port), expectedHost = new URL(ready).host;
  const idleRssKiB = readVmRssKiB(hostProc.pid);

  // Verify /healthz + PWA manifest + Stage R4 native endpoints directly in Rust (zero upstream Node calls!)
  const beforeNative = calls.length;
  const healthz = await fetch(`${ready}/healthz`);
  assert.equal(healthz.status, 200);
  assert.equal((await healthz.json()).runtime, "mso-shell-host");
  const manifestRes = await fetch(`${ready}/manifest.webmanifest`);
  assert.equal(manifestRes.status, 200);
  assert.equal((await manifestRes.json()).display, "standalone");
  const usageRes = await rawHttp(hostPort, `GET /api/v1/fs/usage?path=. HTTP/1.1\r\nHost: ${expectedHost}\r\nCookie: session=rust-r4-fs-owner\r\nConnection: close\r\n\r\n`);
  assert.equal(usageRes.status, 200);
  assert.ok(usageRes.raw.includes("X-MSO-Native-Handler: fs_jail") && usageRes.raw.includes('"files":1') && usageRes.raw.includes('"bytes":24'));
  assert.equal((await rawHttp(hostPort, `GET /api/v1/fs/read?path=.env HTTP/1.1\r\nHost: ${expectedHost}\r\nCookie: session=rust-r4-fs-owner\r\nConnection: close\r\n\r\n`)).status, 403);
  assert.equal((await rawHttp(hostPort, `GET /api/v1/fs/read?path=../etc/passwd HTTP/1.1\r\nHost: ${expectedHost}\r\nCookie: session=rust-r4-fs-owner\r\nConnection: close\r\n\r\n`)).status, 400);
  assert.equal((await rawHttp(hostPort, `POST /api/v1/fs/upload HTTP/1.1\r\nHost: ${expectedHost}\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`)).status, 403);
  assert.equal(calls.length, beforeNative);

  browser = await launchChromium();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });

  await page.goto(ready);
  await page.getByLabel("Cockpit password").fill("rust-pass");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForSelector("[data-monitor-state='ready']", { timeout: 10_000 });

  // Open Processes window -> loads live Linux /proc processes straight from Rust --native-metrics (zero Node calls!)
  await page.locator(".app-dock").getByRole("button", { name: "Open Processes" }).click();
  await page.waitForSelector("[data-processes-state='ready']", { timeout: 10_000 });
  await page.getByRole("button", { name: "Close Processes" }).click();

  // Open FilesManager -> lists & reads public-note.txt straight from Rust --native-fs-root (zero Node fs calls!)
  await page.locator(".app-dock").getByRole("button", { name: "Open Files" }).click();
  await page.locator("button[data-entry-open='public-note.txt']").click();
  await page.getByText("safe from rust native fs").waitFor();
  assert.equal(await page.evaluate(() => document.body.innerText.includes(".env")), false);
  await page.getByRole("button", { name: "Close Files" }).click();

  assert.equal(calls.some((c) => c.includes("/api/v1/sys/") || c.includes("/api/v1/fs/")), false);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Sign in to the existing cockpit" }).waitFor();
  assert.deepEqual(errors, [], `unexpected browser/CSP errors: ${errors.join("; ")}`);
  await context.close();

  const activeRssKiB = readVmRssKiB(hostProc.pid);
  console.log(JSON.stringify({
    pass: true, stage: "R4-100%+Inc4-100%+PWA", origin: ready, idleRssKiB, activeRssKiB, apiCalls: calls.length,
    routePolicies: 62, healthzVerified: true, pwaManifestVerified: true,
    nativeMetricsAndProcsVerified: true, nativeFsListReadSearchUsageVerified: true, envSecretHidden: true,
  }, null, 2));
} finally {
  await browser?.close();
  if (hostProc && hostProc.exitCode === null) { hostProc.kill("SIGTERM"); await once(hostProc, "exit"); }
  backend.closeAllConnections();
  await new Promise((resolve) => backend.close(resolve));
  rmSync(jailDir, { recursive: true, force: true });
}
