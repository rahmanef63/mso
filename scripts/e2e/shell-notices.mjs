import { expect } from "@playwright/test";

export async function shellNoticesJourney(page, fixture) {
  const status = "**/api/v1/sys/update*";
  await page.route(status, route => route.fulfill({ json: { behind: 1, remoteChecked: true, pendingBuild: false } }));
  for (const viewport of [{ width: 1280, height: 900 }, { width: 320, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto(fixture.base);
    await expect(page.locator('[data-slot="shell-update-badge"]')).toBeVisible();
    // MSO no longer renders its own install pill: installability stays a browser
    // menu action, so even a fired `beforeinstallprompt` must render nothing here.
    await page.evaluate(() => window.dispatchEvent(new Event("beforeinstallprompt", { cancelable: true })));
    await expect(page.locator('[data-slot="pwa-install-prompt"]')).toHaveCount(0);
  }
  await page.unroute(status);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(fixture.base + "/integrations");
  console.log("PASS the update notice stays visible and the removed install pill never renders at desktop and narrow mobile widths");
}
