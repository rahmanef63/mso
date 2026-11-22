#!/usr/bin/env node
// Per-app open cost inside the running shell: how long until the window appears, which
// chunks that pulled, and how much main-thread time it cost. This is the number a slice
// migration moves, so it is measured per slice rather than as a page average.
//
// Local compute only: network is NOT throttled here. The question is "what does opening
// this app cost this machine", not "how fast does it download".
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { releaseFixture } from "./e2e/release-fixture.mjs";
import { SHELL_READY, installPerfObservers } from "./lib/browser-metrics.mjs";

const { values } = parseArgs({
  options: {
    base: { type: "string" },
    apps: { type: "string" },
    output: { type: "string" },
    json: { type: "boolean", default: false },
  },
  strict: true,
  allowPositionals: false,
});

const DEFAULTS = ["Image Editor", "Terminal", "System Monitor", "Video Editor"];
const apps = values.apps ? values.apps.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULTS;

// The shell renders every active window as a [data-window] container; counting them is
// how an open is detected without depending on any app's internal markup.
//
// aria-label only, on purpose. A role/name lookup also matches the macOS menu-bar title
// that displays the focused app's name, so `getByRole("button", { name: "System Monitor" })`
// silently clicks the menu bar and the window never opens.
const findIcon = (page, name) =>
  page.locator(`[aria-label="${name}"], [aria-label="${name} (running)"]`).first();

async function measureApp(page, name) {
  const icon = findIcon(page, name);
  if ((await icon.count()) === 0) return { app: name, openMs: null, error: "icon not found", newResources: 0, newResourceFiles: [], longTaskMs: 0 };

  const windowsBefore = await page.locator("[data-window]").count();
  const resourcesBefore = await page.evaluate(() => performance.getEntriesByType("resource").length);
  await page.evaluate(() => window.__perfResetLongTasks());

  const started = Date.now();
  await icon.click({ noWaitAfter: true });
  let openMs = null;
  let error;
  try {
    await page.waitForFunction((n) => document.querySelectorAll("[data-window]").length > n, windowsBefore, { timeout: 15000 });
    openMs = Date.now() - started;
  } catch {
    error = "window did not open";
  }

  // Window mounting is not the whole cost: the content chunk evaluates after it. Waiting
  // 2 s and reading the tasks accumulated since the reset captures that.
  await page.waitForTimeout(2000);
  const longTaskMs = await page.evaluate(() => Math.round((window.__perfLongTasks ?? []).reduce((sum, t) => sum + t.duration, 0)));
  const newResourceFiles = await page.evaluate((from) =>
    performance.getEntriesByType("resource").slice(from)
      .map((e) => { try { return new URL(e.name, location.href).pathname.split("/").pop() || null; } catch { return null; } })
      .filter(Boolean), resourcesBefore);

  return { app: name, openMs, ...(error ? { error } : {}), newResources: newResourceFiles.length, newResourceFiles, longTaskMs };
}

function printTable(rows) {
  const cells = rows.map((r) => [r.app, r.openMs ?? r.error ?? "n/a", String(r.newResources), String(r.longTaskMs), r.newResourceFiles.slice(0, 3).join(", ") + (r.newResourceFiles.length > 3 ? ` (+${r.newResourceFiles.length - 3})` : "")]);
  const headers = ["App", "Open (ms)", "Resources", "Long Task (ms)", "Chunks"];
  const widths = headers.map((h, i) => Math.max(h.length, ...cells.map((r) => r[i].length)));
  const pad = (s, w) => String(s).padEnd(w);
  console.log(headers.map((h, i) => pad(h, widths[i])).join("  "));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of cells) console.log(row.map((c, i) => pad(c, widths[i])).join("  "));
}

let fixture;
let browser;
try {
  const base = values.base ?? (fixture = await releaseFixture()).base;
  browser = await chromium.launch({ headless: true });

  // One fresh context per app. Reusing a page means the second click happens with the
  // first app's window already open — the window count does not increase, and a window
  // that happens to cover the dock makes the next icon unclickable. A cold context per
  // app also keeps the measured cost attributable to that app instead of to whatever the
  // previous one left in memory.
  const rows = [];
  for (const name of apps) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      await context.addInitScript(installPerfObservers);
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await page.goto(base, { waitUntil: "load", timeout: 60000 });
      await page.locator(SHELL_READY).waitFor({ state: "visible", timeout: 60000 });
      await page.waitForTimeout(1500);
      rows.push(await measureApp(page, name));
    } finally {
      await context.close();
    }
  }

  const report = { schemaVersion: 1, createdAt: new Date().toISOString(), throttle: { cpuRate: 4 }, apps: rows };
  if (values.output) {
    fs.mkdirSync(values.output, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(values.output, "perf-app-open.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
  }
  if (values.json) console.log(JSON.stringify(report, null, 2));
  else printTable(rows);
} catch (error) {
  console.error(`perf-app-open: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await fixture?.close();
}
