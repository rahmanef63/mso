import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function menuChrome(menu) {
  await expect(menu).toHaveAttribute("data-shell-id", "macos");
  await expect.poll(async () => (await menu.boundingBox()).width).toBe(244);
  const material = await menu.evaluate(el => {
    const style = getComputedStyle(el);
    return { mode: document.documentElement.dataset.theme, filter: style.backdropFilter, edge: style.borderColor, shadow: style.boxShadow };
  });
  expect(material.filter).toContain("blur(");
  expect(material.filter).toContain("saturate(1.8)");
  expect(material.edge).toBe(material.mode === "dark" ? "rgba(255, 255, 255, 0.18)" : "rgba(255, 255, 255, 0.35)");
  expect(material.shadow).toContain("inset");
  await expect.poll(() => menu.locator('[role^="menuitem"]').evaluateAll(items =>
    items.every(item => [...item.querySelectorAll("svg")].every(svg => getComputedStyle(svg).color === getComputedStyle(item).color))
  )).toBe(true);
  const rows = await menu.locator('[role^="menuitem"]').evaluateAll(items => items.map(item => {
    const style = getComputedStyle(item);
    return { size: style.fontSize, weight: style.fontWeight, family: style.fontFamily, color: style.color,
      symbols: [...item.querySelectorAll("svg")].map(svg => getComputedStyle(svg).color) };
  }));
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.size).toBe("13px");
    expect(row.weight).toBe("500");
    expect(row.family).toContain("SF Pro Text");
    for (const symbol of row.symbols) expect(symbol).toBe(row.color);
  }
}

export async function menuEvidence({ page, check, shot }, theme) {
    await check(theme + " chrome WCAG A/AA", async () => {
      const axe = await new AxeBuilder({ page }).include(".macos-menubar").include(".macos-titlebar").include(".macos-dock").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      expect(axe.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
    });
    await check(theme + " desktop context menu bounds and radius", async () => {
      await page.mouse.click(1504, 160, { button: "right" });
      const menu = page.locator('.macos-menu[role="menu"]');
      await expect(menu).toBeVisible();
      await menuChrome(menu);
      await expect.poll(async () => (await menu.boundingBox()).width).toBe(244);
      const box = await menu.boundingBox();
      expect(box.width).toBe(244);
      expect(box.x + box.width).toBeLessThanOrEqual(1512);
      expect(box.y + box.height).toBeLessThanOrEqual(982);
      expect(await menu.evaluate(el => getComputedStyle(el).borderRadius)).toBe("12px");
      for (const item of await menu.getByRole("menuitem").all()) expect((await item.boundingBox()).height).toBeGreaterThanOrEqual(24);
      await page.mouse.move(750, 50);
      await page.keyboard.press("ArrowDown");
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.activeElement).color)).toBe("rgb(255, 255, 255)");
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.activeElement).backgroundColor)).toBe("rgb(0, 98, 230)");
      await shot(theme + "-context-menu");
      const axe = await new AxeBuilder({ page }).include(".macos-menu").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      expect(axe.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
    });
    await check(theme + " widget selection and destructive symbol colors", async () => {
      await page.locator('[data-slot="widget-card"]').filter({ hasText: "CPU" }).click({ button: "right" });
      const menu = page.locator('.macos-menu[role="menu"]');
      await expect(menu).toBeVisible();
      await page.mouse.move(750, 50);
      await page.keyboard.press("ArrowDown");
      await menuChrome(menu);
      const selected = menu.getByRole("menuitem", { name: "Medium", exact: true });
      await expect(selected.locator("svg.lucide-check")).toBeVisible();
      const danger = menu.getByRole("menuitem", { name: "Remove widget", exact: true });
      await expect(danger).toHaveClass(/text-destructive-text/);
      expect(await danger.evaluate(el => getComputedStyle(el).color)).not.toBe(await menu.evaluate(el => getComputedStyle(el).color));
      const normal = menu.getByRole("menuitem", { name: "Large", exact: true });
      expect(await normal.evaluate(el => getComputedStyle(el).color)).toBe(await menu.evaluate(el => getComputedStyle(el).color));
      await shot(theme + "-widget-menu");
      await page.keyboard.press("Escape");
    });
    await check(theme + " open menu WCAG A/AA", async () => {
      await page.locator(".macos-menubar").getByRole("button", { name: "View", exact: true }).click();
      const menu = page.locator(".macos-menu");
      await expect(menu).toBeVisible();
      await menuChrome(menu);
      expect(await menu.evaluate(el => getComputedStyle(el).borderRadius)).toBe("12px");
      const axe = await new AxeBuilder({ page }).include(".macos-menu").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      await page.keyboard.press("Escape");
      expect(axe.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
    });
  }

export async function desktopMenu(page, itemName) {
  const surface = page.locator("#main-content");
  const viewport = page.viewportSize();
  console.log("SHELL_SWITCH_GEOMETRY", JSON.stringify({ before: await surface.boundingBox(), viewport }));
  await expect.poll(async () => {
    const box = await surface.boundingBox();
    return { width: Math.round(box.width), height: Math.round(box.height) };
  }).toEqual(viewport);
  const point = await surface.locator("section").first().evaluate(section => {
    const rect = section.getBoundingClientRect();
    for (const x of [rect.right - 8, rect.left + rect.width / 2, rect.left + 8]) {
      for (const y of [rect.top + rect.height / 2, rect.top + 16, rect.bottom - 160]) {
        if (document.elementFromPoint(x, y) === section) return { x, y };
      }
    }
    throw new Error("No bare desktop target found");
  });
  await page.mouse.click(point.x, point.y, { button: "right" });
  const menu = page.getByRole("menu").last();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: itemName, exact: true })).toBeVisible();
  return menu;
}

export async function reducedMenuEvidence({ browser, base, check }) {
  await check("reduced glass disables supported macOS menu filters", async () => {
    const context = await browser.newContext({ viewport: { width: 1512, height: 982 } });
    try {
      await context.addInitScript(() => {
        localStorage.setItem("mso:onboarding:v1", "done");
        localStorage.setItem("sv:shell", JSON.stringify({ desktop: "macos", mobile: "ios" }));
        localStorage.setItem("mso:tweaks", JSON.stringify({ reduceGlass: true }));
      });
      const page = await context.newPage();
      await page.goto(base);
      await expect(page.locator("html")).toHaveClass(/reduce-glass/);
      const contextMenu = await desktopMenu(page, "View as Windows");
      const filters = el => {
        const style = getComputedStyle(el);
        return [style.backdropFilter, CSS.supports("-webkit-backdrop-filter", "blur(1px)")
          ? style.getPropertyValue("-webkit-backdrop-filter") : "unsupported"];
      };
      expect(await contextMenu.evaluate(filters)).toEqual(["none", expect.stringMatching(/^(none|unsupported)$/)]);
      await page.keyboard.press("Escape");
      await page.locator(".macos-menubar").getByRole("button", { name: "View", exact: true }).click();
      expect(await page.locator(".macos-menu").evaluate(filters)).toEqual(["none", expect.stringMatching(/^(none|unsupported)$/)]);
    } finally { await context.close(); }
  });
}
