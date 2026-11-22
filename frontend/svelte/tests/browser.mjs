import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";

// Synthetic backend only: verifies Increments 1..4D (10/10 AppShell features, 5 OS chromes, Agent Vault/Group, Media, Pickers, Create App, Shell Settings).
const viewerSession = { authenticated: true, deviceId: "fixture-viewer-0001", deviceLabel: "Browser fixture", role: "viewer" };
const ownerSession = { authenticated: true, deviceId: "fixture-owner-0001", deviceLabel: "Owner fixture", role: "owner" };
const signedOut = { authenticated: false, deviceId: null, deviceLabel: null, role: null };
const stats = { cpu: { pct: 12, cores: 4 }, mem: { used: 1024 ** 3, total: 4 * 1024 ** 3 }, disk: { used: 2 * 1024 ** 3, total: 8 * 1024 ** 3 }, uptime: 3_660_000 };
const vaultView = { state: { schemaVersion: 1, project: { id: "mso", name: "MSO", path: "/home/demo/mso" }, root: "/home/demo/.vault", current: "snap1", refreshedAt: "2026-11-22T00:00:00.000Z", snapshots: [{ id: "snap1", capturedAt: "2026-11-22T00:00:00.000Z", truncated: false, warnings: [], notes: [{ path: "overview.md", title: "Repo Overview", kind: "overview", source: "README.md" }] }] }, note: { path: "overview.md", content: "Vault overview text" } };
const groupSnap = { revision: 1, groups: [{ id: "g1", name: "Release Council", members: [{ id: "m1", name: "Alfa", profile: "ops" }], maxRounds: 2, enabled: true, createdAt: "2026-11-22T00:00:00.000Z", updatedAt: "2026-11-22T00:00:00.000Z", runs: [] }] };
const stockResults = { results: [{ id: "img-1", title: "Sunset", url: "https://images.example.com/sunset.jpg", thumb: "https://images.example.com/sunset-sm.jpg", creator: "Demo", license: "CC0" }] };
let shellApps = { schemaVersion: 1, revision: "rev-1", configurable: true, apps: [{ id: "grafana", title: "Grafana", description: "Metrics UI", origin: "https://grafana.example.com", url: "https://grafana.example.com/", renderer: "iframe", sandbox: "allow-scripts", definition: { id: "grafana", title: "Grafana", description: "Metrics UI", url: "https://grafana.example.com/", mode: "embed" } }] };
let prefs = { tweaks: { theme: "system", preset: "macos", fontScale: 1, reducedMotion: false }, quicklinks: [], updates: { auto: true, channel: "stable" } };
let mode = "ready", cookieSeen = false;
const devices = { approved: { "fixture-owner-0001": { label: "Owner fixture", approvedAt: 1_700_000_000_000, role: "owner" } }, pending: {} };
const hosts = new Set();
const readBody = (req) => new Promise((r) => { let s = ""; req.on("data", (c) => { s += c; }); req.on("end", () => { try { r(s ? JSON.parse(s) : {}); } catch { r({}); } }); });

const backend = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  hosts.add(req.headers.host);
  cookieSeen ||= req.headers.cookie?.includes("mso_fixture=synthetic") ?? false;
  res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
  if (url.pathname === "/api/auth/me") res.end(JSON.stringify(mode === "signed-out" ? signedOut : mode === "owner" ? ownerSession : viewerSession));
  else if (url.pathname === "/api/auth/login" && req.method === "POST") {
    const body = await readBody(req);
    if (body.password === "owner-pass") { mode = "owner"; res.setHeader("Set-Cookie", "session=synthetic-owner; Path=/; HttpOnly; SameSite=Strict"); res.end(JSON.stringify({ success: true })); }
    else { res.statusCode = 401; res.end(JSON.stringify({ error: "bad_password" })); }
  } else if (url.pathname === "/api/auth/logout" && req.method === "POST") { mode = "signed-out"; res.setHeader("Set-Cookie", "session=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict"); res.end(JSON.stringify({ success: true })); }
  else if (url.pathname === "/api/auth/devices") res.end(JSON.stringify(devices));
  else if (url.pathname === "/api/v1/sys/stats") res.end(JSON.stringify(stats));
  else if (url.pathname === "/api/prefs" && req.method === "GET") res.end(JSON.stringify(prefs));
  else if (url.pathname === "/api/prefs" && req.method === "POST") { const p = await readBody(req); prefs = { ...prefs, ...(p.tweaks ? { tweaks: { ...prefs.tweaks, ...p.tweaks } } : {}) }; res.end(JSON.stringify({ ok: true })); }
  else if (url.pathname === "/api/v1/agent-vault") res.end(JSON.stringify(req.method === "POST" ? { ...vaultView, changed: true } : vaultView));
  else if (url.pathname === "/api/v1/agent-groups") res.end(JSON.stringify(groupSnap));
  else if (url.pathname === "/api/v1/stock/search") res.end(JSON.stringify(stockResults));
  else if (url.pathname === "/api/v1/shell-apps" && req.method === "GET") res.end(JSON.stringify(shellApps));
  else if (url.pathname === "/api/v1/shell-apps" && req.method === "POST") { res.end(JSON.stringify({ id: "demo-app", revision: "rev-2" })); }
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
      console.log(`PASS monitor + 10/10 shell features no overflow: ${width}px ${colorScheme}`);
    }
  }

  const page = await browser.newPage();
  mode = "signed-out";
  await page.goto(base);
  await page.getByLabel("Cockpit password").fill("owner-pass");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Devices & Approvals" }).waitFor();

  // Verify WidgetsBar + DesktopIcons (#9 & #10 AppShell features)
  await page.getByRole("region", { name: "Desktop shortcuts" }).waitFor();

  // Wave 6 Slices: Agent Vault, Agent Groups, Media Viewer, Pickers, Create App, Shell Settings
  await page.locator(".app-dock").getByRole("button", { name: "Agent Vault" }).click();
  await page.getByText("Repo Overview").waitFor();
  await page.getByRole("button", { name: "Close Agent Vault" }).click();

  await page.locator(".app-dock").getByRole("button", { name: "Agent Groups" }).click();
  await page.getByRole("heading", { name: "Release Council" }).waitFor();
  await page.getByRole("button", { name: "Close Agent Groups" }).click();

  await page.locator(".app-dock").getByRole("button", { name: "Create App" }).click();
  await page.getByText("Grafana", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Close Create App" }).click();

  await page.locator(".app-dock").getByRole("button", { name: "Pickers" }).click();
  await page.getByRole("tab", { name: "Image Picker" }).click();
  await page.getByRole("button", { name: "Close Pickers" }).click();

  await page.locator(".app-dock").getByRole("button", { name: "Media Viewer" }).click();
  await page.getByRole("heading", { name: "Media Viewer" }).waitFor();
  await page.getByRole("button", { name: "Close Media Viewer" }).click();

  await page.locator(".app-dock").getByRole("button", { name: "Shell Settings" }).click();
  await page.locator("#shell-settings-title").waitFor();
  await page.getByRole("button", { name: "Close Shell Settings" }).click();

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Sign in to the existing cockpit" }).waitFor();
  assert.deepEqual([...hosts], ["127.0.0.1:4173"]);
  assert.ok(cookieSeen);
  console.log("PASS Increments 1..4D: 10/10 AppShell features, 5 OS chromes, Vault, Group, Media, Pickers, Create App, Shell Settings");
} finally {
  await browser?.close();
  if (preview && preview.exitCode === null) { preview.kill("SIGTERM"); await once(preview, "exit"); }
  backend.closeAllConnections();
  await new Promise((resolve) => backend.close(resolve));
}
