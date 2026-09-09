// Real production Settings routes, with synthetic owner state and bounded fault injection.
import path from "node:path";
import { chmod } from "node:fs/promises";
import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function capture(page, name) {
  if (!process.env.MSO_SCREENSHOT_DIR) return;
  const file = path.join(process.env.MSO_SCREENSHOT_DIR, name + ".png");
  await page.screenshot({ path: file });
  await chmod(file, 0o600);
}
async function openMcp(page) {
  const sections = page.getByRole("button", { name: "Settings sections", exact: true });
  await expect.poll(async () => await sections.isVisible() || await page.getByRole("button", { name: "MCP", exact: true }).isVisible()).toBe(true);
  if (await sections.isVisible()) await sections.click();
  await page.getByRole("button", { name: "MCP", exact: true }).click();
}
export async function mcpPublicJourney(page) {
  let privateRequests = 0;
  const listener = request => { if (/\/api\/mcp\/tokens|\/api\/v1\/sys\/audit/.test(request.url())) privateRequests++; };
  page.on("request", listener);
  await openMcp(page);
  await expect(page.getByRole("link", { name: "Sign in to manage MCP" })).toBeVisible();
  expect(privateRequests).toBe(0);
  page.off("request", listener);
}
export async function mcpOwnerJourneys(page, fixture) {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const viewport of [{ width: 1363, height: 936 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await fixture.seedMcp();
    await page.setViewportSize(viewport);
    await page.goto(fixture.base + "/settings");
    await openMcp(page);
    const nav = page.getByRole("navigation", { name: "MCP navigation" });
    await expect(nav.getByRole("button", { name: /^Connected apps/ })).toBeVisible();
    await capture(page, `mcp-overview-${viewport.width}`);
    await nav.getByRole("button", { name: /^Connect an app/ }).click();
    await expect(page.getByRole("heading", { name: "Which app do you want to connect?" })).toBeVisible();
    await capture(page, `mcp-client-picker-${viewport.width}`);
    await page.getByRole("button", { name: /^ChatGPT Apps/ }).click();
    await expect(page.getByText("Connect ChatGPT", { exact: true })).toBeVisible();
    await expect(page.getByText("Manual OAuth configuration", { exact: true })).toHaveCount(0);
    await capture(page, `mcp-guide-${viewport.width}`);
    await page.getByRole("button", { name: "Choose another app", exact: true }).click();
    await page.getByRole("button", { name: /^Cursor Remote/ }).click();
    await expect(page.getByText("Connect Cursor", { exact: true })).toBeVisible();
    await nav.getByRole("button", { name: "MCP overview", exact: true }).click();
    await nav.getByRole("button", { name: /^Connected apps/ }).click();
    await page.getByRole("button", { name: "Disconnect Fixture client", exact: true }).click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("button", { name: "Disconnect Fixture client", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Disconnect Fixture client", exact: true }).click();
    await page.getByRole("button", { name: "Confirm disconnect", exact: true }).click();
    await expect(page.getByText("0 active connections", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Show expired & disconnected", exact: true }).click();
    await expect(page.getByText("Read data · revoked", { exact: true })).toBeVisible();
    await nav.getByRole("button", { name: "MCP overview", exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const result = await new AxeBuilder({ page }).include('[data-slot="mcp-page"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(result.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
    console.log(`PASS MCP owner hierarchy, app guides, cancel/revoke and accessibility ${viewport.width}x${viewport.height}`);
  }
  // Server faults show a recoverable error, never an endless skeleton or false empty audit.
  await page.route("**/api/mcp/tokens", route => route.fulfill({ status: 503, body: '{}' }));
  await page.reload(); await openMcp(page);
  await expect(page.getByRole("alert").filter({ hasText: "MCP settings could not be loaded" })).toBeVisible();
  await page.unroute("**/api/mcp/tokens");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "MCP navigation" });
  await expect(nav.getByRole("button", { name: /^Connect an app/ })).toBeVisible();
  await page.route("**/api/v1/sys/audit?*", route => route.fulfill({ status: 503, body: '{}' }));
  await nav.getByRole("button", { name: /^Recent activity/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Activity could not be loaded" })).toBeVisible();
  await page.unroute("**/api/v1/sys/audit?*");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByText("Privileged MCP log", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  console.log("PASS MCP failed-load recovery and activity error states");
}

export async function settingsAccessibilityJourney(page, base) {
  await page.goto(base + "/settings?section=appearance");
  await expect(page.getByRole("switch", { name: "Reduce transparency", exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Device preview", exact: true }).getByRole("button", { pressed: true })).toHaveCount(1);
  await page.goto(base + "/settings?section=theme");
  await expect(page.getByRole("switch", { name: "High contrast", exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Text size", exact: true }).getByRole("button", { pressed: true })).toHaveCount(1);
}
