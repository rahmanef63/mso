// Workstream B verification: iPhone Home / Files / Monitor at 320 and 390.
// Uses the existing matrix fixture backend + vite preview + rust host.
// Run: node tests/os-iphone-b-verify.mjs
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { once } from "node:events";
import path from "node:path";
import { launchChromium } from "./_browser-launch.mjs";
import {
  createFixtureBackend,
  ensureBuild,
  startVitePreview,
  waitWorkspaceReady,
} from "./_os-matrix-servers.mjs";

const OUT = process.env.MSO_SCREENSHOT_DIR || "/tmp/opencode/after-b";
const WIDTHS = [
  { width: 320, height: 568, tag: "320x568" },
  { width: 390, height: 844, tag: "390x844" },
];

ensureBuild();
mkdirSync(OUT, { recursive: true });

const { server: backend, state: fixtureState } = createFixtureBackend();
backend.listen(0, "127.0.0.1");
await once(backend, "listening");
const apiOrigin = `http://127.0.0.1:${backend.address().port}`;
const vite = await startVitePreview(apiOrigin);
const browser = await launchChromium();

const results = [];
const failures = [];

function record(name, detail) {
  results.push({ name, ...detail });
  console.log(`PASS ${name} :: ${detail.note ?? ""}`);
}

async function check(name, fn) {
  try {
    await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failures.push({ check: name, error: message });
    console.log(`FAIL ${name} :: ${message}`);
  }
}

async function bootIos(page) {
  await page.goto(vite.origin, { waitUntil: "domcontentloaded" });
  await waitWorkspaceReady(page);
  const select = page.locator('select[aria-label="Shell chrome"]').first();
  await select.waitFor({ state: "visible", timeout: 8_000 });
  await select.selectOption("ios");
  await page.locator('.workspace[data-chrome="ios"]').waitFor({ state: "visible", timeout: 8_000 });
}

async function noOverflow(page, label) {
  const m = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
    bw: document.body.scrollWidth,
  }));
  assert.ok(m.sw <= m.iw, `${label}: document.scrollWidth ${m.sw} > innerWidth ${m.iw}`);
  assert.ok(m.bw <= m.iw, `${label}: body.scrollWidth ${m.bw} > innerWidth ${m.iw}`);
  return { ...m, note: `doc ${m.sw}/${m.iw}` };
}

async function minTargets(page, selector, label, min = 44) {
  const boxes = await page.evaluate((sel) => [...document.querySelectorAll(sel)]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
    })
    .map((el) => {
      const r = el.getBoundingClientRect();
      const name = el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 30) || el.className;
      return { name, w: Math.round(r.width), h: Math.round(r.height) };
    }), selector);
  assert.ok(boxes.length > 0, `${label}: no visible targets for ${selector}`);
  const small = boxes.filter((b) => b.h < min || b.w < min);
  assert.equal(small.length, 0, `${label}: ${small.length} target(s) under ${min}px: ${JSON.stringify(small.slice(0, 4))}`);
  return { count: boxes.length, note: `${boxes.length} targets >= ${min}px` };
}

async function focusVisible(page, selector, label) {
  const target = page.locator(selector).first();
  await target.waitFor({ state: "visible", timeout: 5_000 });
  await target.focus();
  const style = await target.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, boxShadow: cs.boxShadow };
  });
  const hasOutline = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 1;
  const hasShadow = style.boxShadow !== "none";
  assert.ok(hasOutline || hasShadow, `${label}: no visible focus ring (${JSON.stringify(style)})`);
  return { ...style, note: `outline ${style.outlineWidth} ${style.outlineStyle}` };
}

fixtureState.role = "owner";
fixtureState.prefs = { tweaks: {}, quicklinks: [], updates: { auto: true, channel: "stable" }, updatedAt: Date.now() };

