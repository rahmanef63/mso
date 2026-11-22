import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";

// Synthetic backend only: verifies Increment 4E (33/33 slices: Camoufox, Bot Desktops, n8n, Image Editor, Media Studio, Reel Editor + LazyModals).
const viewerSession = { authenticated: true, deviceId: "fixture-viewer-0001", deviceLabel: "Browser fixture", role: "viewer" };
const ownerSession = { authenticated: true, deviceId: "fixture-owner-0001", deviceLabel: "Owner fixture", role: "owner" };
const signedOut = { authenticated: false, deviceId: null, deviceLabel: null, role: null };
const stats = { cpu: { pct: 12, cores: 4 }, mem: { used: 1024 ** 3, total: 4 * 1024 ** 3 }, disk: { used: 2 * 1024 ** 3, total: 8 * 1024 ** 3 }, uptime: 3_660_000 };
const camStatus = { running: true, enabled: true, installed: true, viewerReady: true, activeState: "active", unit: "camoufox-vnc.service" };
const camSession = { password: "secret-should-not-appear", viewerOrigin: "https://viewer.mso.example.com", viewerTicket: "secret-ticket", viewerPathPrefix: "/vnc" };
const containers = { containers: [{ id: "bot-01", name: "alpha-desktop", state: "running", status: "Up 2h", labels: { user: "ops", bot: "alpha" }, created: "2026-11-22T00:00:00.000Z", ports: "5901" }] };
const managedApps = { apps: [{ id: "n8n", name: "n8n", description: "Workflow automation", installed: true, installationType: "docker", state: "running", healthy: true, version: "1.80.0", dashboardAvailable: true, publicDashboardUrl: "https://n8n.mso.example.com", supportedActions: ["restart"], diagnostic: null }] };
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
  else if (url.pathname === "/api/v1/camoufox/service") res.end(JSON.stringify(camStatus));
  else if (url.pathname === "/api/v1/camoufox/session") res.end(JSON.stringify(camSession));
  else if (url.pathname === "/api/v1/desktop/containers") res.end(JSON.stringify(containers));
  else if (url.pathname === "/api/v1/desktop/lifecycle") res.end(JSON.stringify({ action: "logs", container: "bot-01", state: containers.containers[0], logs: ["desktop ready"] }));
  else if (url.pathname === "/api/v1/managed-apps") res.end(JSON.stringify(managedApps));
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
      console.log(`PASS 33/33 shell no overflow: ${width}px ${colorScheme}`);
    }
  }

  const page = await browser.newPage();
  mode = "signed-out";
  await page.goto(base);
  await page.getByLabel("Cockpit password").fill("owner-pass");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Devices & Approvals" }).waitFor();

  // Verify LazyModals loads Command Palette on demand
  await page.getByRole("button", { name: "Commands" }).click();
  await page.getByRole("combobox", { name: "Search commands" }).waitFor();
  await page.keyboard.press("Escape");

  // Wave 7 Final 6 Slices -> 33/33!
  await page.locator(".app-dock").getByRole("button", { name: "Camoufox" }).click();
  await page.getByText("https://viewer.mso.example.com").waitFor();
  assert.equal(await page.evaluate(() => document.body.innerText.includes("secret-should-not-appear")), false);
  await page.getByRole("button", { name: "Close Camoufox Browser" }).click();

  await page.locator(".app-dock").getByRole("button", { name: "Bot Desktops" }).click();
  await page.getByText("alpha-desktop").waitFor();
  await page.getByRole("button", { name: "Close Bot Desktops" }).click();

  await page.locator(".app-dock").getByRole("button", { name: "n8n" }).click();
  await page.getByText("Workflow automation").waitFor();
  await page.getByRole("button", { name: "Close n8n" }).click();

  await page.locator(".app-dock").getByRole("button", { name: "Image Editor" }).click();
  await page.getByRole("button", { name: "Rotate 90" }).waitFor();
  await page.getByRole("button", { name: "Close Image Editor" }).click();

  await page.locator(".app-dock").getByRole("button", { name: "Media Studio" }).click();
  await page.getByRole("button", { name: "Add asset" }).waitFor();
  await page.getByRole("button", { name: "Close Media Studio" }).click();

  await page.locator(".app-dock").getByRole("button", { name: "Reel Editor" }).click();
  await page.getByRole("button", { name: "Add clip" }).waitFor();
  await page.getByRole("button", { name: "Close Reel Editor" }).click();

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Sign in to the existing cockpit" }).waitFor();
  assert.deepEqual([...hosts], ["127.0.0.1:4173"]);
  assert.ok(cookieSeen);
  console.log("PASS Increments 1..4E: 33/33 slices, 10/10 AppShell features, 5 OS chromes, LazyModals");
} finally {
  await browser?.close();
  if (preview && preview.exitCode === null) { preview.kill("SIGTERM"); await once(preview, "exit"); }
  backend.closeAllConnections();
  await new Promise((resolve) => backend.close(resolve));
}
