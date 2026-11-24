import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SVELTE_DIR = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(SVELTE_DIR, "../..");
const BUILD_DIR = process.env.MSO_SVELTE_BUILD_DIR || path.join(SVELTE_DIR, "build");
export const RUST_BIN = process.env.MSO_RUST_SHELL_BIN || path.join(REPO_ROOT, "rust-shell/target/release/mso-shell-host");
export const SCREENSHOT_DIR = process.env.MSO_SCREENSHOT_DIR
  || "/home/rahman/.gemini/antigravity/brain/3ae791c6-30f4-4c8b-b6f6-bc78392ad68e/screenshots";

const REQUIRED_ASSETS = [
  { path: "/wallpapers/aurora.webp", mimePrefix: "image/webp" },
  { path: "/wallpapers/aurora-dark.webp", mimePrefix: "image/webp" },
  { path: "/wallpapers/win11.webp", mimePrefix: "image/webp" },
  { path: "/wallpapers/ios.webp", mimePrefix: "image/webp" },
  { path: "/wallpapers/material.webp", mimePrefix: "image/webp" },
  { path: "/icon.svg", mimePrefix: "image/svg+xml" },
  { path: "/app-icons/windows/files.webp", mimePrefix: "image/webp" },
  { path: "/app-icons/macos/files.webp", mimePrefix: "image/webp" },
  { path: "/manifest.webmanifest", mimePrefix: "application/" },
  { path: "/build-meta.json", mimePrefix: "application/json" },
];

export const SHELL_MATRIX = [
  { shell: "macos", viewport: { width: 1440, height: 900 }, settingsVariant: "macos-sidebar", filesVariant: "finder", mobile: false },
  { shell: "windows", viewport: { width: 1440, height: 900 }, settingsVariant: "windows-rail", filesVariant: "explorer", mobile: false },
  { shell: "ios", viewport: { width: 390, height: 844 }, settingsVariant: "ios-stack", filesVariant: "ios-files", mobile: true },
  { shell: "android", viewport: { width: 390, height: 844 }, settingsVariant: "android-list", filesVariant: "android-files", mobile: true },
  { shell: "dashboard", viewport: { width: 1440, height: 900 }, settingsVariant: "dashboard-tabs", filesVariant: "dashboard", mobile: false },
];

export const OVERFLOW_WIDTHS = [320, 390, 640, 641, 719, 720, 768, 1024, 1440];

async function findFreeLoopbackPort() {
  const probe = createNetServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const readBody = (req) => new Promise((resolve) => {
  let raw = "";
  req.on("data", (chunk) => { raw += chunk; });
  req.on("end", () => {
    try { resolve(raw ? JSON.parse(raw) : {}); }
    catch { resolve({}); }
  });
});

export function ensureBuild() {
  if (existsSync(path.join(BUILD_DIR, "index.html"))) return;
  const res = spawnSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], {
    cwd: SVELTE_DIR,
    stdio: "inherit",
  });
  assert.equal(res.status, 0, "vite build failed");
}

function normalizeFixturePath(raw) {
  const trimmed = (raw || "~").trim();
  if (!trimmed || trimmed === "~" || trimmed === "." || trimmed === "/home/demo") return "/home/demo";
  if (trimmed.startsWith("~/")) return `/home/demo/${trimmed.slice(2).replace(/^\/+/, "")}`.replace(/\/+$/, "");
  return trimmed.replace(/\/+$/, "") || "/";
}