for (const vp of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();

  // ---- 1. Home screen
  await check(`home-overflow-${vp.tag}`, async () => {
    await bootIos(page);
    const info = await noOverflow(page, `home ${vp.tag}`);
    record(`home-overflow-${vp.tag}`, info);
  });

  await check(`home-primary-grid-${vp.tag}`, async () => {
    const grid = page.locator(".ios-app-grid");
    await grid.waitFor({ state: "visible", timeout: 5_000 });
    const tiles = await grid.locator("> button").count();
    assert.ok(tiles > 0, "primary grid has no tiles");
    assert.ok(tiles <= 8, `primary grid must stay one page (got ${tiles} tiles)`);
    // Everything else is behind the App Library tile.
    const libTile = grid.getByRole("button", { name: /App Library/ });
    await libTile.waitFor({ state: "visible", timeout: 5_000 });
    const label = await libTile.getAttribute("aria-label");
    assert.match(label ?? "", /App Library, \d+ more apps/, `App Library tile aria-label was "${label}"`);
    record(`home-primary-grid-${vp.tag}`, { note: `${tiles} primary tiles + App Library entry, "${label}"` });
  });

  await check(`home-targets-${vp.tag}`, async () => {
    const info = await minTargets(page, ".ios-app-grid > button", `home tiles ${vp.tag}`);
    record(`home-targets-${vp.tag}`, info);
  });

  await check(`home-focus-${vp.tag}`, async () => {
    const info = await focusVisible(page, ".ios-app-grid > button", `home tile ${vp.tag}`);
    record(`home-focus-${vp.tag}`, info);
  });

  await check(`home-library-sheet-${vp.tag}`, async () => {
    await page.locator(".ios-app-grid").getByRole("button", { name: /App Library/ }).click();
    const sheet = page.locator("#ios-app-library");
    await sheet.waitFor({ state: "visible", timeout: 5_000 });
    const apps = await sheet.locator(".ios-library-tile").count();
    assert.ok(apps > 0, "App Library lists no apps");
    await noOverflow(page, `library ${vp.tag}`);
    await page.screenshot({ path: path.join(OUT, `home-library-${vp.tag}.png`) });
    await sheet.getByRole("button", { name: "Done" }).click();
    await sheet.waitFor({ state: "hidden", timeout: 5_000 });
    record(`home-library-sheet-${vp.tag}`, { note: `${apps} apps in sheet` });
  });

  await page.screenshot({ path: path.join(OUT, `home-${vp.tag}.png`) });

  await check(`monitor-collapsed-${vp.tag}`, async () => {
    const widget = page.locator(".monitor-widget");
    await widget.waitFor({ state: "visible", timeout: 8_000 });
    assert.equal(await widget.getAttribute("data-monitor-expanded"), "false");
    // Collapsed strip still exposes live numbers.
    const value = (await page.locator(".monitor-widget .kpi-value").first().textContent())?.trim();
    assert.ok(value && value.length > 0, "collapsed monitor has no KPI value");
    const btn = widget.getByRole("button", { name: "Details" });
    await btn.waitFor({ state: "visible", timeout: 5_000 });
    record(`monitor-collapsed-${vp.tag}`, { note: `collapsed strip shows "${value}", Details button present` });
  });

  await check(`monitor-expand-${vp.tag}`, async () => {
    const widget = page.locator(".monitor-widget");
    await widget.getByRole("button", { name: "Details" }).click();
    await page.waitForFunction(
      () => document.querySelector(".monitor-widget")?.getAttribute("data-monitor-expanded") === "true",
      undefined,
      { timeout: 5_000 },
    );
    // Expanded restores charts + interval controls (every metric reachable).
    await page.locator(".monitor-widget .chart-grid").waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(".monitor-widget .interval-group").waitFor({ state: "visible", timeout: 5_000 });
    const bars = await page.locator(".monitor-widget .bar").count();
    assert.equal(bars, 3, `expanded monitor should show 3 progress bars, got ${bars}`);
    await noOverflow(page, `monitor expanded ${vp.tag}`);
    await page.screenshot({ path: path.join(OUT, `monitor-expanded-${vp.tag}.png`) });
    await widget.getByRole("button", { name: "Collapse" }).click();
    await page.waitForFunction(
      () => document.querySelector(".monitor-widget")?.getAttribute("data-monitor-expanded") === "false",
      undefined,
      { timeout: 5_000 },
    );
    record(`monitor-expand-${vp.tag}`, { note: "expanded shows charts + interval group + 3 bars, collapses back" });
  });

  // ---- 2. Files journey: open Files, open a folder, back
  await check(`files-journey-${vp.tag}`, async () => {
    await page.locator(".ios-app-grid").getByRole("button", { name: "Open Files" }).click();
    await page.locator("[data-files-variant]").waitFor({ state: "visible", timeout: 10_000 });
    await page.locator('[data-files-state="ready"]').waitFor({ state: "visible", timeout: 10_000 });
    await noOverflow(page, `files root ${vp.tag}`);
    await page.screenshot({ path: path.join(OUT, `files-${vp.tag}.png`) });

    await page.locator('button[data-entry-open="projects"]').click();
    await page.locator("[data-mobile-nav='ios']").waitFor({ state: "visible", timeout: 5_000 });
    await noOverflow(page, `files subfolder ${vp.tag}`);
    await page.screenshot({ path: path.join(OUT, `files-folder-${vp.tag}.png`) });

    await page.locator(".mobile-app-bar .mab-back").click();
    await page.locator('button[data-entry-open="projects"]').waitFor({ state: "visible", timeout: 8_000 });
    await noOverflow(page, `files back ${vp.tag}`);
    record(`files-journey-${vp.tag}`, { note: "Home -> Files -> projects -> back, no overflow at each step" });
  });

  await check(`files-single-search-${vp.tag}`, async () => {
    const searchable = await page.evaluate(() => {
      const root = document.querySelector("[data-files-variant]");
      return [...root.querySelectorAll('input[type="search"]')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden";
        })
        .map((el) => el.getAttribute("aria-label") || el.placeholder || "(unlabelled)");
    });
    assert.equal(searchable.length, 1, `expected exactly 1 search input, got ${searchable.length}: ${JSON.stringify(searchable)}`);
    record(`files-single-search-${vp.tag}`, { note: `one search: "${searchable[0]}"` });
  });

  await check(`files-search-works-${vp.tag}`, async () => {
    const input = page.locator("[data-files-variant] .ops-search input[type='search']").first();
    await input.fill("notes");
    await page.locator("[data-files-variant] .ops-search button[type='submit']").click();
    await page.locator("[data-files-variant] [data-files-ops]").getByText(/No matching|match/).first()
      .waitFor({ state: "visible", timeout: 8_000 });
    record(`files-search-works-${vp.tag}`, { note: "recursive search submitted, result region rendered" });
  });

  await check(`files-copy-move-${vp.tag}`, async () => {
    const toggle = page.locator("[data-files-variant] .ops-search").getByRole("button", { name: "Copy / Move" });
    await toggle.click();
    const panel = page.locator("[data-files-variant] .transfer-panel");
    await panel.waitFor({ state: "visible", timeout: 5_000 });
    await panel.getByLabel("Mode").waitFor({ state: "visible", timeout: 5_000 });
    await noOverflow(page, `copy/move open ${vp.tag}`);
    await page.screenshot({ path: path.join(OUT, `files-copy-move-${vp.tag}.png`) });
    await panel.getByRole("button", { name: "Close" }).click();
    await panel.waitFor({ state: "hidden", timeout: 5_000 });
    record(`files-copy-move-${vp.tag}`, { note: "Copy / Move fixture panel opens with Source/Destination/Mode" });
  });

  await check(`files-dock-no-cover-${vp.tag}`, async () => {
    const res = await page.evaluate(async () => {
      const rows = [...document.querySelectorAll("[data-entry-open]")];
      const last = rows[rows.length - 1];
      if (!last) return { error: "no rows" };
      last.scrollIntoView({ block: "end" });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      // The iOS app sheet has no dock; check against the home indicator footer
      // and any fixed/sticky chrome at the bottom of the phone frame.
      const chrome = [...document.querySelectorAll(".mobile-app-bar, .ios-tabbar, .app-dock, .ios-home-indicator")]
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.height > 0 && r.bottom > window.innerHeight - 140)
        .sort((a, b) => b.top - a.top)[0] ?? null;
      const rowRect = last.getBoundingClientRect();
      return {
        row: { top: Math.round(rowRect.top), bottom: Math.round(rowRect.bottom) },
        chrome: chrome ? { top: Math.round(chrome.top), bottom: Math.round(chrome.bottom) } : null,
        viewport: window.innerHeight,
        covered: chrome ? rowRect.bottom > chrome.top : false,
      };
    });
    assert.ok(!res.error, res.error);
    assert.equal(res.covered, false, `last row ${JSON.stringify(res.row)} is covered by bottom chrome ${JSON.stringify(res.chrome)}`);
    record(`files-dock-no-cover-${vp.tag}`, { note: `last row bottom ${res.row.bottom} clears chrome top ${res.chrome?.top ?? "n/a"}` });
  });

  await check(`files-targets-${vp.tag}`, async () => {
    const info = await minTargets(page, "[data-files-variant] .ops-search button", `files search buttons ${vp.tag}`);
    record(`files-targets-${vp.tag}`, info);
  });

  await check(`files-focus-${vp.tag}`, async () => {
    const info = await focusVisible(page, "[data-files-variant] .ops-search input[type='search']", `files search field ${vp.tag}`);
    record(`files-focus-${vp.tag}`, info);
  });

  await ctx.close();
}

// ---- 3. Dark theme sanity at 390
await check("dark-theme-390", async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  const page = await ctx.newPage();
  await bootIos(page);
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await noOverflow(page, "dark home 390");
  await page.screenshot({ path: path.join(OUT, "home-dark-390x844.png") });
  await page.locator(".ios-app-grid").getByRole("button", { name: "Open Files" }).click();
  await page.locator("[data-files-state='ready']").waitFor({ state: "visible", timeout: 10_000 });
  await noOverflow(page, "dark files 390");
  await page.screenshot({ path: path.join(OUT, "files-dark-390x844.png") });
  record("dark-theme-390", { note: "dark theme home + files render without overflow" });
  await ctx.close();
});

await browser.close();
vite.proc?.kill("SIGTERM");
backend.close();

console.log("\n=== SUMMARY ===");
console.log(JSON.stringify({ out: OUT, passed: results.length, failed: failures.length, failures }, null, 2));
process.exit(failures.length > 0 ? 1 : 0);
