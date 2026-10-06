#!/usr/bin/env node
import sharp from "sharp";
import { chromium, expect as assertion } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { releaseFixture } from "./release-fixture.mjs";

process.umask(0o077);
const expect = assertion.configure({ timeout: 15000 });

const luminance = rgb => rgb.slice(0, 3).map(value => {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
async function assertFocusContrast(page, control, label) {
  const focus = await control.evaluate(element => {
    const style = getComputedStyle(element), rect = element.getBoundingClientRect();
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
    ctx.fillStyle = style.outlineColor; ctx.fillRect(0, 0, 1, 1);
    const color = [...ctx.getImageData(0, 0, 1, 1).data];
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = style.boxShadow.slice(0, style.boxShadow.indexOf(")") + 1);
    ctx.fillRect(0, 0, 1, 1);
    return { color, shadow: [...ctx.getImageData(0, 0, 1, 1).data], shadowCss: style.boxShadow, width: parseFloat(style.outlineWidth),
      offset: parseFloat(style.outlineOffset), style: style.outlineStyle,
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
  });
  expect(focus.style).toBe("solid");
  expect(focus.width).toBeGreaterThanOrEqual(2);
  const { data, info } = await sharp(await page.screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  expect(focus.shadowCss).toContain("4px");
  expect(focus.shadow[3]).toBe(255);
  const { x, y, width, height } = focus.box, gap = focus.width + focus.offset + 2;
  const pixelAt = (sx, sy) => {
    const pixel = (Math.max(0, Math.min(info.height - 1, Math.round(sy))) * info.width
      + Math.max(0, Math.min(info.width - 1, Math.round(sx)))) * info.channels;
    return [...data.subarray(pixel, pixel + 3)];
  };
  const bands = [[pixelAt(x + width / 2, y - focus.offset - focus.width / 2), focus.color],
    [pixelAt(x + width / 2, y - 1), focus.shadow]];
  for (const [actual, expected] of bands) {
    expect(Math.max(...actual.map((value, index) => Math.abs(value - expected[index])))).toBeLessThanOrEqual(8);
  }
  const samples = [[x + width / 2, y - gap], [x + width / 2, y + height + gap],
    [x - gap, y + height / 2], [x + width + gap, y + height / 2]];
  const ratios = samples.map(([sx, sy]) => {
    const pixel = (Math.max(0, Math.min(info.height - 1, Math.round(sy))) * info.width
      + Math.max(0, Math.min(info.width - 1, Math.round(sx)))) * info.channels;
    const bg = [...data.subarray(pixel, pixel + 3)];
    return Math.max(...[focus.color, focus.shadow].map(color => {
      const fg = color.slice(0, 3).map((value, i) => value * color[3] / 255 + bg[i] * (1 - color[3] / 255));
      const a = luminance(fg), b = luminance(bg);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }));
  });
  console.log("FOCUS", label, JSON.stringify({ outline: focus.color, shadow: focus.shadow, ratios }));
  expect(Math.min(...ratios)).toBeGreaterThanOrEqual(3);
}

const fixture = await releaseFixture();
const output = process.env.MSO_SCREENSHOT_DIR;
if (output) await mkdir(output, { recursive: true, mode: 0o700 });
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }]) {
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({ viewport, hasTouch: true, reducedMotion: "reduce", colorScheme: theme });
      const external = [];
      await context.route("**/*", async route => {
        const url = new URL(route.request().url());
        if (url.origin === fixture.base) await route.continue();
        else { external.push(url.hostname); await route.abort(); }
      });
      await context.addInitScript(({ theme }) => {
        localStorage.setItem("sv:shell", JSON.stringify({ desktop: "macos", mobile: "ios" }));
        localStorage.setItem("mso:onboarding:v1", "done");
        window.__geolocationCalls = 0;
        Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
          getCurrentPosition() { window.__geolocationCalls++; throw new Error("Unexpected location request"); },
        } });
      }, { theme });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(fixture.base);
      await expect(page.locator('#main-content[data-shell="ios"]')).toBeVisible();
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      const search = page.getByRole("combobox", { name: "Spotlight search" });
      await page.locator('[data-slot="ios-search-pill"]').focus();
      await page.keyboard.press("Control+k");
      await expect(search).toBeVisible();
      await search.fill("Lock screen");
      await page.keyboard.press("Enter");
      const face = page.locator('[data-slot="ios-lock"]');
      await expect(face).toBeVisible();
      const unlock = face.getByRole("button", { name: "Unlock", exact: true });
      const light = face.getByRole("button", { name: "Screen light", exact: true });
      await expect(unlock).toBeFocused();
      expect((await unlock.boundingBox()).height).toBeGreaterThanOrEqual(44);
      await expect(face.getByText("Weather unavailable", { exact: true })).toBeVisible();
      await expect(face.locator('[data-slot="ios-lock-camera"]')).toHaveCount(0);
      await assertFocusContrast(page, unlock, `${viewport.width} ${theme} Unlock`);
      await page.keyboard.press("Tab");
      await expect(light).toBeFocused();
      await assertFocusContrast(page, light, `${viewport.width} ${theme} Screen light`);
      await page.keyboard.press("Space");
      await expect(light).toHaveAttribute("aria-pressed", "true");
      await assertFocusContrast(page, light, `${viewport.width} ${theme} Screen light ON`);
      await page.keyboard.press("Space");
      await expect(light).toHaveAttribute("aria-pressed", "false");
      await page.keyboard.press("Tab");
      await expect(unlock).toBeFocused();
      expect(await page.evaluate(() => window.__geolocationCalls)).toBe(0);
      expect(external.filter(host => /open-meteo|bigdatacloud/.test(host))).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      if (output) await page.screenshot({ path: path.join(output, `ios-lock-${viewport.width}-${theme}.png`) });
      await page.keyboard.press("Enter");
      await expect(face).toHaveCount(0);
      await expect(page.locator('[data-slot="ios-search-pill"]')).toBeFocused();
      const tile = page.locator('button[aria-label="Files"]:visible').first();
      await tile.click({ button: "right" });
      const menu = page.locator('[data-slot="ios-quick-actions"]');
      await expect(menu).toBeVisible();
      await expect(menu.getByRole("menuitem", { name: "Hide from Home", exact: true })).toBeVisible();
      await expect(menu.getByRole("menuitem", { name: "Lock screen", exact: true })).toBeVisible();
      await expect(menu.getByText("Require Face ID", { exact: true })).toHaveCount(0);
      await menu.getByRole("menuitem", { name: "Lock screen", exact: true }).click();
      await expect(face).toBeVisible();
      await unlock.click();
      await expect(face).toHaveCount(0);
      await page.setViewportSize({ width: 1024, height: 768 });
      await expect(page.locator('#main-content[data-shell="macos"]')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.keyboard.press("Control+k");
      await expect(search).toBeVisible();
      await search.fill("Lock screen");
      await page.keyboard.press("Enter");
      await expect(page.getByText("Click to unlock", { exact: true })).toBeVisible();
      await expect(page.locator('[data-slot="ios-lock"]')).toHaveCount(0);
      // LockCurtain defers its keyboard listener to avoid consuming the palette Enter.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.keyboard.press("Space");
      await expect(page.getByText("Click to unlock", { exact: true })).toHaveCount(0);
      expect(errors).toEqual([]);
      console.log(`PASS iOS lock ${viewport.width}x${viewport.height} ${theme}: focus, keyboard,44px, privacy, action labels, landscape, no page errors`);
      await context.close();
    }
  }
} finally {
  await browser?.close();
  await fixture.close();
}
