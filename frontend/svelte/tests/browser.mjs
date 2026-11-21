import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";

// Synthetic backend only: verifies Increment 1, 2A (auth/devices/CSRF), and 3A (windows, Files, Processes).
const viewerSession = { authenticated: true, deviceId: "fixture-viewer-0001", deviceLabel: "Browser fixture", role: "viewer" };
const ownerSession = { authenticated: true, deviceId: "fixture-owner-0001", deviceLabel: "Owner fixture", role: "owner" };
const signedOut = { authenticated: false, deviceId: null, deviceLabel: null, role: null };
const stats = { cpu: { pct: 12, cores: 4 }, mem: { used: 1024 ** 3, total: 4 * 1024 ** 3 }, disk: { used: 2 * 1024 ** 3, total: 8 * 1024 ** 3 }, uptime: 3_660_000 };
const processes = [
  { pid: 101, name: "mso-shell-host", status: "S", cpu: 0.4, mem: 3 },
  { pid: 202, name: "node", status: "R", cpu: 14.2, mem: 128 },
];
const fsHome = {
  path: "/home/demo", parent: "/home",
  entries: [
    { name: "projects", kind: "dir", size: 0, mtime: 1_700_000_000_000 },
    { name: "notes.txt", kind: "file", size: 14, mtime: 1_700_000_001_000 },
  ],
};

let mode = "ready", calls = [], cookieSeen = false;
const devices = {
  approved: {
    "fixture-owner-0001": { label: "Owner fixture", approvedAt: 1_700_000_000_000, role: "owner" },
    "fixture-other-0002": { label: "Tablet", approvedAt: 1_700_000_001_000, role: "viewer" },
  },
  pending: { "fixture-pend-0003": { label: "New Laptop", firstSeen: 1_700_000_002_000, lastSeen: 1_700_000_003_000, ip: "127.0.0.1", attempts: 1 } },
};
const hosts = new Set();
const readBody = (req) => new Promise((r) => { let s = ""; req.on("data", (c) => { s += c; }); req.on("end", () => { try { r(s ? JSON.parse(s) : {}); } catch { r({}); } }); });

const backend = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  calls.push(`${req.method} ${url.pathname}`);
  hosts.add(req.headers.host);
  cookieSeen ||= req.headers.cookie?.includes("mso_fixture=synthetic") ?? false;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (url.pathname === "/api/auth/me" && req.method === "GET") {
    res.end(JSON.stringify(mode === "signed-out" ? signedOut : mode === "owner" ? ownerSession : viewerSession));
  } else if (url.pathname === "/api/auth/login" && req.method === "POST") {
    const body = await readBody(req);
    if (body.password === "pending-pass") { res.statusCode = 403; res.end(JSON.stringify({ error: "device_pending", deviceId: body.deviceId, label: body.deviceLabel })); }
    else if (body.password === "owner-pass") { mode = "owner"; res.setHeader("Set-Cookie", "session=synthetic-owner; Path=/; HttpOnly; SameSite=Strict"); res.end(JSON.stringify({ success: true })); }
    else { res.statusCode = 401; res.end(JSON.stringify({ error: "bad_password" })); }
  } else if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    mode = "signed-out"; res.setHeader("Set-Cookie", "session=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict"); res.end(JSON.stringify({ success: true }));
  } else if (url.pathname === "/api/auth/devices" && req.method === "GET") {
    if (mode !== "owner") { res.statusCode = 403; res.end(JSON.stringify({ error: "Owner role required" })); return; }
    res.end(JSON.stringify(devices));
  } else if (url.pathname === "/api/auth/devices" && req.method === "POST") {
    if (mode !== "owner") { res.statusCode = 403; res.end(JSON.stringify({ error: "Owner role required" })); return; }
    const body = await readBody(req);
    if (body.action === "approve") { delete devices.pending[body.deviceId]; devices.approved[body.deviceId] = { label: body.label || "Approved", approvedAt: Date.now(), role: body.role || "viewer" }; }
    else if (body.action === "set_role" && devices.approved[body.deviceId]) devices.approved[body.deviceId].role = body.role;
    else if (body.action === "revoke") delete devices.approved[body.deviceId];
    res.end(JSON.stringify({ ok: true, ...devices }));
  } else if (url.pathname === "/api/v1/sys/stats" && req.method === "GET") {
    res.statusCode = mode === "revoked" ? 401 : 200;
    res.end(JSON.stringify(mode === "malformed" ? { cpu: "bad" } : stats));
  } else if (url.pathname === "/api/v1/sys/processes" && req.method === "GET") {
    res.end(JSON.stringify(processes));
  } else if (url.pathname === "/api/v1/fs/list" && req.method === "GET") {
    res.end(JSON.stringify(fsHome));
  } else if (url.pathname === "/api/v1/fs/read" && req.method === "GET") {
    res.end(JSON.stringify("hello from mso"));
  } else { res.statusCode = 404; res.end("{}"); }
});

