import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

// Synthetic backend only: proves compiled Rust `mso-shell-host` serves Svelte Increment 3B
// with live SSE terminal streaming, Files mutations, Services Center, split-origin, MCP, CSRF & minimal RSS.
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
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

const ownerSession = { authenticated: true, deviceId: "rust-owner-0001", deviceLabel: "Rust Shell Owner", role: "owner" };
const signedOut = { authenticated: false, deviceId: null, deviceLabel: null, role: null };
const stats = { cpu: { pct: 18.5, cores: 4 }, mem: { used: 1024 ** 3, total: 4 * 1024 ** 3 }, disk: { used: 2 * 1024 ** 3, total: 8 * 1024 ** 3 }, uptime: 3_660_000 };
const procs = [{ pid: 77, name: "mso-shell-host", status: "S", cpu: 0.2, mem: 3 }];
const services = {
  services: [{ unit: "mso.service", scope: "user", load: "loaded", active: "active", sub: "running", description: "MSO host", controllable: true }],
  diagnostics: [], truncated: false, controlAllowlistConfigured: true, generatedAt: "2026-11-22T00:00:00.000Z",
};
const fsHome = { path: "/home/demo", parent: "/home", entries: [{ name: "hello.txt", kind: "file", size: 15, mtime: 1_700_000_000_000 }] };
let helloContent = "hello from rust";
const termStreams = new Map();
let calls = [];
const devices = {
  approved: { "rust-owner-0001": { label: "Rust Shell Owner", approvedAt: 1_700_000_000_000, role: "owner" } },
  pending: { "rust-pend-0002": { label: "Mobile Safari", firstSeen: 1_700_000_001_000, lastSeen: 1_700_000_002_000, ip: "127.0.0.1", attempts: 1 } },
};

