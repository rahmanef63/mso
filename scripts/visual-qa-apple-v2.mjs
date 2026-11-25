#!/usr/bin/env node
// Visual QA harness for the apple-os-shell 2.0 integration branch.
// Renders the five shells with the fixture backend, captures screenshots, and
// measures the specific 1:1 claims from the plan. Read-only: no writes outside
// the screenshot dir, no network beyond loopback.
import { mkdirSync, writeFileSync } from "node:fs";
import { createFixtureBackend, startVitePreview } from "../frontend/svelte/tests/_os-matrix-servers.mjs";
import { launchChromium } from "../frontend/svelte/tests/_browser-launch.mjs";

const OUT = process.env.MSO_VISUAL_DIR || "/tmp/mso-apple-v2-visual";
mkdirSync(OUT, { recursive: true });

const SHOTS = [
  { name: "macos-light", shell: "macos", theme: "light", viewport: { width: 1440, height: 900 } },
  { name: "macos-dark", shell: "macos", theme: "dark", viewport: { width: 1440, height: 900 } },
  { name: "ios-390", shell: "ios", theme: "dark", viewport: { width: 390, height: 844 } },
  { name: "ios-320", shell: "ios", theme: "dark", viewport: { width: 320, height: 568 } },
  { name: "ipad-split", shell: "ios", device: "ipad", theme: "dark", viewport: { width: 1024, height: 768 } },
];

const { server: backend, state } = createFixtureBackend();
await new Promise((r) => backend.listen(0, "127.0.0.1", r));
const backendPort = backend.address().port;
const backendOrigin = `http://127.0.0.1:${backendPort}`;
state.role = "owner";

const vite = await startVitePreview(backendOrigin);
const browser = await launchChromium();
const report = {};

try {
  for (const shot of SHOTS) {
    const ctx = await browser.newContext({ viewport: shot.viewport, colorScheme: shot.theme });
    const page = await ctx.newPage();
    await page.goto(vite.origin, { waitUntil: "domcontentloaded" });
    await page.locator(".workspace").waitFor({ state: "visible", timeout: 15_000 });
    await page.locator("[data-monitor-state='ready']").waitFor({ state: "attached", timeout: 20_000 });

    if (shot.device === "ipad") {
      const ipad = page.getByRole("button", { name: /iPad/i }).first();
      if (await ipad.count()) {
        await ipad.click();
        await page.waitForTimeout(600);
      }
    }

    const measured = await page.evaluate(() => {
      const pick = (sel) => document.querySelector(sel);
      const box = (sel) => {
        const el = pick(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
      };
      const css = (sel, prop) => {
        const el = pick(sel);
        if (!el) return null;
        const s = getComputedStyle(el);
        return prop.startsWith("--") ? s.getPropertyValue(prop).trim() || null : s[prop];
      };
      return {
        chrome: pick(".workspace")?.getAttribute("data-chrome") ?? null,
        workspaceFilter: css(".workspace", "filter"),
        wallpaperLayerFilter: css(".os-wallpaper-layer", "filter"),
        tint: css(".workspace", "--tint")?.trim() ?? null,
        boldText: pick(".workspace")?.getAttribute("data-bold-text") ?? null,
        monitor: box(".monitor-widget"),
        monitorCompact: Boolean(pick(".monitor-widget.is-compact")),
        chartGrid: Boolean(pick(".chart-grid")),
        shellChromeSelect: Boolean(pick('select[aria-label="Shell chrome"]')),
        signOut: Boolean([...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Sign out")),
        batteryText: pick("[data-battery-pct]")?.textContent?.trim() ?? null,
        menuBarFormBoxes: [...document.querySelectorAll(".menu-bar select, .menu-bar input")].filter((el) => {
          const s = getComputedStyle(el);
          return s.borderStyle !== "none" && parseFloat(s.borderWidth) > 0 && s.backgroundColor !== "rgba(0, 0, 0, 0)";
        }).length,
        ipadToolbar: box(".ipad-toolbar, [data-ipad-toolbar]"),
        settingsVariant: pick("[data-settings-variant]")?.getAttribute("data-settings-variant") ?? null,
        filesVariant: pick("[data-files-variant]")?.getAttribute("data-files-variant") ?? null,
        springboardGrid: box(".ios-app-grid"),
        dock: box(".ios-dock, .app-dock"),
        lastIconBottom: (() => {
          const icons = [...document.querySelectorAll(".ios-app-grid button")];
          if (!icons.length) return null;
          return Math.round(Math.max(...icons.map((el) => el.getBoundingClientRect().bottom)));
        })(),
        docHeight: document.documentElement.scrollHeight,
        viewportH: window.innerHeight,
      };
    });

    await page.screenshot({ path: `${OUT}/${shot.name}.png` });
    report[shot.name] = measured;
    await ctx.close();
  }
} finally {
  await browser.close();
  vite.proc?.kill();
  backend.closeAllConnections?.();
  await new Promise((r) => backend.close(r));
}

writeFileSync(`${OUT}/measurements.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
