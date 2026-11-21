import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";

// Synthetic backend only: verifies Increments 1..4B (lazy slices, Editor, Docs, Workflows, Integrations, Channels, Palette, Chrome).
const viewerSession = { authenticated: true, deviceId: "fixture-viewer-0001", deviceLabel: "Browser fixture", role: "viewer" };
const ownerSession = { authenticated: true, deviceId: "fixture-owner-0001", deviceLabel: "Owner fixture", role: "owner" };
const signedOut = { authenticated: false, deviceId: null, deviceLabel: null, role: null };
const stats = { cpu: { pct: 12, cores: 4 }, mem: { used: 1024 ** 3, total: 4 * 1024 ** 3 }, disk: { used: 2 * 1024 ** 3, total: 8 * 1024 ** 3 }, uptime: 3_660_000 };
const processes = [{ pid: 101, name: "mso-shell-host", status: "S", cpu: 0.4, mem: 3 }];
const services = { services: [{ unit: "mso.service", scope: "user", load: "loaded", active: "active", sub: "running", description: "MSO host", controllable: true }], diagnostics: [], truncated: false, controlAllowlistConfigured: true, generatedAt: "2026-11-22T00:00:00.000Z" };
const models = { models: [{ id: "demo-1", ref: "openai/demo-1", provider: "openai", name: "Demo Model" }] };
const managedApps = { apps: [{ id: "hermes", name: "Hermes Agent", description: "Managed runtime", installed: true, installationType: "systemd", state: "running", healthy: true, version: "1.2.0", dashboardAvailable: true, publicDashboardUrl: "https://hermes.mso.example.com", supportedActions: ["restart"], diagnostic: null }] };
const packages = { manager: "apt", available: true, truncated: false, checkedAt: "2026-11-22T00:00:00.000Z", source: "local-cache", updates: [{ name: "openssl", current: "3.0.1", candidate: "3.0.2", architecture: "amd64" }] };
const changelog = { markdown: "## 2026-11-22\n- Landed Svelte lazy window loader\n", generated: true };
const workflows = { graphs: [{ id: "wf-1", name: "Nightly Backup", description: "Sync host state", status: "active", nodes: [{ id: "n1" }], edges: [], metadata: { tags: ["ops"] }, createdAt: "2026-11-22T00:00:00.000Z", updatedAt: "2026-11-22T01:00:00.000Z", revision: "r1" }] };
const integrations = { version: 2, user: "owner", resolution: "default", users: [{ id: "owner", label: "Owner", isDefault: true, connectionCount: 1 }], connections: [{ user: "owner", id: "c1", label: "Primary Convex", provider: "convex-cloud", source: "direct", authMethod: "token", scope: "global", isDefault: true, missing: [], state: "ready", verifiedAt: 1_700_000_000_000 }] };
const channels = { version: 1, revision: 1, providers: [{ id: "telegram", title: "Telegram", inbound: "webhook", sendText: true, inboundEvents: true }], channels: [{ id: "ch-1", name: "Ops Bot", provider: "telegram", credential: { user: "owner", connection: "tg-main" }, enabled: true, createdAt: "2026-11-22T00:00:00.000Z", updatedAt: "2026-11-22T00:00:00.000Z", connection: { state: "connected" } }] };
let prefs = { tweaks: { theme: "system", reducedMotion: false }, quicklinks: [], updates: { auto: true, channel: "stable" } };
let fsEntries = [{ name: "notes.txt", kind: "file", size: 14, mtime: 1_700_000_001_000 }];
let notesContent = "hello from mso";
const termStreams = new Map();
let mode = "ready", calls = [], cookieSeen = false;
const devices = { approved: { "fixture-owner-0001": { label: "Owner fixture", approvedAt: 1_700_000_000_000, role: "owner" } }, pending: {} };
const hosts = new Set();
const readBody = (req) => new Promise((r) => { let s = ""; req.on("data", (c) => { s += c; }); req.on("end", () => { try { r(s ? JSON.parse(s) : {}); } catch { r({}); } }); });
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

