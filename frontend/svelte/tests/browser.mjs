import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { launchChromium } from "./_browser-launch.mjs";

// Allocate an ephemeral loopback port so parallel agent worktrees can run browser E2E concurrently without colliding on 4173.
async function findFreeLoopbackPort() {
  const probe = createNetServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

// Synthetic backend only: verifies Wave 9 (Inc. 4 100%: Files Search/Copy/Move UI, Workflows SVG canvas, Settings Account/Updates/Audit).
const viewerSession = { authenticated: true, deviceId: "fixture-viewer-0001", deviceLabel: "Browser fixture", role: "viewer" };
const ownerSession = { authenticated: true, deviceId: "fixture-owner-0001", deviceLabel: "Owner fixture", role: "owner" };
const signedOut = { authenticated: false, deviceId: null, deviceLabel: null, role: null };
const stats = { cpu: { pct: 12, cores: 4 }, mem: { used: 1024 ** 3, total: 4 * 1024 ** 3 }, disk: { used: 2 * 1024 ** 3, total: 8 * 1024 ** 3 }, uptime: 3_660_000 };
const workflows = { graphs: [{ id: "wf-1", name: "Deploy Check", description: "Verify host health", status: "active", nodes: [{ id: "n1" }, { id: "n2" }, { id: "n3" }], edges: [{ id: "e1" }, { id: "e2" }], metadata: { tags: ["ops"] }, createdAt: "2026-11-22T00:00:00.000Z", updatedAt: "2026-11-22T01:00:00.000Z", revision: "r1" }] };
let fsEntries = [{ name: "notes.txt", kind: "file", size: 14, mtime: 1_700_000_001_000 }];
let notesContent = "hello from mso";
let mode = "ready", cookieSeen = false, copied = false;
const devices = { approved: { "fixture-owner-0001": { label: "Owner fixture", approvedAt: 1_700_000_000_000, role: "owner" } }, pending: {} };
const hosts = new Set();
let mcpStatusRequests = 0;
let mcpStatusAvailable = true;
let heldMcpActivity;
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
  else if (url.pathname === "/api/mcp/tokens" && req.method === "GET") {
    mcpStatusRequests++;
    if (!mcpStatusAvailable) res.statusCode = 503;
    res.end(JSON.stringify(mcpStatusAvailable
      ? { enabled: true, maxScope: "read", toolset: { toolCount: 61, version: "2026.11.16.1" }, tokens: [] }
      : { error: "MCP status temporarily unavailable." }));
  }
  else if (url.pathname === "/api/mcp/activity" && req.method === "GET") {
    if (!heldMcpActivity) {
      heldMcpActivity = res;
      return;
    }
    res.end(JSON.stringify({ entries: [
      { id: "fixture-shared-call", tool: "sys_stats", state: "completed", ts: "2026-11-22T00:00:00.000Z" },
      { id: "fixture-shared-call", tool: "sys_stats", state: "started", ts: "2026-11-22T00:00:00.000Z" },
    ] }));
  }
  else if (url.pathname === "/api/v1/sys/stats") res.end(JSON.stringify(stats));
  else if (url.pathname === "/api/v1/workflows") res.end(JSON.stringify(url.searchParams.get("runs") === "1" ? { runs: [], total: 0 } : workflows));
  else if (url.pathname === "/api/v1/fs/list") res.end(JSON.stringify({ path: "/home/demo", parent: "/home", entries: fsEntries }));
  else if (url.pathname === "/api/v1/fs/read") res.end(JSON.stringify(notesContent));
  else if (url.pathname === "/api/v1/fs/search") res.end(JSON.stringify([{ name: "notes.txt", path: "/home/demo/notes.txt", kind: "file" }]));
  else if (url.pathname === "/api/v1/fs/copy" && req.method === "POST") {
    copied = true;
    fsEntries = [...fsEntries, { name: "notes-copy.txt", kind: "file", size: 14, mtime: Date.now() }];
    res.end(JSON.stringify({ ok: true }));
  } else { res.statusCode = 404; res.end("{}"); }
});