export function createFixtureBackend() {
  const state = {
    role: "viewer",
    prefs: {
      tweaks: {},
      quicklinks: [],
      updates: { auto: true, channel: "stable" },
      updatedAt: 1_700_000_000_000,
    },
    files: new Map([
      ["/home/demo/notes.txt", "hello from mso demo notes\nline two"],
      ["/home/demo/projects/app.ts", "export const greeting = 'hello from app.ts';\n"],
    ]),
  };

  const sessions = {
    viewer: { authenticated: true, deviceId: "matrix-viewer-0001", deviceLabel: "Matrix Viewer", role: "viewer" },
    owner: { authenticated: true, deviceId: "matrix-owner-0001", deviceLabel: "Matrix Owner", role: "owner" },
  };
  const stats = {
    cpu: { pct: 18.4, cores: 8 },
    mem: { used: 2 * 1024 ** 3, total: 16 * 1024 ** 3 },
    disk: { used: 32 * 1024 ** 3, total: 128 * 1024 ** 3 },
    uptime: 7_320_000,
  };
  const devices = {
    approved: {
      "matrix-owner-0001": { label: "Matrix Owner", approvedAt: 1_700_000_000_000, role: "owner" },
      "matrix-viewer-0001": { label: "Matrix Viewer", approvedAt: 1_700_000_010_000, role: "viewer" },
    },
    pending: {},
  };
  const workflows = {
    graphs: [
      {
        id: "wf-matrix-1",
        name: "Health Sweep",
        description: "Synthetic workflow graph",
        status: "active",
        nodes: [{ id: "n1" }, { id: "n2" }],
        edges: [{ id: "e1" }],
        metadata: { tags: ["matrix"] },
        createdAt: "2026-11-24T00:00:00.000Z",
        updatedAt: "2026-11-24T00:00:00.000Z",
        revision: "r1",
      },
    ],
  };

  function listDir(rawPath) {
    const p = normalizeFixturePath(rawPath);
    if (p === "/home/demo") {
      return {
        path: "/home/demo",
        parent: "/home",
        entries: [
          { name: "projects", kind: "dir", size: 4096 },
          { name: "notes.txt", kind: "file", size: Buffer.byteLength(state.files.get("/home/demo/notes.txt") ?? "") },
        ],
      };
    }
    if (p === "/home/demo/projects") {
      return {
        path: "/home/demo/projects",
        parent: "/home/demo",
        entries: [
          { name: "app.ts", kind: "file", size: Buffer.byteLength(state.files.get("/home/demo/projects/app.ts") ?? "") },
        ],
      };
    }
    if (p === "/home") {
      return {
        path: "/home",
        parent: null,
        entries: [{ name: "demo", kind: "dir", size: 4096 }],
      };
    }
    return null;
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    if (url.pathname === "/api/auth/me") {
      res.end(JSON.stringify(sessions[state.role]));
      return;
    }
    if (url.pathname === "/api/auth/devices") {
      res.statusCode = state.role === "owner" ? 200 : 403;
      res.end(JSON.stringify(state.role === "owner" ? devices : { error: "forbidden" }));
      return;
    }
    if (url.pathname === "/api/auth/account") {
      res.end(JSON.stringify({ authenticated: true, role: state.role, deviceLabel: sessions[state.role].deviceLabel, passwordConfigured: true }));
      return;
    }
    if (url.pathname === "/api/prefs" && req.method === "GET") {
      res.end(JSON.stringify(state.prefs));
      return;
    }
    if (url.pathname === "/api/prefs" && req.method === "POST") {
      if (state.role !== "owner") {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: "owner_required" }));
        return;
      }
      const body = await readBody(req);
      if (body.tweaks && typeof body.tweaks === "object") {
        state.prefs = {
          ...state.prefs,
          tweaks: { ...(state.prefs.tweaks ?? {}), ...body.tweaks },
          updatedAt: Date.now(),
        };
      }
      if (Array.isArray(body.quicklinks)) {
        state.prefs = { ...state.prefs, quicklinks: body.quicklinks, updatedAt: Date.now() };
      }
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === "/api/v1/sys/stats") {
      res.end(JSON.stringify(stats));
      return;
    }
    if (url.pathname === "/api/v1/sys/update") {
      res.end(JSON.stringify({ current: "0.1.0", latest: "0.1.0", upToDate: true, channel: "stable" }));
      return;
    }
    if (url.pathname === "/api/v1/sys/audit") {
      res.end(JSON.stringify({ entries: [] }));
      return;
    }
    if (url.pathname === "/api/v1/workflows") {
      res.end(JSON.stringify(url.searchParams.get("runs") === "1" ? { runs: [], total: 0 } : workflows));
      return;
    }
    if (url.pathname === "/api/v1/fs/list") {
      const listing = listDir(url.searchParams.get("path") ?? "~");
      if (!listing) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "not_found" }));
        return;
      }
      res.end(JSON.stringify(listing));
      return;
    }
    if (url.pathname === "/api/v1/fs/read") {
      const p = normalizeFixturePath(url.searchParams.get("path") ?? "");
      if (!state.files.has(p)) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "not_found" }));
        return;
      }
      res.end(JSON.stringify(state.files.get(p)));
      return;
    }
    if (url.pathname === "/api/v1/fs/write" && req.method === "POST") {
      const body = await readBody(req);
      const p = normalizeFixturePath(String(body.path ?? ""));
      state.files.set(p, String(body.content ?? ""));
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === "/api/v1/fs/search") {
      res.end(JSON.stringify([]));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not_found" }));
  });

  return { server, state };
}

