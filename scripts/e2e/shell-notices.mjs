import { expect } from "@playwright/test";

export async function shellNoticesJourney(page, fixture) {
  const status = "**/api/v1/sys/update*";
  await page.route(status, route => route.fulfill({ json: { behind: 1, remoteChecked: true, pendingBuild: false } }));
  for (const viewport of [{ width: 1280, height: 900 }, { width: 320, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto(fixture.base);
    await expect(page.locator('[data-slot="shell-update-badge"]')).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("beforeinstallprompt", { cancelable: true })));
    const install = page.locator('[data-slot="pwa-install-prompt"]');
    await expect(install).toBeVisible();
    const promptBox = await install.boundingBox();
    const updateBox = await page.locator('[data-slot="shell-update-badge"]').boundingBox();
    expect(promptBox.y + promptBox.height).toBeLessThanOrEqual(updateBox.y);
    await install.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(install).toHaveCount(0);
  }
  await page.unroute(status);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(fixture.base + "/integrations");
  console.log("PASS install and update notices stay separate at desktop and narrow mobile widths");
}
