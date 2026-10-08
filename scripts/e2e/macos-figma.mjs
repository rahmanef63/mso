#!/usr/bin/env node
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { desktopMenu, menuEvidence, reducedMenuEvidence } from "./macos-menu-evidence.mjs";
import { releaseFixture } from "./release-fixture.mjs";

process.umask(0o077);
const dir = path.resolve(process.env.MSO_SCREENSHOT_DIR || "zz-macos-qa");
await mkdir(dir, { recursive: true });
const fixture = await releaseFixture();
const browser = await chromium.launch({ headless: true });
const results = [];
const screenshots = [];
let page;
async function shot(name) {
  const file = path.join(dir, name + ".png");
  await page.screenshot({ path: file });
  screenshots.push(file);
}
async function check(name, run) {
  try { await run(); results.push({ name, passed: true }); console.log("PASS", name); }
  catch (e) { results.push({ name, passed: false, error: e.message }); console.log("FAIL", name, e.message); await page.keyboard.press("Escape"); await page.keyboard.press("Escape"); }
}
try {
  const context = await browser.newContext({ viewport: { width: 1512, height: 982 } });
  await context.addInitScript(() => {
    localStorage.setItem("mso:onboarding:v1", "done");
    localStorage.setItem("sv:shell", JSON.stringify({ desktop: "macos", mobile: "ios" }));
  });
  page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(fixture.base);
  await expect(page.locator('#main-content[data-shell="macos"]')).toBeVisible();
  const wallpaper = page.locator("div.wp-aurora.absolute.inset-0");
  const wallpaperUrl = () => wallpaper.evaluate(el => getComputedStyle(el).backgroundImage.split('"')[1]);
  if ((await wallpaperUrl()).includes("aurora-dark")) await page.getByRole("button", { name: "Toggle theme", exact: true }).click();
  await expect.poll(async () => (await wallpaperUrl()).includes("aurora.webp")).toBe(true);
  await shot("light-desktop");
  await check("34px menu bar and canonical WebP wallpaper", async () => {
    expect((await page.locator(".macos-menubar").boundingBox()).height).toBe(34);
    expect(await wallpaperUrl()).toContain("/wallpapers/aurora.webp");
    const response = await page.request.get(await wallpaperUrl());
    expect(response.ok()).toBe(true);
    const bytes = (await response.body()).length;
    expect(bytes).toBeLessThan(100_000);
    results.push({ name: "light wallpaper delivered bytes", bytes });
  });
  await page.getByRole("link", { name: /^(System )?Settings(?: \(running\))?$/ }).first().click();
  const win = page.locator('[data-window][data-app="os-settings"]').last();
  await expect(win).toBeVisible();
  await check("52px titlebar, 16px window radius, 24px control targets", async () => {
    await expect.poll(async () => (await win.locator(".macos-titlebar").boundingBox()).height).toBe(52);
    expect(await win.evaluate(el => getComputedStyle(el).borderRadius)).toBe("16px");
    for (const b of await win.locator(".macos-light-button").all()) expect((await b.boundingBox()).width).toBe(24);
    expect((await win.locator(".macos-light").first().boundingBox()).width).toBe(14);
  });
  await expect(page.getByText(/Loading settings/)).toHaveCount(0);
  await shot("light-window");

  await menuEvidence({ page, check, shot }, "light");
  await check("menu opens by keyboard, arrow navigation, Escape restores trigger", async () => {
    const trigger = page.locator(".macos-menubar").getByRole("button", { name: "View", exact: true });
    await trigger.focus(); await page.keyboard.press("Enter");
    await expect(page.locator(".macos-menu")).toBeVisible();
    await page.keyboard.press("ArrowDown"); await shot("light-menu");
    await page.keyboard.press("Escape"); await expect(page.locator(".macos-menu")).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
  await check("maximize, restore and window drag", async () => {
    const before = await win.boundingBox();
    await win.getByRole("button", { name: "Maximize window" }).click();
    await expect.poll(async () => (await win.boundingBox()).width).toBe(1496);
    await win.getByRole("button", { name: "Maximize window" }).click();
    await expect.poll(async () => (await win.boundingBox()).width).toBe(before.width);
    const bar = await win.locator(".macos-titlebar").boundingBox();
    await page.mouse.move(bar.x + bar.width / 2, bar.y + 25); await page.mouse.down();
    await page.mouse.move(bar.x + bar.width / 2 + 70, bar.y + 65, { steps: 8 }); await page.mouse.up();
    await expect.poll(async () => (await win.boundingBox()).x).toBeGreaterThan(before.x);
  });
  await check("resize keeps titlebar reachable", async () => {
    const before = await win.boundingBox();
    const handle = await win.locator(".cursor-nwse-resize").boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
    await page.mouse.move(before.x + before.width + 45, before.y + before.height + 35, { steps: 8 }); await page.mouse.up();
    await expect.poll(async () => (await win.boundingBox()).width).toBeGreaterThan(before.width);
    expect((await win.boundingBox()).y).toBeGreaterThanOrEqual(34);
  });
  await check("minimize and repeated dock activation restore a single window", async () => {
    await win.getByRole("button", { name: "Minimize window" }).click(); await expect(win).toHaveCount(0);
    const dock = page.locator(".macos-dock").getByRole("link", { name: /Settings/ }).first();
    await dock.click(); await expect(win).toBeVisible();
    await expect.poll(() => win.evaluate(el => getComputedStyle(el).animationName)).toContain("winOpen");
    await dock.click();
    await expect(page.locator('[data-window][data-app="os-settings"]')).toHaveCount(1);
    await dock.focus(); await expect(dock).toBeFocused();
  });
  await page.getByRole("button", { name: "Toggle theme", exact: true }).click();
  await expect.poll(async () => (await wallpaperUrl()).includes("aurora-dark.webp")).toBe(true);
  await expect(page.getByText(/Loading settings/)).toHaveCount(0);
  await expect.poll(() => win.evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(30, 30, 30)");
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await shot("dark-window");
  await check("settled dark settings content contrast", async () => {
    const axe = await new AxeBuilder({ page }).include('[data-window][data-app="os-settings"]').withRules(["color-contrast"]).analyze();
    expect(axe.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) }))).toEqual([]);
  });
  await menuEvidence({ page, check, shot }, "dark");
  await check("dark wallpaper uses canonical WebP asset", async () => {
    const response = await page.request.get(await wallpaperUrl());
    const bytes = (await response.body()).length; expect(response.ok()).toBe(true); expect(bytes).toBeLessThan(100_000);
    results.push({ name: "dark wallpaper delivered bytes", bytes });
  });
  await check("dark chrome WCAG A/AA accessibility", async () => {
    const axe = await new AxeBuilder({ page }).include(".macos-menubar").include(".macos-titlebar").include(".macos-dock").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(axe.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
  });
  await page.locator(".macos-menubar").getByRole("button", { name: "Window", exact: true }).click();
  await shot("dark-menu"); await page.keyboard.press("Escape");
  await check("close removes window and Escape dismisses Spotlight", async () => {
    await win.getByRole("button", { name: "Close window" }).click(); await expect(win).toHaveCount(0);
    await page.getByRole("button", { name: "Spotlight (⌘K)", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Spotlight search" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Spotlight search" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("combobox", { name: "Spotlight search" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Spotlight (⌘K)", exact: true })).toBeFocused();
  });
  for (const width of [844, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 700 });
    await check(width + "px responsive fallback", async () => {
      await expect(page.locator("#main-content")).toHaveAttribute("data-shell", width < 768 ? "ios" : "macos");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width < 768) await expect(page.getByRole("button", { name: "Go to page 2", exact: true })).toBeVisible();
      if (width >= 768) {
        for (const name of ["Help", "MSO"]) {
          const trigger = page.locator(".macos-menubar").getByRole("button", { name, exact: true });
          await trigger.focus(); await trigger.scrollIntoViewIfNeeded();
          await expect.poll(async () => { const b = await trigger.boundingBox(); return b.x >= 0 && b.x + b.width <= width; }).toBe(true);
        }
        await page.mouse.move(width / 2, 300);
        const links = page.locator(".macos-dock").getByRole("link");
        for (const link of [links.first(), links.last()]) {
          await link.focus(); await link.scrollIntoViewIfNeeded();
          await expect.poll(async () => { const b = await link.boundingBox(); return b.x >= 0 && b.x + b.width <= width; }).toBe(true);
        }
      }
    });
    await shot("responsive-" + width);
  }
  await page.setViewportSize({ width: 844, height: 390 });
  await check("short desktop keeps compact titlebar and 24px window targets", async () => {
    await expect(page.locator(".macos-menubar")).toBeVisible();
    await page.locator(".macos-dock").getByRole("link", { name: /Settings/ }).first().click();
    await expect.poll(async () => (await win.locator(".macos-titlebar").boundingBox()).height).toBe(32);
    for (const b of await win.locator(".macos-light-button").all()) expect((await b.boundingBox()).height).toBe(24);
    await shot("short-desktop-window");
    await win.getByRole("button", { name: "Close window" }).click(); await expect(win).toHaveCount(0);
  });
  await check("coarse-pointer desktop preserves 44px context targets", async () => {
    const touch = await browser.newContext({ viewport: { width: 1512, height: 982 }, hasTouch: true });
    await touch.addInitScript(() => localStorage.setItem("mso:onboarding:v1", "done"));
    const p = await touch.newPage();
    await p.goto(fixture.base);
    await expect(p.locator('#main-content[data-shell="macos"]')).toBeVisible();
    await expect(p.locator(".macos-menubar")).toBeVisible();
    await p.mouse.click(40, 700, { button: "right" });
    const menu = p.locator('.macos-menu[role="menu"]');
    await expect(menu).toBeVisible();
    await expect.poll(async () => (await menu.boundingBox()).width).toBe(244);
    for (const item of await menu.getByRole("menuitem").all()) expect((await item.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await touch.close();
  });
  await page.setViewportSize({ width: 1512, height: 982 });
  await expect(page.locator(".macos-menubar")).toBeVisible();
  await check("Windows and macOS switching preserves scoped chrome", async () => {
    const macMenu = await desktopMenu(page, "View as Windows");
    await macMenu.getByRole("menuitem", { name: "View as Windows", exact: true }).click();
    await expect(page.locator("#main-content")).toHaveAttribute("data-shell", "windows");
    await expect(page.locator(".macos-menubar")).toHaveCount(0);
    const windowsMenu = await desktopMenu(page, "View as macOS");
    await expect(windowsMenu).not.toHaveClass(/macos-menu/);
    await windowsMenu.getByRole("menuitem", { name: "View as macOS", exact: true }).click();
    await expect(page.locator(".macos-menubar")).toBeVisible();
    await menuEvidence({ page, check, shot }, "returned-macos");
  });
  await reducedMenuEvidence({ browser, base: fixture.base, check });
  await check("no uncaught browser errors", async () => expect(errors).toEqual([]));
} finally {
  await writeFile(path.join(dir, "report.json"), JSON.stringify({ results, screenshots }, null, 2));
  await browser.close(); await fixture.close();
}
if (results.some(r => r.passed === false)) process.exitCode = 1;
