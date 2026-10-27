import { expect } from "@playwright/test";

export async function shellNoticesJourney(page, fixture) {
  const status = "**/api/v1/sys/update*";
  await page.route(status, route => route.fulfill({ json: { behind: 1, remoteChecked: true, pendingBuild: false } }));
  for (const viewport of [{ width: 1280, height: 900 }, { width: 320, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto(fixture.base);
    const shell = page.locator("#main-content");
    await expect(shell).toBeVisible();
    // The dock-adjacent update badge is gone: one cue, inside Settings, no overlay
    // over the interface. Asserting count 0 fails if anyone re-adds a floating badge.
    await expect(shell.locator('[data-slot="shell-update-badge"]')).toHaveCount(0);
    // MSO no longer renders its own install pill: installability stays a browser
    // menu action, so even a fired `beforeinstallprompt` must render nothing here.
    await page.evaluate(() => window.dispatchEvent(new Event("beforeinstallprompt", { cancelable: true })));
    await expect(page.locator('[data-slot="pwa-install-prompt"]')).toHaveCount(0);
    // The single remaining cue lives in Settings and still reads the release tag.
    await page.goto(fixture.base + "/settings");
    await expect(page.locator('[data-slot="settings-update-badge"]')).toBeVisible();
    await expect(page.locator('[data-slot="shell-update-badge"]')).toHaveCount(0);
  }
  await page.unroute(status);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(fixture.base + "/integrations");
  console.log("PASS no floating update badge or install pill at desktop and narrow mobile widths, and the Settings update badge still shows an available release");
}
