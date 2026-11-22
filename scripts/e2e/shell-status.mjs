#!/usr/bin/env node
// Public synthetic proof that connection mode lives in each shell's native chrome.
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { releaseFixture } from "./release-fixture.mjs";

const fixture = await releaseFixture();
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const cases = [
    { id: "macos", surface: "desktop", viewport: { width: 1363, height: 936 }, placement: "menu-bar" },
    { id: "windows", surface: "desktop", viewport: { width: 1363, height: 936 }, placement: "taskbar" },
    { id: "dashboard", surface: "desktop", viewport: { width: 1363, height: 936 }, placement: "dashboard-header" },
    { id: "ios", surface: "mobile", viewport: { width: 390, height: 844 }, placement: "ios-status-bar" },
    { id: "android", surface: "mobile", viewport: { width: 390, height: 844 }, placement: "android-status-bar" },
  ];
  for (const test of cases) {
    const context = await browser.newContext({ viewport: test.viewport });
    await context.addInitScript(({ id, surface }) => {
      localStorage.setItem("sv:shell", JSON.stringify({
        desktop: surface === "desktop" ? id : "macos",
        mobile: surface === "mobile" ? id : "ios",
      }));
      localStorage.setItem("mso:onboarding:v1", "done");
    }, { id: test.id, surface: test.surface });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(fixture.base, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForSelector(`#main-content[data-shell="${test.id}"]`);
    const host = page.locator(`[data-slot="system-status-host"][data-status-placement="${test.placement}"]`);
    const status = host.getByLabel("Server connection mode");
    await expect(host).toBeVisible();
    await expect(status).toHaveAttribute("data-connection-mode", "mock");
    assert.equal(await status.evaluate((node) => getComputedStyle(node).position), "static");
    for (const theme of ["light", "dark"]) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      const trigger = page.locator("button:visible:not([disabled]), a[href]:visible").first();
      await trigger.focus();
      const opener = await trigger.elementHandle();
      await page.keyboard.press("Control+/");
      const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
      await expect(dialog).toBeVisible();
      await expect.poll(() => dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
      for (const key of ["Shift+Tab", "Tab", "Tab", "Shift+Tab"]) {
        await page.keyboard.press(key);
        expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
      }
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect.poll(() => opener.evaluate(node => node === document.activeElement)).toBe(true);
      await opener.dispose();
    }
    assert.deepEqual(errors, [], `${test.id} browser errors`);
    await context.close();
    console.log(`PASS ${test.id}: server status in ${test.placement}`);
  }
} finally {
  await browser?.close();
  await fixture.close();
}