export async function startVitePreview(apiOrigin) {
  const port = await findFreeLoopbackPort();
  let output = "";
  const proc = spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: SVELTE_DIR,
      env: { ...process.env, MSO_SVELTE_API_ORIGIN: apiOrigin },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  proc.stdout.on("data", (c) => { output += c.toString(); });
  proc.stderr.on("data", (c) => { output += c.toString(); });
  const origin = `http://127.0.0.1:${port}`;
  for (const deadline = Date.now() + 30_000; Date.now() < deadline;) {
    if (proc.exitCode !== null) throw new Error(`vite preview exited early: ${output}`);
    try {
      const r = await fetch(origin);
      if (r.ok) return { proc, origin };
    } catch { /* startup */ }
    await delay(100);
  }
  throw new Error(`vite preview timeout: ${output}`);
}

export async function startRustHost(apiOrigin) {
  if (!existsSync(RUST_BIN)) return null;
  let stdout = "";
  let stderr = "";
  const proc = spawn(RUST_BIN, ["--assets", BUILD_DIR, "--port", "0", "--api-origin", apiOrigin], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`mso-shell-host timeout: ${stderr}`)), 10_000);
    proc.stdout.on("data", (c) => {
      stdout += c.toString();
      const m = /MSO_RUST_SHELL_READY\s+(http:\/\/127\.0\.0\.1:\d+)/.exec(stdout);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    proc.stderr.on("data", (c) => { stderr += c.toString(); });
    proc.once("exit", (code) => { clearTimeout(timer); reject(new Error(`mso-shell-host exited ${code}: ${stderr}`)); });
  });
  return { proc, origin };
}

