import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

// Synthetic backend only: proves compiled Rust Stage R3C `mso-shell-host` serves Svelte Increment 4B
// (lazy slices, GET+POST SSE, Editor, Docs, Workflows, Integrations, Channels, split-origin, CSRF & minimal RSS).
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
const models = { models: [{ id: "demo-1", ref: "openai/demo-1", provider: "openai", name: "Demo Model" }] };
const changelog = { markdown: "## 2026-11-22\n- Rust Stage R3C verified\n", generated: true };
const workflows = { graphs: [{ id: "wf-1", name: "Host Audit", description: "Daily check", status: "active", nodes: [{ id: "n1" }], edges: [], metadata: { tags: ["ops"] }, createdAt: "2026-11-22T00:00:00.000Z", updatedAt: "2026-11-22T01:00:00.000Z", revision: "r1" }] };
const integrations = { version: 2, user: "owner", resolution: "default", users: [{ id: "owner", label: "Owner", isDefault: true, connectionCount: 1 }], connections: [{ user: "owner", id: "c1", label: "Main Convex", provider: "convex", source: "direct", authMethod: "token", scope: "global", isDefault: true, missing: [], state: "ready", verifiedAt: 1_700_000_000_000 }] };
const channels = { version: 1, revision: 1, providers: [{ id: "telegram", title: "Telegram", inbound: "webhook", sendText: true, inboundEvents: true }], channels: [{ id: "ch-1", name: "Alerts Bot", provider: "telegram", credential: { user: "owner", connection: "tg-main" }, enabled: true, createdAt: "2026-11-22T00:00:00.000Z", updatedAt: "2026-11-22T00:00:00.000Z", connection: { state: "connected" } }] };
const termStreams = new Map();
let calls = [];
const devices = { approved: { "rust-owner-0001": { label: "Rust Shell Owner", approvedAt: 1_700_000_000_000, role: "owner" } }, pending: {} };