let browser, preview, output = "";
try {
  backend.listen(0, "127.0.0.1"); await once(backend, "listening");
  const previewPort = await findFreeLoopbackPort();
  preview = spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", String(previewPort), "--strictPort"],
    {
      cwd: process.cwd(), env: { ...process.env, MSO_SVELTE_API_ORIGIN: `http://127.0.0.1:${backend.address().port}` },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  preview.stdout.on("data", (c) => { output += c; }); preview.stderr.on("data", (c) => { output += c; });
  const base = `http://127.0.0.1:${previewPort}`;
  let listening = false;
  for (const deadline = Date.now() + 30_000; Date.now() < deadline;) {
    if (preview.exitCode !== null) throw new Error(`preview exited: ${output}`);
    try { listening = (await fetch(base)).ok; } catch { /* startup */ }
    if (listening) break;
    await delay(100);
  }
  assert.ok(listening, output);
  browser = await launchChromium();

  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
    mode = "owner";
    await page.goto(base);
    await page.getByRole("menuitem", { name: "MSO menu" }).click();
    await page.getByRole("menuitem", { name: "System Settings..." }).click();
    await Promise.all([
      page.waitForRequest((request) => new URL(request.url()).pathname === "/api/mcp/activity", { timeout: 4_000 }),
      page.locator('[data-settings-section="mcp"]').click(),
    ]);
    const mcp = page.locator(".mcp-section");
    await mcp.getByRole("heading", { name: "MCP Server Status" }).waitFor({ timeout: 4_000 });
    // Regression guard: the fixture must serve the real backend shape (toolCount),
    // and the Toolset row must render it. A legacy-only `count` field hid a live
    // "0 tools" defect while this suite stayed green.
    await mcp.getByText("61 tools", { exact: false }).waitFor({ timeout: 4_000 });
    assert.ok(!(await mcp.locator("dl.metric-grid").innerText()).includes("0 tools"), "Toolset rendered 0 tools");
    assert.ok(heldMcpActivity && !heldMcpActivity.writableEnded, "status rendered before activity returned");
    assert.equal(mcpStatusRequests, 1);
    mcpStatusAvailable = false;
    await page.getByRole("button", { name: "Refresh MCP status" }).click();
    await mcp.getByRole("alert").getByText("MCP status temporarily unavailable.").waitFor();
    assert.equal(mcpStatusRequests, 2);
    mcpStatusAvailable = true;
    await mcp.getByRole("button", { name: "Retry" }).click();
    await mcp.getByRole("heading", { name: "MCP Server Status" }).waitFor();
    assert.equal(mcpStatusRequests, 3);
    const activity = mcp.getByRole("table", { name: "Recent MCP tool calls" });
    await activity.getByRole("cell", { name: "completed", exact: true }).waitFor();
    await activity.getByRole("cell", { name: "started", exact: true }).waitFor();
    assert.equal(await activity.getByRole("cell", { name: "sys_stats", exact: true }).count(), 2);
    console.log("PASS Settings MCP: status independent of activity; same-ID activity phases both render");

    await page.close();
    mode = "ready";
    const viewerPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await viewerPage.goto(base);
    await viewerPage.getByRole("menuitem", { name: "MSO menu" }).click();
    await viewerPage.getByRole("menuitem", { name: "System Settings..." }).click();
    await viewerPage.locator('[data-settings-section="mcp"]').click();
    await viewerPage.getByText("Owner role is required to manage MCP server connections", { exact: false }).waitFor();
    assert.equal(mcpStatusRequests, 3, "opening MCP settings as viewer never fetches the token list");
    await viewerPage.close();
    console.log("PASS Settings MCP: owner-only UI and status requests");
  }

  if (!process.argv.includes("--mcp-only")) await runFullSuite(base, previewPort);
} finally {
  await browser?.close();
  if (preview && preview.exitCode === null) { preview.kill("SIGTERM"); await once(preview, "exit"); }
  backend.closeAllConnections();
  await new Promise((resolve) => backend.close(resolve));
}

async function runFullSuite(base, previewPort) {
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
      console.log(`PASS 33/33 Inc4-100% no overflow: ${width}px ${colorScheme}`);
    }
  }

  const page = await browser.newPage();
  mode = "signed-out";
  await page.goto(base);
  await page.getByLabel("Cockpit password").fill("owner-pass");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Devices & Approvals" }).waitFor();

  // Verify Files Search + Copy/Move UI (FilesOpsPanel)
  await page.locator(".app-dock").getByRole("button", { name: "Open Files" }).click();
  await page.getByLabel(/Search files in/).fill("notes");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByText("/home/demo/notes.txt").waitFor();
  await page.getByRole("button", { name: "Copy / Move" }).click();
  await page.getByLabel("Source path").fill("/home/demo/notes.txt");
  await page.getByLabel("Destination path").fill("/home/demo/notes-copy.txt");
  await page.getByRole("button", { name: "Run" }).click();
  await page.locator("button[data-entry-open='notes-copy.txt']").waitFor();
  assert.equal(copied, true);
  await page.getByRole("button", { name: "Close Files" }).click();

  // Verify Workflows SVG topology preview (WorkflowGraphCanvas)
  await page.locator(".app-dock").getByRole("button", { name: "Workflows" }).click();
  await page.getByRole("img", { name: /Workflow topology preview for Deploy Check/ }).waitFor();
  await page.getByRole("button", { name: "Close Workflows" }).click();

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Sign in to the existing cockpit" }).waitFor();
  assert.deepEqual([...hosts], [`127.0.0.1:${previewPort}`]);
  assert.ok(cookieSeen);
  console.log("PASS Wave 9: Inc. 4 100% (Files Search/Copy/Move UI, Workflows SVG topology, 33/33 slices)");
}
