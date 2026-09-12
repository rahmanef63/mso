#!/usr/bin/env node
// Required release journeys against a built app with synthetic stores and a local provider.
import { execFileSync } from "node:child_process";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mcpOwnerJourneys, mcpPublicJourney, settingsAccessibilityJourney } from "./mcp-settings.mjs";
import { automationJourney } from "./automation.mjs";
import { releaseFixture } from "./release-fixture.mjs";

const fixture = await releaseFixture();
let browser;
try {
  execFileSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", "scripts/e2e/vitest.config.mts"], { env: { ...process.env, E2E_BASE_URL: fixture.base }, stdio: "inherit" });
  browser = await chromium.launch({ headless: true });
  for (const viewport of [{ width: 1363, height: 936 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(fixture.base + "/integrations");
    await expect(page.getByRole("heading", { name: "Integrations", exact: true, level: 1 })).toBeVisible();
    await page.getByLabel("Search services").fill("GitHub");
    await expect(page.getByRole("button", { name: "GitHub", exact: true })).toBeVisible();
    await page.getByText("Connection methods & setup guides", { exact: true }).click();
    await expect(page.getByRole("link", { name: "Official setup page" }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(accessibility.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
    const popupPromise = context.waitForEvent("page");
    await page.getByRole("link", { name: "Sign in to MSO as Owner" }).click();
    const login = await popupPromise;
    await expect(login.getByRole("heading", { name: "Sign in to your server" })).toBeVisible();
    await login.close();
    await page.goto(fixture.base);
    await expect(page.getByLabel("Server connection mode")).toContainText("Mock data only");
    // Real launcher click, not only deep-link route mounting.
    const settingsName = /^(System )?Settings(?: \(running\))?$/;
    const settings = viewport.width >= 768
      ? page.getByRole("link", { name: settingsName }).first()
      : page.getByRole("button", { name: settingsName }).first();
    await expect(settings).toBeVisible();
    await settings.hover(); // Let dock magnification move its hit target before pressing.
    await settings.click();
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.getByLabel("Server connection mode")).toContainText("Mock data only");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (viewport.width < 768) {
      const title = page.locator('[data-slot="mobile-feature-header"]').getByText("Settings", { exact: true });
      await expect(title).toBeVisible();
      await expect.poll(async () => {
        const badge = await page.getByLabel("Server connection mode").boundingBox();
        const heading = await title.boundingBox();
        return badge && heading ? badge.y + badge.height <= heading.y : false;
      }).toBe(true);
    }
    await mcpPublicJourney(page);
    await settingsAccessibilityJourney(page, fixture.base);
    expect(errors).toEqual([]);
    await context.close();
    console.log(`PASS public guides, login entry, launcher and reflow ${viewport.width}x${viewport.height}`);
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(device => {
    localStorage.setItem("mso.device.id", device);
    localStorage.setItem("mso:onboarding:v1", "done");
  }, fixture.device);
  const page = await context.newPage();
  await page.goto(fixture.base + "/login?returnTo=%2Fintegrations");
  await page.locator('input[type="password"]').fill(fixture.password);
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(page).toHaveURL(fixture.base + "/integrations");
  await expect(page.getByRole("group", { name: "Credential owner" }).getByRole("button")).toContainText("fixture");
  await page.getByRole("button", { name: /^Self-hosted Convex(?: 1)?$/ }).click();
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.locator(".connection-state")).toHaveText("Verified");
  await expect(page.getByRole("status")).toContainText("Verified: authenticated");
  fixture.revokeProvider();
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.locator(".connection-state")).toHaveText("Access rejected");
  await page.reload();
  await page.getByRole("button", { name: /^Self-hosted Convex(?: 1)?$/ }).click();
  await expect(page.locator(".connection-state")).toHaveText("Access rejected");
  const call = (route, body) => page.evaluate(async ([route, body]) => {
    const res = await fetch(route, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
    return { status: res.status, body: await res.json() };
  }, [route, body]);
  const exec = await call("/api/v1/exec/run", { cmd: "pwd", cwd: fixture.dir });
  expect(exec.status).toBe(200); expect(exec.body.cwd).toBe(fixture.dir);
  expect((await call("/api/v1/exec/run", { cmd: "exit 0", cwd: fixture.dir + "/missing" })).status).not.toBe(200);
  expect((await call("/api/v1/fs/list?path=" + encodeURIComponent(fixture.dir))).status).toBe(200);
  await mcpOwnerJourneys(page, fixture);
  await automationJourney(page, fixture);
  await fixture.setRole("viewer");
  expect((await call("/api/v1/agent-sessions?view=monitor")).status).toBe(403);
  expect((await call("/api/v1/integrations")).status).toBe(403);
  // Legacy privileged shell routes return 401 for a non-owner session.
  expect((await call("/api/v1/exec/run", { cmd: "pwd", cwd: fixture.dir })).status).toBe(401);
  console.log("PASS browser login/return, live provider revocation, reload, file/exec boundaries and immediate role demotion");
  await context.close();
} finally {
  await browser?.close();
  await fixture.close();
}
console.log("release E2E: all required journeys passed");
