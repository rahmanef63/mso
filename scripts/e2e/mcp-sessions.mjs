import path from "node:path";
import { chmod } from "node:fs/promises";
import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
export async function mcpSessionsJourney(page, fixture) {
  await fixture.seedSessions();
  const tab = page.getByRole("tab", { name: /^Sessions/ });
  await tab.click();
  const cards = page.getByRole("button", { name: /^Open session / });
  await expect(cards).toHaveCount(6);
  if (process.env.MSO_SCREENSHOT_DIR) {
    const file = path.join(process.env.MSO_SCREENSHOT_DIR, "mcp-sessions-" + page.viewportSize().width + ".png");
    await page.screenshot({ path: file }); await chmod(file, 0o600);
  }
  await expect(page.getByText("Page 1 of 2 · 8 sessions", { exact: true })).toBeVisible();
  const response = await page.request.get(fixture.base + "/api/v1/agent-sessions?view=monitor&includeOffline=1");
  const raw = await response.text();
  expect(response.status()).toBe(200); expect(raw).not.toMatch(/PRIVATE_TRANSCRIPT|PRIVATE_CONTEXT|principalHash/);
  await page.getByRole("button", { name: "Next sessions page", exact: true }).click();
  await expect(cards).toHaveCount(2);
  await cards.first().click();
  await expect(page.getByRole("region", { name: "Session activity log" })).toBeVisible();
  await expect(page.getByText("Page 1 of 2 · 25 events", { exact: true })).toBeVisible();
  expect(await page.locator('[data-slot="mcp-page"]').innerText()).not.toContain("FIXTURE_SECRET_MUST_NOT_LEAK");
  await page.getByRole("button", { name: "Next events page", exact: true }).click();
  await expect(page.getByText("Page 2 of 2 · 25 events", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Handover guide", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Session handover guide", exact: true })).toBeVisible();
  await page.getByText("JSON Schema reference", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Copy Handover JSON Schema", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  let audit = await new AxeBuilder({ page }).include('[data-slot="mcp-page"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(audit.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
  await page.getByRole("button", { name: "Back to session", exact: true }).click();
  await page.getByRole("button", { name: "Back to sessions", exact: true }).click();
  await page.getByRole("button", { name: "All stored", exact: true }).click();
  await expect(page.getByText("Page 1 of 2 · 9 sessions", { exact: true })).toBeVisible();
  audit = await new AxeBuilder({ page }).include('[data-slot="mcp-page"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(audit.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
  // Keyboard navigation updates both selected tab and actual focus.
  await tab.focus(); await tab.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /^Access MSO/ })).toBeFocused();
  await expect(page.getByRole("navigation", { name: "MCP navigation" })).toBeVisible();
  await tab.click();
  await page.route("**/api/v1/agent-sessions?view=monitor&*", route => route.fulfill({ status: 503, body: "{}" }));
  await page.getByRole("button", { name: "Refresh sessions", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Sessions could not be loaded" })).toBeVisible();
  await page.unroute("**/api/v1/agent-sessions?view=monitor&*");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(cards).toHaveCount(6);
  await page.getByRole("tab", { name: /^Access MSO/ }).click();
  console.log("PASS session cards, pagination, redacted logs, handover schema, keyboard and accessibility");
}