const backend = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  calls.push(`${req.method} ${url.pathname}`);
  const authed = req.headers.cookie?.includes("session=rust-r3c-owner") ?? false;
  if (url.pathname === "/api/v1/term/stream" && req.method === "GET") {
    if (!authed) { res.writeHead(401, { "Content-Type": "application/json" }); res.end("{}"); return; }
    const id = url.searchParams.get("id") ?? "t1";
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(`event: data\ndata: ${b64("rust-sse ready\n")}\n\n`);
    termStreams.set(id, res); req.on("close", () => termStreams.delete(id)); return;
  }
  if (url.pathname === "/api/assistant" && req.method === "POST") {
    if (!authed) { res.writeHead(401, { "Content-Type": "application/json" }); res.end("{}"); return; }
    const body = await readBody(req);
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    res.write(`event: delta\ndata: ${JSON.stringify({ text: `rust-alfa:${body.messages?.[0]?.text ?? ""}` })}\n\n`);
    res.end(`event: done\ndata: ${JSON.stringify({ stopReason: "stop" })}\n\n`); return;
  }
  res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
  if (url.pathname === "/api/auth/me") res.end(JSON.stringify(authed ? ownerSession : signedOut));
  else if (url.pathname === "/api/auth/login" && req.method === "POST") {
    const body = await readBody(req);
    if (body.password === "rust-pass") { res.setHeader("Set-Cookie", "session=rust-r3c-owner; Path=/; HttpOnly; SameSite=Strict"); res.end(JSON.stringify({ success: true })); }
    else { res.statusCode = 401; res.end(JSON.stringify({ error: "bad_password" })); }
  } else if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    res.setHeader("Set-Cookie", ["session=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict"]); res.end(JSON.stringify({ success: true }));
  } else if (url.pathname === "/api/auth/devices") { res.statusCode = authed ? 200 : 403; res.end(JSON.stringify(authed ? devices : {})); }
  else if (url.pathname === "/api/v1/sys/stats") { res.statusCode = authed ? 200 : 401; res.end(JSON.stringify(authed ? stats : {})); }
  else if (url.pathname === "/api/models") { res.statusCode = authed ? 200 : 401; res.end(JSON.stringify(authed ? models : {})); }
  else if (url.pathname === "/api/changelog") { res.statusCode = authed ? 200 : 401; res.end(JSON.stringify(authed ? changelog : {})); }
  else if (url.pathname === "/api/v1/workflows") { res.statusCode = authed ? 200 : 401; res.end(JSON.stringify(authed ? workflows : {})); }
  else if (url.pathname === "/api/v1/integrations") { res.statusCode = authed ? 200 : 403; res.end(JSON.stringify(authed ? integrations : {})); }
  else if (url.pathname === "/api/v1/channels" && req.method === "GET") { res.statusCode = authed ? 200 : 403; res.end(JSON.stringify(authed ? channels : {})); }
  else if (url.pathname === "/api/v1/channels" && req.method === "POST") { res.statusCode = authed ? 200 : 403; res.end(JSON.stringify({ ok: true, detail: "Rust channel OK" })); }
  else if (url.pathname === "/api/v1/term/open" && req.method === "POST") res.end(JSON.stringify({ id: "t1" }));
  else if (url.pathname === "/api/v1/term/close" && req.method === "POST") { const b = await readBody(req); termStreams.get(b.id)?.end(); termStreams.delete(b.id); res.end(JSON.stringify({ ok: true })); }
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
  assert.equal((await rawHttp(hostPort, `POST /api/v1/workflows HTTP/1.1\r\nHost: ${expectedHost}\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`)).status, 403);
  assert.equal((await rawHttp(hostPort, `POST /api/changelog HTTP/1.1\r\nHost: ${expectedHost}\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`)).status, 405);
  assert.equal((await fetch(`${ready}/api/config`)).status, 404);
  assert.equal((await rawHttp(hostPort, `POST /api/v1/exec/run HTTP/1.1\r\nHost: ${expectedHost}\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`)).status, 404);
  assert.equal((await rawHttp(hostPort, `POST /api/v1/editor/exec HTTP/1.1\r\nHost: ${expectedHost}\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`)).status, 404);
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
  await page.getByRole("button", { name: "Docs" }).click();
  await page.getByText("Rust Stage R3C verified").waitFor();
  await page.getByRole("button", { name: "Close Docs" }).click();
  await page.getByRole("button", { name: "Workflows" }).click();
  await page.getByText("Host Audit").waitFor();
  await page.getByRole("button", { name: "Close Workflows" }).click();
  await page.getByRole("button", { name: "Integrations" }).click();
  await page.getByText("Main Convex").waitFor();
  await page.getByRole("button", { name: "Close Integrations" }).click();
  await page.getByRole("button", { name: "Channels" }).click();
  await page.getByRole("button", { name: "Test" }).click();
  await page.getByText("Rust channel OK").waitFor();
  await page.getByRole("button", { name: "Close Channels" }).click();
  await page.getByRole("button", { name: "Open Alfa" }).click();
  await page.getByLabel("Message Alfa Assistant").fill("r3c");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText("rust-alfa:r3c").waitFor();
  await page.getByRole("button", { name: "Close Alfa Assistant" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Sign in to the existing cockpit" }).waitFor();
  assert.deepEqual(errors, [], `unexpected browser/CSP errors: ${errors.join("; ")}`);
  await context.close();

  const activeRssKiB = readVmRssKiB(hostProc.pid);
  console.log(JSON.stringify({
    pass: true, stage: "R3C+Inc4B", origin: ready, idleRssKiB, activeRssKiB, apiCalls: calls.length,
    lazySlicesVerified: true, postSseAssistantVerified: true, docsVerified: true, workflowsVerified: true,
    integrationsVerified: true, channelsTestVerified: true,
  }, null, 2));
} finally {
  for (const s of termStreams.values()) s.end();
  await browser?.close();
  if (hostProc && hostProc.exitCode === null) { hostProc.kill("SIGTERM"); await once(hostProc, "exit"); }
  backend.closeAllConnections();
  await new Promise((resolve) => backend.close(resolve));
}
