import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";

// Synthetic backend only: verifies Increments 1, 2A, 3A, and 3B (Terminal SSE, Files mutations, Services).
const viewerSession = { authenticated: true, deviceId: "fixture-viewer-0001", deviceLabel: "Browser fixture", role: "viewer" };
const ownerSession = { authenticated: true, deviceId: "fixture-owner-0001", deviceLabel: "Owner fixture", role: "owner" };
const signedOut = { authenticated: false, deviceId: null, deviceLabel: null, role: null };
const stats = { cpu: { pct: 12, cores: 4 }, mem: { used: 1024 ** 3, total: 4 * 1024 ** 3 }, disk: { used: 2 * 1024 ** 3, total: 8 * 1024 ** 3 }, uptime: 3_660_000 };
const processes = [{ pid: 101, name: "mso-shell-host", status: "S", cpu: 0.4, mem: 3 }, { pid: 202, name: "node", status: "R", cpu: 14.2, mem: 128 }];
const services = {
  services: [{ unit: "mso.service", scope: "user", load: "loaded", active: "active", sub: "running", description: "MSO host", controllable: true }],
  diagnostics: [], truncated: false, controlAllowlistConfigured: true, generatedAt: "2026-11-22T00:00:00.000Z",
};
let fsEntries = [
  { name: "projects", kind: "dir", size: 0, mtime: 1_700_000_000_000 },
  { name: "notes.txt", kind: "file", size: 14, mtime: 1_700_000_001_000 },
];
let notesContent = "hello from mso";
const termStreams = new Map();

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
    termStreams.set(id, res);
    req.on("close", () => termStreams.delete(id));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (url.pathname === "/api/auth/me") res.end(JSON.stringify(mode === "signed-out" ? signedOut : mode === "owner" ? ownerSession : viewerSession));
  else if (url.pathname === "/api/auth/login" && req.method === "POST") {
    const body = await readBody(req);
    if (body.password === "pending-pass") { res.statusCode = 403; res.end(JSON.stringify({ error: "device_pending", deviceId: body.deviceId, label: body.deviceLabel })); }
    else if (body.password === "owner-pass") { mode = "owner"; res.setHeader("Set-Cookie", "session=synthetic-owner; Path=/; HttpOnly; SameSite=Strict"); res.end(JSON.stringify({ success: true })); }
    else { res.statusCode = 401; res.end(JSON.stringify({ error: "bad_password" })); }
  } else if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    mode = "signed-out"; res.setHeader("Set-Cookie", "session=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict"); res.end(JSON.stringify({ success: true }));
  } else if (url.pathname === "/api/auth/devices" && req.method === "GET") {
    res.statusCode = mode === "owner" ? 200 : 403; res.end(JSON.stringify(mode === "owner" ? devices : { error: "Owner role required" }));
  } else if (url.pathname === "/api/auth/devices" && req.method === "POST") {
    const body = await readBody(req);
    if (body.action === "approve") { delete devices.pending[body.deviceId]; devices.approved[body.deviceId] = { label: body.label || "Approved", approvedAt: Date.now(), role: body.role || "viewer" }; }
    else if (body.action === "revoke") delete devices.approved[body.deviceId];
    res.end(JSON.stringify({ ok: true, ...devices }));
  } else if (url.pathname === "/api/v1/sys/stats") { res.statusCode = mode === "revoked" ? 401 : 200; res.end(JSON.stringify(mode === "malformed" ? { cpu: "bad" } : stats)); }
  else if (url.pathname === "/api/v1/sys/processes") res.end(JSON.stringify(processes));
  else if (url.pathname === "/api/v1/sys/services" && req.method === "GET") res.end(JSON.stringify(services));
  else if (url.pathname === "/api/v1/sys/services" && req.method === "POST") res.end(JSON.stringify(services.services[0]));
  else if (url.pathname === "/api/v1/fs/list") res.end(JSON.stringify({ path: "/home/demo", parent: "/home", entries: fsEntries }));
  else if (url.pathname === "/api/v1/fs/read") res.end(JSON.stringify(notesContent));
  else if (url.pathname === "/api/v1/fs/write" && req.method === "POST") { notesContent = (await readBody(req)).content; res.end(JSON.stringify({ ok: true })); }
  else if (url.pathname === "/api/v1/fs/mkdir" && req.method === "POST") {
    const name = String((await readBody(req)).path).split("/").pop();
    fsEntries = [...fsEntries, { name, kind: "dir", size: 0, mtime: Date.now() }];
    res.end(JSON.stringify({ kind: "dir" }));
  } else if (url.pathname === "/api/v1/fs/delete" && req.method === "DELETE") {
    const name = String((await readBody(req)).path).split("/").pop();
    fsEntries = fsEntries.filter((e) => e.name !== name);
    res.end(JSON.stringify({ ok: true }));
  } else if (url.pathname === "/api/v1/term/open" && req.method === "POST") res.end(JSON.stringify({ id: "t1" }));
  else if (url.pathname === "/api/v1/term/input" && req.method === "POST") {
    const body = await readBody(req);
    termStreams.get(body.id)?.write(`event: data\ndata: ${b64(`out:${body.data}`)}\n\n`);
    res.end(JSON.stringify({ ok: true }));
  } else if (url.pathname === "/api/v1/term/close" && req.method === "POST") {
    const body = await readBody(req); termStreams.get(body.id)?.end(); termStreams.delete(body.id);
    res.end(JSON.stringify({ ok: true }));
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

  const page = await browser.newPage();
  mode = "signed-out"; calls = [];
  await page.goto(base);
  await page.getByRole("heading", { name: "Sign in to the existing cockpit" }).waitFor();
  assert.deepEqual(calls, ["GET /api/auth/me"]);
  await page.getByLabel("Cockpit password").fill("owner-pass");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Devices & Approvals" }).waitFor();

  // Increment 3A + 3B: Files (mkdir + edit/save + delete), Services (inline 2-step restart), Terminal (SSE + input).
  await page.getByRole("button", { name: "Open Files" }).click();
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("drafts");
  await page.getByRole("button", { name: "Create" }).click();
  await page.locator("button[data-entry-open='drafts']").waitFor();
  await page.locator("button[data-entry-open='notes.txt']").click();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.locator("textarea").fill("updated via svelte");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByText("File saved.").waitFor();
  assert.equal(notesContent, "updated via svelte");
  await page.locator("button[data-delete-entry='drafts']").click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await page.getByText('Deleted "drafts".').waitFor();
  await page.getByRole("button", { name: "Close Files" }).click();

  await page.getByRole("button", { name: "Open Services" }).click();
  await page.getByText("mso.service").waitFor();
  await page.getByRole("button", { name: "Restart" }).click();
  await page.getByRole("button", { name: "Confirm restart" }).click();
  await page.getByText("Completed restart on mso.service.").waitFor();
  await page.getByRole("button", { name: "Close Services" }).click();

  await page.getByRole("button", { name: "Open Terminal" }).click();
  await page.getByText("mso-shell ready").waitFor();
  await page.getByLabel("Terminal command").fill("echo hi");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText("out:echo hi").waitFor();
  await page.getByRole("button", { name: "Close Terminal" }).click();

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Sign in to the existing cockpit" }).waitFor();
  assert.deepEqual([...hosts], ["127.0.0.1:4173"]);
  assert.ok(cookieSeen);
  console.log("PASS Increments 1 + 2A + 3A + 3B: auth, Files mutations, Services Center, Terminal SSE, and proxy guards");
} finally {
  for (const s of termStreams.values()) s.end();
  await browser?.close();
  if (preview && preview.exitCode === null) { preview.kill("SIGTERM"); await once(preview, "exit"); }
  backend.closeAllConnections();
  await new Promise((resolve) => backend.close(resolve));
}