let browser, preview, output = "";
try {
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  preview = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview"], {
    cwd: process.cwd(), env: { ...process.env, MSO_SVELTE_API_ORIGIN: `http://127.0.0.1:${backend.address().port}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  preview.stdout.on("data", (c) => { output += c; });
  preview.stderr.on("data", (c) => { output += c; });
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
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Skip to content");
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Refresh" }).focus();
      const before = calls.length;
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => !document.querySelector("[data-monitor-state='loading']"));
      assert.equal(calls.length - before, 2);
      if (width === 320) {
        await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      }
      await context.close();
      console.log(`PASS monitor ready, keyboard, no overflow: ${width}px ${colorScheme}`);
    }
  }

  // Increment 2A auth/devices + Increment 3A windowing, Files Manager, and Process Inventory.
  const page = await browser.newPage();
  mode = "signed-out"; calls = [];
  await page.goto(base);
  await page.getByRole("heading", { name: "Sign in to the existing cockpit" }).waitFor();
  assert.deepEqual(calls, ["GET /api/auth/me"]);

  await page.getByLabel("Cockpit password").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByText("Incorrect password. Check your credentials and try again.").waitFor();
  await page.getByLabel("Cockpit password").fill("pending-pass");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByText("Device approval required").waitFor();
  await page.getByLabel("Cockpit password").fill("owner-pass");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Devices & Approvals" }).waitFor();

  await page.locator("#pending-role-fixture-pend-0003").selectOption("operator");
  await page.getByRole("button", { name: "Approve" }).click();
  await page.getByText("Device approved.").waitFor();
  await page.getByRole("button", { name: "Revoke" }).first().click();
  await page.getByRole("button", { name: "Confirm revoke" }).click();
  await page.getByText("Device revoked.").waitFor();

  // Open Files window -> preview text file -> minimize -> restore -> close.
  await page.getByRole("button", { name: "Open Files" }).click();
  await page.getByRole("button", { name: /notes\.txt/ }).waitFor();
  await page.getByRole("button", { name: /notes\.txt/ }).click();
  await page.getByText("hello from mso").waitFor();
  assert.ok(new URL(page.url()).pathname.startsWith("/files"));
  await page.getByRole("button", { name: "Minimize Files" }).click();
  await page.getByRole("button", { name: "Restore Files" }).click();
  await page.getByRole("button", { name: "Close Files" }).click();

  // Open Processes window -> filter -> close.
  await page.getByRole("button", { name: "Open Processes" }).click();
  await page.getByText("mso-shell-host").waitFor();
  await page.getByLabel("Filter processes").fill("shell");
  assert.equal(await page.getByText("mso-shell-host").count(), 1);
  assert.equal(await page.getByText("node", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Close Processes" }).click();

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Sign in to the existing cockpit" }).waitFor();

  mode = "revoked";
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.getByText("Your session is unavailable or this device no longer has access.").waitFor();
  mode = "malformed";
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.getByText("The MSO system stats response is invalid.").waitFor();
  mode = "ready";
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.getByText("1.0 GiB / 4.0 GiB", { exact: true }).waitFor();

  const beforeMutation = calls.length;
  for (const method of ["POST", "PUT", "DELETE", "HEAD"]) {
    assert.equal((await fetch(`${base}/api/v1/sys/stats`, { method })).status, 405);
    assert.equal(calls.length, beforeMutation);
  }
  assert.equal((await fetch(`${base}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" },
    body: JSON.stringify({ password: "x", deviceId: "aaaaaaaaaaaaaaaa" }),
  })).status, 403);
  for (const p of ["/api/config", "/api/auth/me/secret", "/api/v1/sys/stats-extra"]) await fetch(`${base}${p}`);
  assert.equal(calls.length, beforeMutation);
  assert.deepEqual([...hosts], ["127.0.0.1:4173"], "preview must preserve incoming Host");
  assert.ok(cookieSeen, "same-origin cookie must reach local backend");
  await page.route("**/api/auth/me", (route) => route.fulfill({ contentType: "text/html", body: "<html>fallback</html>" }));
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.getByText("MSO API is unavailable. Configure the local backend before retrying.").waitFor();
  console.log("PASS Increment 1 + 2A + 3A: auth, devices, windows, URL sync, Files, Processes, CSRF 403 and proxy guards");
} finally {
  await browser?.close();
  if (preview && preview.exitCode === null) { preview.kill("SIGTERM"); await once(preview, "exit"); }
  backend.closeAllConnections();
  await new Promise((resolve) => backend.close(resolve));
}
