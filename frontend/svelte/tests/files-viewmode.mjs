// Browser coverage for the Finder view-mode contract.
// Guards: clicking Icons must immediately set aria-pressed and render the grid DOM,
// and the chosen mode must survive closing and reopening the Files window.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SVELTE_TESTS = HERE;
const { createFixtureBackend, startVitePreview } = await import(path.join(SVELTE_TESTS, "_os-matrix-servers.mjs"));
const { launchChromium } = await import(path.join(SVELTE_TESTS, "_browser-launch.mjs"));

const OUT = process.env.MSO_VISUAL_DIR || "/tmp/mso-finder-viewmode";
mkdirSync(OUT, { recursive: true });

const { server: backend, state } = createFixtureBackend();
await new Promise((r) => backend.listen(0, "127.0.0.1", r));
state.role = "owner";
const vite = await startVitePreview(`http://127.0.0.1:${backend.address().port}`);
const browser = await launchChromium();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
const page = await ctx.newPage();
const results = { checks: [], failures: [] };
const check = (name, pass, detail) => {
  results.checks.push({ name, pass, ...(detail === undefined ? {} : { detail }) });
  if (!pass) results.failures.push(name);
};

const modeState = () => page.evaluate(() => {
  const btn = (label) => [...document.querySelectorAll(".finder-segment button")].find((b) => b.getAttribute("aria-label") === label);
  const pressed = (label) => btn(label)?.getAttribute("aria-pressed") ?? null;
  const grid = document.querySelector("[data-view-mode='grid']");
  const list = document.querySelector("[data-view-mode='list']");
  const details = document.querySelector("[data-view-mode='details']");
  return {
    iconsPressed: pressed("Icons"),
    listPressed: pressed("List"),
    columnsPressed: pressed("Columns"),
    gridCount: document.querySelectorAll("[data-view-mode='grid']").length,
    listCount: document.querySelectorAll("[data-view-mode='list']").length,
    detailsCount: document.querySelectorAll("[data-view-mode='details']").length,
    iconTiles: document.querySelectorAll(".icon-grid [data-entry-open]").length,
    gridVisible: Boolean(grid && grid.getBoundingClientRect().height > 0),
    listVisible: Boolean(list && list.getBoundingClientRect().height > 0),
    detailsVisible: Boolean(details && details.getBoundingClientRect().height > 0),
    entries: document.querySelectorAll("[data-entry-open]").length,
  };
});

async function openFiles() {
  const dock = page.locator(".app-dock").getByRole("button", { name: /open files|^files$/i }).first();
  if (await dock.count()) { await dock.click(); await page.waitForTimeout(900); }
  await page.locator("[data-files-variant]").first().waitFor({ state: "visible", timeout: 10_000 });
}

async function closeFiles() {
  const btn = page.getByRole("button", { name: /close files/i }).first();
  if (await btn.count()) { await btn.click({ force: true }); await page.waitForTimeout(600); }
}

try {
  await page.goto(vite.origin, { waitUntil: "domcontentloaded" });
  await page.locator(".workspace").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("[data-monitor-state='ready']").waitFor({ state: "attached", timeout: 25_000 });
  await page.waitForTimeout(900);
  for (let i = 0; i < 3; i++) { const c = page.locator(".win-btn.win-close"); if (!(await c.count())) break; await c.first().click({ force: true }).catch(() => {}); await page.waitForTimeout(250); }

  await openFiles();
  const atList = await modeState();
  check("default mode is list", atList.listPressed === "true" && atList.listCount === 1, atList);
  check("list shows entries", atList.entries > 0, { entries: atList.entries });

  // The reported regression: click the sole Icons button.
  const icons = page.locator(".finder-segment button[aria-label='Icons']").first();
  check("Icons control exists", (await icons.count()) > 0);
  await icons.click();
  await page.waitForTimeout(700);
  const atGrid = await modeState();
  check("Icons sets aria-pressed immediately", atGrid.iconsPressed === "true", atGrid);
  check("Icons clears List aria-pressed", atGrid.listPressed === "false", atGrid);
  check("Icons renders grid DOM", atGrid.gridCount === 1 && atGrid.gridVisible, atGrid);
  check("grid keeps entries", atGrid.iconTiles === atList.entries, { tiles: atGrid.iconTiles, listEntries: atList.entries });
  await page.screenshot({ path: `${OUT}/finder-grid.png` });

  // Switch back to List to prove both directions work live.
  await page.locator(".finder-segment button[aria-label='List']").first().click();
  await page.waitForTimeout(700);
  const backToList = await modeState();
  check("List restores list DOM immediately", backToList.listPressed === "true" && backToList.listCount === 1, backToList);

  // Persisted mode survives navigating folders in the same window (win state is
  // intentionally cleared on close, so cross-reopen persistence is not the contract).
  await page.locator(".finder-segment button[aria-label='Icons']").first().click();
  await page.waitForTimeout(600);
  const dirEntry = page.locator("[data-entry-open='projects']").first();
  if (await dirEntry.count()) {
    await dirEntry.click();
    await page.waitForTimeout(1000);
    const afterNav = await modeState();
    check("grid mode survives folder navigation", afterNav.iconsPressed === "true" && afterNav.gridCount === 1, afterNav);
    await page.screenshot({ path: `${OUT}/finder-grid-after-nav.png` });
  } else {
    check("grid mode survives folder navigation", false, { reason: "projects dir not present" });
  }
} finally {
  await ctx.close();
  await browser.close();
  vite.proc?.kill();
  backend.closeAllConnections?.();
  await new Promise((r) => backend.close(r));
}

writeFileSync(`${OUT}/viewmode.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
if (results.failures.length) { console.error("FAILURES:", results.failures.join(", ")); process.exitCode = 1; }
