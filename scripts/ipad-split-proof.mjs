#!/usr/bin/env node
// Portable proof for the iPadOS split-view claim: switch to the iOS shell, pick the
// iPad device, then assert the 2-column split plus the floating glass toolbar.
// Runs offline against the repo's fixture backend. No live host is contacted.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SVELTE_TESTS = path.resolve(HERE, "../frontend/svelte/tests");
const { createFixtureBackend, startVitePreview } = await import(path.join(SVELTE_TESTS, "_os-matrix-servers.mjs"));
const { launchChromium } = await import(path.join(SVELTE_TESTS, "_browser-launch.mjs"));

const outputParent = process.env.MSO_VISUAL_DIR;
if (outputParent) mkdirSync(outputParent, { recursive: true });
// Keep reports and screenshots in a fresh private directory for each run.
const OUT = mkdtempSync(path.join(outputParent || tmpdir(), "ipad-split-"));
console.log(`Visual QA artifacts: ${OUT}`);

const { server: backend, state } = createFixtureBackend();
await new Promise((r) => backend.listen(0, "127.0.0.1", r));
state.role = "owner";
const vite = await startVitePreview(`http://127.0.0.1:${backend.address().port}`);
const browser = await launchChromium();
const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, colorScheme: "dark" });
const page = await ctx.newPage();
const report = {};

try {
  await page.goto(vite.origin, { waitUntil: "domcontentloaded" });
  await page.locator("[data-monitor-state='ready']").waitFor({ state: "attached", timeout: 20_000 });
  await page.locator('select[aria-label="Shell chrome"]').first().selectOption("ios");
  await page.locator('.workspace[data-chrome="ios"]').waitFor({ state: "visible", timeout: 8_000 });
  await page.waitForTimeout(600);

  const ipad = page.locator('[aria-label="iPad (iPadOS)"]').first();
  report.ipadControlFound = (await ipad.count()) > 0;
  if (report.ipadControlFound) {
    await ipad.click({ force: true });
    await page.waitForTimeout(900);
  }

  const backHome = page.getByRole("button", { name: /back to home|home/i }).first();
  if (await backHome.count()) {
    await backHome.click({ force: true }).catch(() => {});
    await page.waitForTimeout(600);
  }

  report.measured = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const box = (s) => { const e = q(s); if (!e) return null; const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) }; };
    const stage = q(".ios-home-stage");
    const split = q('[data-ios-split="settings-files"]');
    const bar = q(".mobile-app-bar");
    const bs = bar ? getComputedStyle(bar) : null;
    return {
      deviceForm: q("[data-device-form]")?.getAttribute("data-device-form") ?? null,
      stageHidden: stage?.hasAttribute("hidden") ?? null,
      stageBox: box(".ios-home-stage"),
      splitBox: box('[data-ios-split="settings-files"]'),
      splitColumns: split ? getComputedStyle(split).gridTemplateColumns : null,
      settingsPane: box(".ios-pad-pane.is-settings"),
      filesPane: box(".ios-pad-pane.is-files"),
      settingsVariant: q("[data-settings-variant]")?.getAttribute("data-settings-variant") ?? null,
      filesVariant: q("[data-files-variant]")?.getAttribute("data-files-variant") ?? null,
      appBarBox: box(".mobile-app-bar"),
      appBarHeight: bs?.height ?? null,
      appBarRadius: bs?.borderRadius ?? null,
      appBarTop: bs?.top ?? null,
      appBarBlur: bs?.backdropFilter ?? null,
    };
  });

  await page.screenshot({ path: `${OUT}/ipad-split-real.png` });
} finally {
  await ctx.close();
  await browser.close();
  vite.proc?.kill();
  backend.closeAllConnections?.();
  await new Promise((r) => backend.close(r));
}

writeFileSync(path.join(OUT, "ipad-proof.json"), JSON.stringify(report, null, 2), { flag: "wx", mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