const backend = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  calls.push(`${req.method} ${url.pathname}`);
  const authed = req.headers.cookie?.includes("session=rust-r2b-owner") ?? false;
  if (url.pathname === "/api/v1/term/stream" && req.method === "GET") {
    if (!authed) { res.writeHead(401, { "Content-Type": "application/json" }); res.end("{}"); return; }
    const id = url.searchParams.get("id") ?? "t1";
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(`event: data\ndata: ${b64("rust-sse ready\n")}\n\n`);
    termStreams.set(id, res);
    req.on("close", () => termStreams.delete(id));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (url.pathname === "/api/auth/me") res.end(JSON.stringify(authed ? ownerSession : signedOut));
  else if (url.pathname === "/api/auth/login" && req.method === "POST") {
    const body = await readBody(req);
    if (body.password === "rust-pass") { res.setHeader("Set-Cookie", "session=rust-r2b-owner; Path=/; HttpOnly; SameSite=Strict"); res.end(JSON.stringify({ success: true })); }
    else { res.statusCode = 401; res.end(JSON.stringify({ error: "bad_password" })); }
  } else if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    res.setHeader("Set-Cookie", ["session=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict", "mso_aux=; Max-Age=0; Path=/"]);
    res.end(JSON.stringify({ success: true }));
  } else if (url.pathname === "/api/auth/devices" && req.method === "GET") { res.statusCode = authed ? 200 : 403; res.end(JSON.stringify(authed ? devices : {})); }
  else if (url.pathname === "/api/auth/devices" && req.method === "POST") {
    const body = await readBody(req);
    if (authed && body.action === "approve") { delete devices.pending[body.deviceId]; devices.approved[body.deviceId] = { label: body.label || "Approved", approvedAt: Date.now(), role: body.role || "viewer" }; }
    res.statusCode = authed ? 200 : 403; res.end(JSON.stringify(authed ? { ok: true, ...devices } : {}));
  } else if (url.pathname === "/api/v1/sys/stats") { res.statusCode = authed ? 200 : 401; res.end(JSON.stringify(authed ? stats : {})); }
  else if (url.pathname === "/api/v1/sys/processes") { res.statusCode = authed ? 200 : 401; res.end(JSON.stringify(authed ? procs : {})); }
  else if (url.pathname === "/api/v1/sys/services" && req.method === "GET") { res.statusCode = authed ? 200 : 401; res.end(JSON.stringify(authed ? services : {})); }
  else if (url.pathname === "/api/v1/sys/services" && req.method === "POST") { res.statusCode = authed ? 200 : 403; res.end(JSON.stringify(services.services[0])); }
  else if (url.pathname === "/api/v1/fs/list") { res.statusCode = authed ? 200 : 401; res.end(JSON.stringify(authed ? fsHome : {})); }
  else if (url.pathname === "/api/v1/fs/read") { res.statusCode = authed ? 200 : 401; res.end(JSON.stringify(authed ? helloContent : {})); }
  else if (url.pathname === "/api/v1/fs/write" && req.method === "POST") { helloContent = (await readBody(req)).content; res.end(JSON.stringify({ ok: true })); }
  else if (url.pathname === "/api/v1/term/open" && req.method === "POST") { res.end(JSON.stringify({ id: "t1" })); }
  else if (url.pathname === "/api/v1/term/input" && req.method === "POST") {
    const body = await readBody(req); termStreams.get(body.id)?.write(`event: data\ndata: ${b64(`echo:${body.data}`)}\n\n`);
    res.end(JSON.stringify({ ok: true }));
  } else if (url.pathname === "/api/v1/term/close" && req.method === "POST") {
    const body = await readBody(req); termStreams.get(body.id)?.end(); termStreams.delete(body.id);
    res.end(JSON.stringify({ ok: true }));
  } else if (url.pathname === "/mcp" && req.method === "POST") { res.end(JSON.stringify({ ok: true, auth: req.headers.authorization ?? null })); }
  else if (url.pathname === "/api/v1/managed-apps/hermes/proxy/chat") { res.end(JSON.stringify({ app: req.headers["x-os-managed-app-host"] ?? null })); }
  else { res.statusCode = 404; res.end("{}"); }
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

  const htmlRes = await fetch(`${ready}/`);
  const nonce = htmlRes.headers.get("x-nonce");
  assert.ok(nonce && nonce.length === 32);
  assert.ok((htmlRes.headers.get("content-security-policy") ?? "").includes(`script-src 'self' 'nonce-${nonce}'`));
  assert.ok((await htmlRes.text()).includes(`<script nonce="${nonce}">`));

  const beforeSec = calls.length;
  assert.equal((await rawHttp(hostPort, `POST /api/auth/login HTTP/1.1\r\nHost: ${expectedHost}\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`)).status, 403);
  assert.equal((await rawHttp(hostPort, `POST /api/auth/login HTTP/1.1\r\nHost: ${expectedHost}\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 999999\r\nConnection: close\r\n\r\n`)).status, 413);
  assert.equal((await rawHttp(hostPort, `DELETE /api/auth/devices HTTP/1.1\r\nHost: ${expectedHost}\r\nSec-Fetch-Site: same-origin\r\nConnection: close\r\n\r\n`)).status, 405);
  assert.equal((await fetch(`${ready}/api/config`)).status, 404);
  assert.equal((await rawHttp(hostPort, `POST /api/v1/exec/run HTTP/1.1\r\nHost: ${expectedHost}\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`)).status, 404);
  assert.equal((await rawHttp(hostPort, `GET /../etc/passwd HTTP/1.1\r\nHost: ${expectedHost}\r\nConnection: close\r\n\r\n`)).status, 400);
  assert.equal((await rawHttp(hostPort, `GET / HTTP/1.1\r\nHost: staging.mso.example.com\r\nConnection: close\r\n\r\n`)).status, 404);
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
  await page.getByRole("button", { name: "Open Files" }).click();
  await page.locator("button[data-entry-open='hello.txt']").click();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.locator("textarea").fill("saved via rust");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByText("File saved.").waitFor();
  assert.equal(helloContent, "saved via rust");
  await page.getByRole("button", { name: "Open Services" }).click();
  await page.getByText("mso.service").waitFor();
  await page.getByRole("button", { name: "Open Terminal" }).click();
  await page.getByText("rust-sse ready").waitFor();
  await page.getByLabel("Terminal command").fill("uname");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText("echo:uname").waitFor();
  await page.getByRole("button", { name: "Close Terminal" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Sign in to the existing cockpit" }).waitFor();
  assert.deepEqual(errors, [], `unexpected browser/CSP errors: ${errors.join("; ")}`);
  await context.close();

  const activeRssKiB = readVmRssKiB(hostProc.pid);
  console.log(JSON.stringify({
    pass: true, stage: "R2B+SSE", origin: ready, idleRssKiB, activeRssKiB, apiCalls: calls.length,
    liveSseTerminalVerified: true, filesMutationVerified: true, servicesCenterVerified: true,
  }, null, 2));
} finally {
  for (const s of termStreams.values()) s.end();
  await browser?.close();
  if (hostProc && hostProc.exitCode === null) { hostProc.kill("SIGTERM"); await once(hostProc, "exit"); }
  backend.closeAllConnections();
  await new Promise((resolve) => backend.close(resolve));
}