export function attachErrorCollectors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text().split("\n")[0]}`);
  });
  return errors;
}

export async function verifyAssetEndpoints(origin, label) {
  const checked = [];
  for (const asset of REQUIRED_ASSETS) {
    const res = await fetch(`${origin}${asset.path}`);
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    const buf = await res.arrayBuffer();
    assert.equal(res.status, 200, `${label} ${asset.path}: expected 200, got ${res.status}`);
    assert.ok(!ct.includes("text/html"), `${label} ${asset.path}: returned text/html (${ct})`);
    assert.ok(ct.startsWith(asset.mimePrefix), `${label} ${asset.path}: unexpected MIME ${ct}`);
    assert.ok(buf.byteLength > 0, `${label} ${asset.path}: empty response`);
    checked.push({ path: asset.path, status: res.status, contentType: ct, bytes: buf.byteLength });
  }
  const missing = await fetch(`${origin}/wallpapers/missing.webp`);
  const missingCt = (missing.headers.get("content-type") ?? "").toLowerCase();
  assert.equal(missing.status, 404, `${label} /wallpapers/missing.webp: expected 404, got ${missing.status} (${missingCt})`);
  assert.ok(!(missing.status === 200 && missingCt.includes("text/html")), `${label} missing asset returned 200 text/html`);
  return { origin, checkedCount: checked.length, missingAssetStatus: missing.status };
}

export async function waitForVisibleImagesDecoded(page) {
  await page.evaluate(async () => {
    const imgs = [...document.querySelectorAll("img")];
    for (const img of imgs) {
      const style = getComputedStyle(img);
      const rect = img.getBoundingClientRect();
      const visible = style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      if (visible && img.loading === "lazy") img.loading = "eager";
    }
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      const pending = imgs.filter((img) => {
        const style = getComputedStyle(img);
        const rect = img.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0 && !img.complete;
      });
      if (pending.length === 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
  });

  const report = await page.evaluate(() => {
    const results = [];
    for (const img of document.querySelectorAll("img")) {
      const style = getComputedStyle(img);
      const rect = img.getBoundingClientRect();
      const visible = style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      if (!visible) continue;
      results.push({
        src: img.getAttribute("src"),
        complete: img.complete,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      });
    }
    return results;
  });
  assert.ok(report.length > 0, "expected at least one visible <img> to verify decode");
  const broken = report.filter((i) => !i.complete || i.naturalWidth <= 0);
  assert.deepEqual(broken, [], `broken visible images: ${JSON.stringify(broken)}`);
  return report.length;
}

export async function waitWorkspaceReady(page) {
  await page.locator(".workspace").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("[data-monitor-state='ready']").waitFor({ state: "attached", timeout: 10_000 });
}

export async function switchQuickShell(page, shell) {
  const select = page.locator('select[aria-label="Shell chrome"]').first();
  await select.waitFor({ state: "visible", timeout: 8_000 });
  await select.selectOption(shell);
  await page.locator(`.workspace[data-chrome="${shell}"]`).waitFor({ state: "visible", timeout: 8_000 });
}

export async function openAppFromShell(page, shell, accessibleName) {
  if (shell === "ios") {
    await page.locator(".ios-app-grid").getByRole("button", { name: accessibleName, exact: true }).click();
  } else if (shell === "android") {
    await page.locator(".android-app-grid").getByRole("button", { name: accessibleName, exact: true }).click();
  } else {
    await page.locator(".app-dock").getByRole("button", { name: accessibleName, exact: true }).click();
  }
}

export async function runDeepLinkSuite(browser, origin, label, fixtureState) {
  fixtureState.role = "owner";
  fixtureState.prefs = { tweaks: {}, quicklinks: [], updates: { auto: true, channel: "stable" }, updatedAt: Date.now() };

  const checks = {};
  for (const target of [
    { path: "/settings", waitFor: "[data-settings-variant]" },
    { path: "/files/home/demo", waitFor: "[data-files-variant]" },
    { path: "/devices", waitFor: "text=Devices & Approvals" },
  ]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errors = attachErrorCollectors(page);
    const res = await page.goto(`${origin}${target.path}`, { waitUntil: "domcontentloaded" });
    assert.equal(res?.status(), 200, `${label} cold-load ${target.path} expected HTTP 200, got ${res?.status()}`);
    await waitWorkspaceReady(page);
    const bodyText = await page.evaluate(() => document.body.innerText);
    assert.ok(!bodyText.includes("404 Not Found"), `${label} ${target.path} rendered 404 Not Found`);
    await page.locator(target.waitFor).first().waitFor({ state: "visible", timeout: 8_000 });
    if (target.path === "/files/home/demo") {
      await page.locator("button[data-entry-open='notes.txt']").waitFor({ state: "visible", timeout: 8_000 });
      await page.locator("button[data-entry-open='projects']").waitFor({ state: "visible", timeout: 8_000 });
    }
    assert.deepEqual(errors, [], `${label} ${target.path} errors: ${errors.join("; ")}`);
    checks[target.path] = "ok";
    await ctx.close();
  }

  // Back/Forward + reload navigation
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = attachErrorCollectors(page);
  await page.goto(`${origin}/settings`, { waitUntil: "domcontentloaded" });
  await waitWorkspaceReady(page);
  await page.locator("[data-settings-variant]").waitFor({ state: "visible", timeout: 8_000 });

  await page.locator(".app-dock").getByRole("button", { name: "Devices", exact: true }).click();
  await page.getByRole("heading", { name: "Devices & Approvals" }).waitFor({ state: "visible", timeout: 8_000 });
  await page.waitForFunction(() => window.location.pathname === "/devices", undefined, { timeout: 5_000 });

  await page.goBack();
  await page.waitForFunction(() => window.location.pathname === "/settings", undefined, { timeout: 5_000 });
  await page.locator('article[data-win-app="settings"][data-focused="true"]').waitFor({ state: "visible", timeout: 5_000 });

  await page.goForward();
  await page.waitForFunction(() => window.location.pathname === "/devices", undefined, { timeout: 5_000 });
  await page.locator('article[data-win-app="devices"][data-focused="true"]').waitFor({ state: "visible", timeout: 5_000 });

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitWorkspaceReady(page);
  await page.getByRole("heading", { name: "Devices & Approvals" }).waitFor({ state: "visible", timeout: 8_000 });
  const reloadText = await page.evaluate(() => document.body.innerText);
  assert.ok(!reloadText.includes("404 Not Found"), `${label} reload on /devices showed 404`);

  // Also verify nested Files deep-link reload after subfolder navigation
  await page.goto(`${origin}/files/home/demo`, { waitUntil: "domcontentloaded" });
  await waitWorkspaceReady(page);
  await page.locator('button[data-entry-open="projects"]').click();
  await page.locator('button[data-entry-open="app.ts"]').waitFor({ state: "visible", timeout: 8_000 });
  await page.waitForFunction(() => window.location.pathname === "/files/home/demo/projects", undefined, { timeout: 5_000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitWorkspaceReady(page);
  await page.locator('button[data-entry-open="app.ts"]').waitFor({ state: "visible", timeout: 8_000 });

  assert.deepEqual(errors, [], `${label} back/forward errors: ${errors.join("; ")}`);
  await ctx.close();

  return { origin, coldLinks: checks, backForwardReload: { routePair: ["/settings", "/devices"], nestedFilesReload: "/files/home/demo/projects", status: "ok" } };
}
