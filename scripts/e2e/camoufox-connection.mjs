import { expect } from "@playwright/test";

// Intercept only the synthetic fixture's browser service. Never start the host browser.
export async function camoufoxConnectionJourney(page, fixture) {
  let mode = "tls", reads = 0, posts = 0, credentials = 0;
  const observe = request => { if (new URL(request.url()).pathname === "/api/v1/camoufox/session") credentials++; };
  const service = async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() !== "GET") {
      posts++;
      return route.fulfill({ status: 503, json: { error: "Power mutation is forbidden in connection-only retry" } });
    }
    if (url.searchParams.get("probe") === "viewer") return route.fulfill({
      status: 200, json: { reachable: false, state: "tls", message: "Fixture viewer TLS failed" },
    });
    reads++;
    const running = mode === "tls" || reads === 1;
    return route.fulfill({ status: 200, json: { installed: true, running, enabled: false, viewerReady: mode === "tls" } });
  };
  page.on("request", observe);
  await page.route("**/api/v1/camoufox/service*", service);
  try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      mode = "tls"; reads = 0;
      await page.setViewportSize(viewport);
      await page.goto(fixture.base + "/browser");
      const retry = page.getByRole("button", { name: "Retry connection", exact: true });
      await expect(page.getByRole("alert")).toContainText("Fixture viewer TLS failed");
      await expect(page.getByText("Running on the server", { exact: true })).toBeVisible();
      for (let i = 0; i < 3; i++) {
        await retry.click();
        await expect(retry).toBeEnabled();
        await expect(page.getByRole("alert")).toContainText("Fixture viewer TLS failed");
      }
      expect(posts).toBe(0); expect(credentials).toBe(0);
      mode = "stopping"; reads = 0;
      await retry.click();
      await expect(page.getByText("The browser session is off.", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Turn the browser on", exact: true })).toBeVisible();
      await expect(page.getByText("Running on the server", { exact: true })).toHaveCount(0);
      expect(posts).toBe(0); expect(reads).toBe(2);
    }
    console.log("PASS Camoufox read-only retries, no premature credential fetch, and observed session stop on desktop/mobile");
  } finally {
    page.off("request", observe);
    await page.unroute("**/api/v1/camoufox/service*", service);
  }
}