const backend = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  calls.push(`${req.method} ${url.pathname}`);
  hosts.add(req.headers.host);
  cookieSeen ||= req.headers.cookie?.includes("mso_fixture=synthetic") ?? false;
  if (url.pathname === "/api/v1/term/stream" && req.method === "GET") {
    const id = url.searchParams.get("id") ?? "t1";
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(`event: data\ndata: ${b64("mso-shell ready\n")}\n\n`);
    termStreams.set(id, res); req.on("close", () => termStreams.delete(id)); return;
  }
  if (url.pathname === "/api/assistant" && req.method === "POST") {
    const body = await readBody(req);
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    res.write(`event: delta\ndata: ${JSON.stringify({ text: `Alfa reply: ${body.messages?.[0]?.text ?? ""}` })}\n\n`);
    res.end(`event: done\ndata: ${JSON.stringify({ stopReason: "stop" })}\n\n`); return;
  }
  res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
  if (url.pathname === "/api/auth/me") res.end(JSON.stringify(mode === "signed-out" ? signedOut : mode === "owner" ? ownerSession : viewerSession));
  else if (url.pathname === "/api/auth/login" && req.method === "POST") {
    const body = await readBody(req);
    if (body.password === "owner-pass") { mode = "owner"; res.setHeader("Set-Cookie", "session=synthetic-owner; Path=/; HttpOnly; SameSite=Strict"); res.end(JSON.stringify({ success: true })); }
    else { res.statusCode = 401; res.end(JSON.stringify({ error: "bad_password" })); }
  } else if (url.pathname === "/api/auth/logout" && req.method === "POST") { mode = "signed-out"; res.setHeader("Set-Cookie", "session=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict"); res.end(JSON.stringify({ success: true })); }
  else if (url.pathname === "/api/auth/devices") res.end(JSON.stringify(devices));
  else if (url.pathname === "/api/v1/sys/stats") res.end(JSON.stringify(stats));
  else if (url.pathname === "/api/v1/sys/processes") res.end(JSON.stringify(processes));
  else if (url.pathname === "/api/v1/sys/services") res.end(JSON.stringify(req.method === "POST" ? services.services[0] : services));
  else if (url.pathname === "/api/v1/sys/packages") res.end(JSON.stringify(packages));
  else if (url.pathname === "/api/v1/managed-apps") res.end(JSON.stringify(managedApps));
  else if (url.pathname === "/api/changelog") res.end(JSON.stringify(changelog));
  else if (url.pathname === "/api/v1/workflows") res.end(JSON.stringify(url.searchParams.get("runs") === "1" ? { runs: [], total: 0 } : workflows));
  else if (url.pathname === "/api/v1/integrations") res.end(JSON.stringify(integrations));
  else if (url.pathname === "/api/v1/channels" && req.method === "GET") res.end(JSON.stringify(channels));
  else if (url.pathname === "/api/v1/channels" && req.method === "POST") res.end(JSON.stringify({ ok: true, detail: "Channel reachable", channel: { lastCheck: { at: "2026-11-22T02:00:00.000Z", ok: true, detail: "Channel reachable" } } }));
  else if (url.pathname === "/api/models") res.end(JSON.stringify(models));
  else if (url.pathname === "/api/prefs" && req.method === "GET") res.end(JSON.stringify(prefs));
  else if (url.pathname === "/api/prefs" && req.method === "POST") { const p = await readBody(req); prefs = { ...prefs, ...(p.tweaks ? { tweaks: { ...prefs.tweaks, ...p.tweaks } } : {}), ...(p.quicklinks ? { quicklinks: p.quicklinks } : {}) }; res.end(JSON.stringify({ ok: true })); }
  else if (url.pathname === "/api/v1/fs/list") res.end(JSON.stringify({ path: "/home/demo", parent: "/home", entries: fsEntries }));
  else if (url.pathname === "/api/v1/fs/read") res.end(JSON.stringify(notesContent));
  else if (url.pathname === "/api/v1/fs/write" && req.method === "POST") { notesContent = (await readBody(req)).content; res.end(JSON.stringify({ ok: true })); }
  else if (url.pathname === "/api/v1/term/open" && req.method === "POST") res.end(JSON.stringify({ id: "t1" }));
  else if (url.pathname === "/api/v1/term/close" && req.method === "POST") { const b = await readBody(req); termStreams.get(b.id)?.end(); termStreams.delete(b.id); res.end(JSON.stringify({ ok: true })); }
  else { res.statusCode = 404; res.end("{}"); }
});

