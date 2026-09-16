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
  await expect(page.getByText("Page 1 of 2 · 9 sessions", { exact: true })).toBeVisible();
  const response = await page.request.get(fixture.base + "/api/v1/agent-sessions?view=monitor&includeOffline=1");
  const raw = await response.text();
  expect(response.status()).toBe(200); expect(raw).not.toMatch(/PRIVATE_TRANSCRIPT|PRIVATE_CONTEXT|principalHash/);
  const monitor = JSON.parse(raw);
  const graphResponse = await page.request.get(fixture.base + `/api/v1/agent-sessions?view=graph&id=${encodeURIComponent(monitor.sessions[0].id)}`);
  const graphRaw = await graphResponse.text();
  expect(graphResponse.status()).toBe(200); expect(graphRaw).not.toMatch(/PRIVATE_TRANSCRIPT|PRIVATE_CONTEXT|FIXTURE_SECRET_MUST_NOT_LEAK|principalHash/);

  await page.getByRole("button", { name: "Handover guide", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Session handover guide", exact: true })).toBeVisible();
  await page.getByText("JSON Schema reference", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Copy Handover JSON Schema", exact: true })).toBeVisible();
  expect(await page.locator('[data-slot="mcp-page"]').innerText()).not.toMatch(/\b\d{8}_\d{6}_[a-f0-9]{8}\b/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  let audit = await new AxeBuilder({ page }).include('[data-slot="mcp-page"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(audit.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
  await page.getByRole("button", { name: "Back to sessions", exact: true }).click();

  await page.getByRole("button", { name: "Active", exact: true }).click();
  await expect(page.getByText("Page 1 of 2 · 8 sessions", { exact: true })).toBeVisible();
  audit = await new AxeBuilder({ page }).include('[data-slot="mcp-page"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(audit.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
  await page.getByRole("button", { name:"All stored", exact:true }).click();
  const search=page.getByRole("searchbox", {name:"Search saved sessions"});
  await search.fill("Session fixture 8"); await page.getByRole("button", {name:"Search",exact:true}).click();
  await expect(cards).toHaveCount(1); await expect(cards.first()).toContainText("Session fixture 8");
  await search.fill(""); await expect(cards).toHaveCount(6);
  // Keyboard navigation updates both selected tab and actual focus.
  await tab.focus(); await tab.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /^Access MSO/ })).toBeFocused();
  await expect(page.getByRole("navigation", { name: "MCP navigation" })).toBeVisible();
  await tab.click();
  await page.route("**/api/v1/agent-sessions?view=monitor&*", route => route.fulfill({ status: 503, body: "{}" }));
  await page.getByRole("button", { name: "Refresh sessions", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Sessions could not be loaded" })).toBeVisible();
  await expect(cards).toHaveCount(6); // Last successful observation remains visible.
  await page.unroute("**/api/v1/agent-sessions?view=monitor&*");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(cards).toHaveCount(6);

  // Session selection now hands off to Workflow instead of expanding private detail inside Settings.
  await page.getByRole("button", { name: "Next sessions page", exact: true }).click();
  await expect(cards).toHaveCount(3);
  const openLabel = (await cards.first().getAttribute("aria-label"))?.replace(/^Open session /, "") || "";
  expect(openLabel).toMatch(/^[a-z][a-z0-9-]+-[a-z0-9-]+$/);
  await cards.first().click();
  await expect(page.getByRole("application", { name: "Workflow canvas" })).toBeVisible();
  await expect(page.getByText(openLabel, { exact: true }).last()).toBeVisible();
  const terminalToolNode = page.locator(".react-flow__node").filter({ hasText: "Exec Run" }).first();
  const terminalTabs = page.getByRole("tablist", { name: "Terminal sessions" });
  const terminalCountBefore = await terminalTabs.count();
  await expect(terminalToolNode).toBeVisible();
  expect(await page.locator('[data-slot="workflows-feature"]').innerText()).not.toMatch(/\b\d{8}_\d{6}_[a-f0-9]{8}\b/);
  await terminalToolNode.click();
  await expect(terminalTabs.last()).toBeVisible();
  const backHome = page.getByRole("button", { name: "Back to Home", exact: true });
  if (await backHome.isVisible().catch(() => false)) {
    await backHome.click();
  } else {
    const terminalWindow = page.locator('[data-window="true"][data-app="os-terminal"]').last();
    const closeWindow = terminalWindow.getByRole("button", { name: "Close window", exact: true });
    await expect(closeWindow).toBeVisible();
    await closeWindow.click();
  }
  await expect.poll(async () => await terminalTabs.count()).toBeLessThanOrEqual(terminalCountBefore);
  // Mobile/full-screen terminal navigation changes the active route; restore Settings so the caller can continue its recovery journey.
  await page.goto(fixture.base + "/settings");
  console.log("PASS session labels, Workflow graph handoff, terminal context, redaction, handover, keyboard and accessibility");
}
