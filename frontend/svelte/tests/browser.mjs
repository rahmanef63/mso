import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";

// Synthetic backend only: this test never contacts a deployment or private store.
const session = { authenticated: true, deviceId: "fixture", deviceLabel: "Browser fixture", role: "viewer" };
const signedOut = { authenticated: false, deviceId: null, deviceLabel: null, role: null };
const stats = { cpu: { pct: 12, cores: 4 }, mem: { used: 1024 ** 3, total: 4 * 1024 ** 3 }, disk: { used: 2 * 1024 ** 3, total: 8 * 1024 ** 3 }, uptime: 3_660_000 };
let mode = "ready", calls = [], cookieSeen = false;
const hosts = new Set();
const backend = createServer((request, response) => {
  calls.push(`${request.method} ${request.url}`);
  hosts.add(request.headers.host);
  cookieSeen ||= request.headers.cookie?.includes("mso_fixture=synthetic") ?? false;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  if (request.url === "/api/auth/me") {
    response.end(JSON.stringify(mode === "signed-out" ? signedOut : session));
  } else if (request.url === "/api/v1/sys/stats") {
    response.statusCode = mode === "revoked" ? 401 : 200;
    response.end(JSON.stringify(mode === "malformed" ? { cpu: "bad" } : stats));
  } else { response.statusCode = 404; response.end("{}"); }
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
      await page.waitForFunction(() => !document.querySelector("button")?.disabled);
      assert.equal(calls.length - before, 2);
      if (width === 320) {
        await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      }
      await context.close();
      console.log(`PASS monitor ready, keyboard, no overflow: ${width}px ${colorScheme}`);
    }
  }
  const page = await browser.newPage();
  mode = "signed-out"; calls = [];
  await page.goto(base);
  await page.getByRole("heading", { name: "Sign in to the existing cockpit" }).waitFor();
  assert.deepEqual(calls, ["GET /api/auth/me"]);
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
  for (const path of ["/api/config", "/api/auth/me/secret", "/api/v1/sys/stats-extra"]) {
    await fetch(`${base}${path}`);
    assert.equal(calls.length, beforeMutation);
  }
  assert.deepEqual([...hosts], ["127.0.0.1:4173"], "preview must preserve the incoming Host");
  assert.ok(cookieSeen, "same-origin synthetic cookie must reach the fixed local backend");
  await page.route("**/api/auth/me", (route) => route.fulfill({ contentType: "text/html", body: "<html>fallback</html>" }));
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.getByText("MSO API is unavailable. Configure the local backend before retrying.").waitFor();
  console.log("PASS signed-out, revocation, malformed metrics, retry, HTML fallback, cookie and read-only proxy");
} finally {
  await browser?.close();
  if (preview && preview.exitCode === null) { preview.kill("SIGTERM"); await once(preview, "exit"); }
  backend.closeAllConnections();
  await new Promise((resolve) => backend.close(resolve));
}