let browser, preview, output = "";
try {
  backend.listen(0, "127.0.0.1"); await once(backend, "listening");
  preview = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview"], {
    cwd: process.cwd(), env: { ...process.env, MSO_SVELTE_API_ORIGIN: `http://127.0.0.1:${backend.address().port}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  preview.stdout.on("data", (c) => { output += c; }); preview.stderr.on("data", (c) => { output += c; });
  const base = "http://127.0.0.1:4173";
  let listening = false;
  for (const deadline = Date.now() + 30_000; Date.now() < deadline;) {
    if (preview.exitCode !== null) throw new Error(`preview exited: ${output}`);
    try { listening = (await fetch(base)).ok; } catch { /* startup */ }
    if (listening) break;
    await delay(100);
  }
  assert.ok(listening, output);
  browser = await chromium.launch({ headless: true });

  for (const colorScheme of ["light", "dark"]) {
    for (const width of [320, 390, 1440]) {
      mode = "ready";
      const context = await browser.newContext({ viewport: { width, height: 844 }, colorScheme, reducedMotion: "reduce" });
      await context.addCookies([{ name: "mso_fixture", value: "synthetic", url: base }]);
      const page = await context.newPage(), errors = [], scripts = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("response", (r) => { if (r.request().resourceType() === "script") scripts.push(r.url()); });
      await page.goto(base);
      await page.getByText("1.0 GiB / 4.0 GiB", { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      assert.ok(scripts.length > 0 && scripts.every((u) => !u.includes("/_next/")));
      if (width === 320) {
        await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      }
      await context.close();
      console.log(`PASS monitor ready, no overflow: ${width}px ${colorScheme}`);
    }
  }

  const page = await browser.newPage();
  mode = "signed-out"; calls = [];
  await page.goto(base);
  await page.getByLabel("Cockpit password").fill("owner-pass");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Devices & Approvals" }).waitFor();

  // Shell features: Chrome profile, Shortcut Help, Command Palette -> Docs
  await page.getByLabel("Shell chrome").selectOption("windows");
  await page.waitForFunction(() => document.querySelector(".workspace")?.getAttribute("data-chrome") === "windows");
  await page.getByRole("button", { name: "Shortcuts" }).click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Commands" }).click();
  await page.getByRole("combobox", { name: "Search commands" }).fill("Docs");
  await page.keyboard.press("Enter");
  await page.getByText("Landed Svelte lazy window loader").waitFor();
  await page.getByRole("button", { name: "Close Docs & Changelog" }).click();

  // Code Editor (open + edit + save)
  await page.getByRole("button", { name: "Open Editor" }).click();
  await page.getByLabel("File path").fill("/home/demo/notes.txt");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.locator("#editor-textarea").fill("edited in code editor");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("[data-editor-dirty='false']") !== null);
  assert.equal(notesContent, "edited in code editor");
  await page.getByRole("button", { name: "Close Code Editor" }).click();

  // Workflows, Integrations (single convex), Channels (+ Test), Alfa SSE
  await page.getByRole("button", { name: "Workflows" }).click();
  await page.getByText("Nightly Backup").waitFor();
  await page.getByRole("button", { name: "Close Workflows" }).click();

  await page.getByRole("button", { name: "Integrations" }).click();
  await page.getByText("Primary Convex").waitFor();
  await page.getByRole("button", { name: "Close Integrations" }).click();

  await page.getByRole("button", { name: "Channels" }).click();
  await page.getByText("Ops Bot").waitFor();
  await page.getByRole("button", { name: "Test" }).click();
  await page.getByText("Channel reachable").waitFor();
  await page.getByRole("button", { name: "Close Channels" }).click();

  await page.getByRole("button", { name: "Open Alfa" }).click();
  await page.getByLabel("Message Alfa Assistant").fill("ping");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText("Alfa reply: ping").waitFor();
  await page.getByRole("button", { name: "Close Alfa Assistant" }).click();

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Sign in to the existing cockpit" }).waitFor();
  assert.deepEqual([...hosts], ["127.0.0.1:4173"]);
  assert.ok(cookieSeen);
  console.log("PASS Increments 1..4B: lazy slices, Editor, Docs, Workflows, Integrations, Channels, Palette, Chrome");
} finally {
  for (const s of termStreams.values()) s.end();
  await browser?.close();
  if (preview && preview.exitCode === null) { preview.kill("SIGTERM"); await once(preview, "exit"); }
  backend.closeAllConnections();
  await new Promise((resolve) => backend.close(resolve));
}
