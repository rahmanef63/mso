import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";

// Synthetic backend only: this test never contacts a deployment or private store.
const viewerSession = { authenticated: true, deviceId: "fixture-viewer-0001", deviceLabel: "Browser fixture", role: "viewer" };
const ownerSession = { authenticated: true, deviceId: "fixture-owner-0001", deviceLabel: "Owner fixture", role: "owner" };
const signedOut = { authenticated: false, deviceId: null, deviceLabel: null, role: null };
const stats = { cpu: { pct: 12, cores: 4 }, mem: { used: 1024 ** 3, total: 4 * 1024 ** 3 }, disk: { used: 2 * 1024 ** 3, total: 8 * 1024 ** 3 }, uptime: 3_660_000 };

let mode = "ready", calls = [], cookieSeen = false;
let devices = {
  approved: {
    "fixture-owner-0001": { label: "Owner fixture", approvedAt: 1_700_000_000_000, role: "owner" },
    "fixture-other-0002": { label: "Tablet", approvedAt: 1_700_000_001_000, role: "viewer" },
  },
  pending: {
    "fixture-pend-0003": { label: "New Laptop", firstSeen: 1_700_000_002_000, lastSeen: 1_700_000_003_000, ip: "127.0.0.1", attempts: 1 },
  },
};
const hosts = new Set();

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
  });
}

const backend = createServer(async (request, response) => {
  calls.push(`${request.method} ${request.url}`);
  hosts.add(request.headers.host);
  cookieSeen ||= request.headers.cookie?.includes("mso_fixture=synthetic") ?? false;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");

  if (request.url === "/api/auth/me" && request.method === "GET") {
    response.end(JSON.stringify(mode === "signed-out" ? signedOut : mode === "owner" ? ownerSession : viewerSession));
  } else if (request.url === "/api/auth/login" && request.method === "POST") {
    const body = await readBody(request);
    if (body.password === "pending-pass") {
      response.statusCode = 403;
      response.end(JSON.stringify({ error: "device_pending", deviceId: body.deviceId, label: body.deviceLabel }));
    } else if (body.password === "owner-pass") {
      mode = "owner";
      response.setHeader("Set-Cookie", "session=synthetic-owner; Path=/; HttpOnly; SameSite=Strict");
      response.end(JSON.stringify({ success: true }));
    } else {
      response.statusCode = 401;
      response.end(JSON.stringify({ error: "bad_password" }));
    }
  } else if (request.url === "/api/auth/logout" && request.method === "POST") {
    mode = "signed-out";
    response.setHeader("Set-Cookie", "session=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict");
    response.end(JSON.stringify({ success: true }));
  } else if (request.url === "/api/auth/devices" && request.method === "GET") {
    if (mode !== "owner") { response.statusCode = 403; response.end(JSON.stringify({ error: "Owner role required" })); return; }
    response.end(JSON.stringify(devices));
  } else if (request.url === "/api/auth/devices" && request.method === "POST") {
    if (mode !== "owner") { response.statusCode = 403; response.end(JSON.stringify({ error: "Owner role required" })); return; }
    const body = await readBody(request);
    if (body.action === "approve") {
      delete devices.pending[body.deviceId];
      devices.approved[body.deviceId] = { label: body.label || "Approved", approvedAt: Date.now(), role: body.role || "viewer" };
    } else if (body.action === "set_role" && devices.approved[body.deviceId]) {
      devices.approved[body.deviceId].role = body.role;
    } else if (body.action === "revoke") {
      delete devices.approved[body.deviceId];
    }
    response.end(JSON.stringify({ ok: true, ...devices }));
  } else if (request.url === "/api/v1/sys/stats" && request.method === "GET") {
    response.statusCode = mode === "revoked" ? 401 : 200;
    response.end(JSON.stringify(mode === "malformed" ? { cpu: "bad" } : stats));
  } else {
    response.statusCode = 404;
    response.end("{}");
  }
});

