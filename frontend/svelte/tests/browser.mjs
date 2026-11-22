import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";

// Synthetic backend only: verifies Increments 1..4C (Organization, Memory Graph, App Store, Extensions, Infra, Control Center, Lock, Force Quit, Clipboard, Inspector).
const viewerSession = { authenticated: true, deviceId: "fixture-viewer-0001", deviceLabel: "Browser fixture", role: "viewer" };
const ownerSession = { authenticated: true, deviceId: "fixture-owner-0001", deviceLabel: "Owner fixture", role: "owner" };
const signedOut = { authenticated: false, deviceId: null, deviceLabel: null, role: null };
const stats = { cpu: { pct: 12, cores: 4 }, mem: { used: 1024 ** 3, total: 4 * 1024 ** 3 }, disk: { used: 2 * 1024 ** 3, total: 8 * 1024 ** 3 }, uptime: 3_660_000 };
const changelog = { markdown: "## 2026-11-22\n- Wave 5 slices live\n", generated: true };
const org = { chart: { version: 1, name: "MSO Org", revision: "rev1", updatedAt: "2026-11-22T00:00:00.000Z", units: [{ id: "u1", key: "core", name: "Core Platform", kind: "team", status: "active", sortOrder: 1, createdAt: "2026-11-22T00:00:00.000Z", updatedAt: "2026-11-22T00:00:00.000Z" }], seats: [{ id: "s1", unitId: "u1", name: "Alfa", title: "Lead Agent", role: "ops", state: "active", seatMode: "permanent", responsibilities: ["health"], target: { kind: "local-agent", ref: "alfa" }, sortOrder: 1, createdAt: "2026-11-22T00:00:00.000Z", updatedAt: "2026-11-22T00:00:00.000Z" }] }, runtime: [{ seatId: "s1", targetKind: "local-agent", status: "ready" }] };
const memGraph = { nodes: [{ id: "n1", title: "Runbook Note", kind: "note", group: "ops", degree: 1, path: "/home/demo/notes.txt", excerpt: "Check host" }], edges: [], truncated: false, warnings: [], root: "/home/demo", counts: { notes: 1, memories: 0, ghosts: 0 } };
const appCatalog = { status: "remote", entries: [{ kind: "managed", id: "hermes" }, { kind: "connected", manifest: { id: "docs-app", name: "Docs Portal", description: "Internal wiki" } }] };
const features = { schemaVersion: 1, features: [{ id: "mod-metrics", title: "Metrics Pack", version: "1.0.0", description: "Modular widget" }] };
const skills = { skills: [{ id: "vps-alfa", name: "vps-alfa", description: "Patrol VPS", source: "mso", trust: "official" }], recipes: [] };
const infra = { providers: [{ id: "convex-cloud", label: "Convex Cloud", configured: true, fields: ["url"] }, { id: "cloudflare", label: "Cloudflare", configured: false, missing: ["token"] }] };
let notesContent = "hello from mso";
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
  else if (url.pathname === "/api/changelog") res.end(JSON.stringify(changelog));
  else if (url.pathname === "/api/v1/organization") res.end(JSON.stringify(org));
  else if (url.pathname === "/api/v1/memory-graph") res.end(JSON.stringify(memGraph));
  else if (url.pathname === "/api/v1/app-catalog") res.end(JSON.stringify(appCatalog));
  else if (url.pathname === "/api/v1/features") res.end(JSON.stringify(features));
  else if (url.pathname === "/api/skills") res.end(JSON.stringify(skills));
  else if (url.pathname === "/api/v1/infra/providers") res.end(JSON.stringify(infra));
  else if (url.pathname === "/api/v1/fs/read") res.end(JSON.stringify(notesContent));
  else if (url.pathname === "/api/v1/fs/write" && req.method === "POST") { notesContent = (await readBody(req)).content; res.end(JSON.stringify({ ok: true })); }
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
  mode = "signed-out";
  await page.goto(base);
  await page.getByLabel("Cockpit password").fill("owner-pass");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Devices & Approvals" }).waitFor();

  // Wave 5 Slices: Organization, Memory Graph -> Open in Editor, App Store, Extensions, Infrastructure
  await page.getByRole("button", { name: "Organization" }).click();
  await page.getByText("Core Platform").waitFor();
  await page.getByRole("button", { name: "Close Organization" }).click();

  await page.getByRole("button", { name: "Memory Graph" }).click();
  await page.getByRole("heading", { name: "Runbook Note" }).waitFor();
  await page.getByRole("button", { name: "Close Memory Graph" }).click();

  await page.getByRole("button", { name: "App Store" }).click();
  await page.getByText("Docs Portal").waitFor();
  await page.getByRole("button", { name: "Close App Store" }).click();

  await page.getByRole("button", { name: "Extensions" }).click();
  await page.getByText("Metrics Pack").waitFor();
  await page.getByRole("button", { name: "Close Extensions" }).click();

  await page.getByRole("button", { name: "Infrastructure" }).click();
  await page.getByText("Cloudflare", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Close Infrastructure" }).click();

  // Wave 5 AppShell features: Clipboard, Inspector, Control Center -> Lock -> Unlock -> Force Quit
  await page.getByRole("button", { name: "Clipboard" }).click();
  await page.getByRole("button", { name: "Inspector" }).click();
  await page.getByRole("button", { name: "Controls" }).click();
  await page.getByRole("button", { name: "Lock screen" }).click();
  await page.getByRole("heading", { name: "Workspace locked" }).waitFor();
  await page.getByRole("button", { name: "Unlock workspace" }).click();
  await page.getByRole("button", { name: "Controls" }).click();
  await page.getByRole("button", { name: "Force quit windows..." }).click();
  await page.getByRole("button", { name: "Close all" }).click();

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Sign in to the existing cockpit" }).waitFor();
  assert.deepEqual([...hosts], ["127.0.0.1:4173"]);
  assert.ok(cookieSeen);
  console.log("PASS Increments 1..4C: Org, Memory Graph, App Store, Extensions, Infra, Clipboard, Inspector, Control Center, Lock, Force Quit");
} finally {
  await browser?.close();
  if (preview && preview.exitCode === null) { preview.kill("SIGTERM"); await once(preview, "exit"); }
  backend.closeAllConnections();
  await new Promise((resolve) => backend.close(resolve));
}
