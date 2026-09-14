#!/usr/bin/env node
// Public synthetic browser proof for the native shell window, without live accounts.
import { chromium, expect } from "@playwright/test";
import { releaseFixture } from "./release-fixture.mjs";
const fixture = await releaseFixture();
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ width: 1363, height: 936 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(fixture.base);
    const launcher = viewport.width >= 768
      ? page.getByRole("link", { name: /^Integrations(?: \(running\))?$/ }).first()
      : page.getByRole("button", { name: /^Integrations(?: \(running\))?$/ }).first();
    await expect(launcher).toBeVisible();
    await launcher.hover();
    await launcher.click();
    await expect(page).toHaveURL(fixture.base + "/connections");
    const frame = page.frameLocator('iframe[title="MSO native Integrations manager"]');
    await expect(frame.getByRole("heading", { name: "GitHub", level: 2, exact: true })).toBeVisible();
    await expect(frame.getByRole("link", { name: "Sign in to MSO as Owner" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.reload();
    await expect(frame.getByRole("heading", { name: "GitHub", level: 2, exact: true })).toBeVisible();
    const response = await context.request.get(fixture.base + "/integrations/manager");
    expect(response.headers()["x-frame-options"]).toBe("SAMEORIGIN");
    expect(response.headers()["content-security-policy"]).toContain("frame-ancestors 'self'");
    const compatibility = await context.request.get(fixture.base + "/integrations");
    expect(compatibility.headers()["x-frame-options"]).toBe("DENY");
    expect(compatibility.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(errors).toEqual([]);
    await context.close();
    console.log(`PASS Integrations dock click, native frame, reload, isolation and reflow ${viewport.width}x${viewport.height}`);
  }
} finally {
  await browser.close();
  await fixture.close();
}