let browser, preview, output = "";
try {
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  preview = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview"], {
    cwd: process.cwd(), env: { ...process.env, MSO_SVELTE_API_ORIGIN: `http://127.0.0.1:${backend.address().port}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  preview.stdout.on("data", (chunk) => { output += chunk; });
  preview.stderr.on("data", (chunk) => { output += chunk; });
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

  // Increment 1 responsive + accessibility matrix (viewer session).
  for (const colorScheme of ["light", "dark"]) {
    for (const width of [320, 390, 1440]) {
      mode = "ready";
      const context = await browser.newContext({ viewport: { width, height: 844 }, colorScheme, reducedMotion: "reduce" });
      await context.addCookies([{ name: "mso_fixture", value: "synthetic", url: base }]);
      const page = await context.newPage(), errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const scripts = [];
      page.on("response", (response) => { if (response.request().resourceType() === "script") scripts.push(response.url()); });
      await page.goto(base);
      await page.getByText("1.0 GiB / 4.0 GiB", { exact: true }).waitFor();
      assert.equal(await page.getByRole("heading", { name: "System Monitor" }).count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      assert.ok(scripts.length > 0 && scripts.every((url) => !url.includes("/_next/")));
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Skip to content");
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Refresh" }).focus();
      const before = calls.length;
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Refresh" }).waitFor();
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

  // Increment 1 failure modes + Increment 2A full login/pending/owner devices/logout journey.
  const page = await browser.newPage();
  mode = "signed-out"; calls = [];
  await page.goto(base);
  await page.getByRole("heading", { name: "Sign in to the existing cockpit" }).waitFor();
  assert.deepEqual(calls, ["GET /api/auth/me"]);

  // Bad password -> pending -> owner login.
  await page.getByLabel("Cockpit password").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByText("Incorrect password. Check your credentials and try again.").waitFor();
  await page.getByLabel("Cockpit password").fill("pending-pass");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByText("Device approval required").waitFor();
  await page.getByLabel("Cockpit password").fill("owner-pass");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Devices & Approvals" }).waitFor();

  // Approve pending device as operator, revoke Tablet via inline two-step confirm, then sign out.
  await page.locator("#pending-role-fixture-pend-0003").selectOption("operator");
  await page.getByRole("button", { name: "Approve" }).click();
  await page.getByText("Device approved.").waitFor();
  assert.equal(devices.approved["fixture-pend-0003"]?.role, "operator");
  await page.getByRole("button", { name: "Revoke" }).first().click();
  await page.getByRole("button", { name: "Confirm revoke" }).click();
  await page.getByText("Device revoked.").waitFor();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Sign in to the existing cockpit" }).waitFor();

  // Revocation, malformed metrics, recovery, method/path/CSRF guards, HTML fallback.
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
  const crossSiteLogin = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" },
    body: JSON.stringify({ password: "x", deviceId: "aaaaaaaaaaaaaaaa" }),
  });
  assert.equal(crossSiteLogin.status, 403);
  assert.equal(calls.length, beforeMutation);
  for (const path of ["/api/config", "/api/auth/me/secret", "/api/v1/sys/stats-extra"]) {
    await fetch(`${base}${path}`);
    assert.equal(calls.length, beforeMutation);
  }
  assert.deepEqual([...hosts], ["127.0.0.1:4173"], "preview must preserve the incoming Host");
  assert.ok(cookieSeen, "same-origin synthetic cookie must reach the fixed local backend");
  await page.route("**/api/auth/me", (route) => route.fulfill({ contentType: "text/html", body: "<html>fallback</html>" }));
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.getByText("MSO API is unavailable. Configure the local backend before retrying.").waitFor();
  console.log("PASS Increment 1 + 2A: login, pending, owner devices, logout, CSRF 403, revocation, malformed, retry and proxy guards");
} finally {
  await browser?.close();
  if (preview && preview.exitCode === null) { preview.kill("SIGTERM"); await once(preview, "exit"); }
  backend.closeAllConnections();
  await new Promise((resolve) => backend.close(resolve));
}
