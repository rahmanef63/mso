import { expect } from "@playwright/test";

// Owner Settings journey. All provider mutations and discovery are intercepted:
// the values below are synthetic and never reach a host or external provider.
export async function settingsDraftJourney(page, fixture) {
  const desktop = { width: 1280, height: 900 };
  const phone = { width: 390, height: 844 };
  let releaseSave;
  const saveGate = new Promise(resolve => { releaseSave = resolve; });
  let saveRequests = 0;
  const configRoute = async route => {
    if (route.request().method() !== "POST") return route.continue();
    saveRequests++;
    await saveGate;
    await route.fulfill({ status: 200, json: { slug: "fixture-provider" } }).catch(() => {});
  };
  const discoveryRoute = route => route.fulfill({ status: 200, json: { ok: true, models: [] } });
  await page.route("**/api/config", configRoute);
  await page.route("**/api/models/discover", discoveryRoute);
  try {
    await page.setViewportSize(desktop);
    await page.goto(fixture.base + "/settings?section=ai");
    const open = page.getByRole("button", { name: "Add custom provider", exact: true });
    await expect(open).toBeVisible();
    await open.click();
    const form = page.locator("#custom-provider-form");
    const name = form.getByLabel("Provider name", { exact: true });
    const key = form.getByLabel("API key", { exact: true });
    const url = form.getByLabel("Base URL", { exact: true });
    await name.fill("Fixture provider");
    await key.fill("fixture-only-key");

    // Verify a real surface transition, not merely a resize of the same DOM.
    const oldForm = await form.elementHandle();
    await page.setViewportSize(phone);
    await expect(page.locator('[data-shell="ios"], [data-shell="android"]')).toBeVisible();
    await expect.poll(() => oldForm.evaluate(node => node.isConnected)).toBe(false);
    await expect(name).toHaveValue("Fixture provider");
    await expect(key).toHaveValue("fixture-only-key");
    const mobileForm = await form.elementHandle();
    await page.setViewportSize(desktop);
    await expect(page.locator('[data-window][data-app="os-settings"]')).toBeVisible();
    await expect.poll(() => mobileForm.evaluate(node => node.isConnected)).toBe(false);
    await expect(name).toHaveValue("Fixture provider");
    await expect(key).toHaveValue("fixture-only-key");

    const closeForm = page.getByRole("button", { name: "Close custom provider form", exact: true });
    let choice = "dismiss";
    const dialogHandler = async dialog => {
      expect(dialog.type()).toBe("confirm");
      expect(dialog.message()).toContain("unsaved API key or JSON");
      if (choice === "dismiss") await dialog.dismiss(); else await dialog.accept();
    };
    page.on("dialog", dialogHandler);
    try {
      await closeForm.click();
      await expect(key).toHaveValue("fixture-only-key");
      choice = "accept";
      await closeForm.click();
      await expect(form).toHaveCount(0);
      await open.click();
      await expect(key).toHaveValue("");
    } finally { page.off("dialog", dialogHandler); }

    await url.fill("https://fixture.invalid/v1");
    await key.fill("fixture-only-key");
    await form.getByRole("button", { name: "Add provider", exact: true }).click();
    await expect.poll(() => saveRequests).toBe(1);
    await expect(form.getByRole("button", { name: "Adding…", exact: true })).toBeDisabled();
    const pendingForm = await form.elementHandle();
    await page.setViewportSize(phone);
    await expect(page.locator('[data-shell="ios"], [data-shell="android"]')).toBeVisible();
    await expect.poll(() => pendingForm.evaluate(node => node.isConnected)).toBe(false);
    await expect(form.getByRole("button", { name: "Adding…", exact: true })).toBeDisabled();
    await expect(key).toHaveValue("fixture-only-key");
    const pendingMobile = await form.elementHandle();
    await page.setViewportSize(desktop);
    await expect(page.locator('[data-window][data-app="os-settings"]')).toBeVisible();
    await expect.poll(() => pendingMobile.evaluate(node => node.isConnected)).toBe(false);
    await expect(form.getByRole("button", { name: "Adding…", exact: true })).toBeDisabled();
    await closeForm.click();
    await expect(key).toHaveValue("fixture-only-key");
    await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Appearance", exact: true }).click();
    await expect(form).toBeVisible();
    await page.locator('[data-window][data-app="os-settings"]').getByRole("button", { name: "Close window", exact: true }).click();
    await expect(form).toBeVisible();
    expect(saveRequests).toBe(1);
    releaseSave();
    await expect(open).toBeVisible();
    await open.click();
    await expect(name).toHaveValue("");
    await expect(key).toHaveValue("");
    console.log("PASS Settings draft across responsive remount, discard and pending provider save");
  } finally {
    releaseSave();
    await page.unroute("**/api/config", configRoute);
    await page.unroute("**/api/models/discover", discoveryRoute);
    await page.setViewportSize(desktop);
  }
}
