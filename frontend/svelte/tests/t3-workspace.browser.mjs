import assert from "node:assert/strict";
import { once } from "node:events";
import { createFixtureBackend, ensureBuild, startVitePreview } from "./_os-matrix-servers.mjs";

import { launchChromium } from "./_browser-launch.mjs";

const official = "https://app.t3.codes/";
const managed = "https://t3.mso.example.com/";
const sample = {
  id: "t3", name: "T3 Code", description: "Fixture", installed: true,
  installationType: "systemd", state: "running", healthy: true, version: null,
  dashboardAvailable: true, publicDashboardUrl: managed, supportedActions: [], diagnostic: null,
};

ensureBuild();
const { server, state } = createFixtureBackend();
state.role = "owner";
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let preview;
let browser;
try {
  preview = await startVitePreview(`http://127.0.0.1:${server.address().port}`);
  browser = await launchChromium();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let requests = 0;
  let blockFrame = false;
  await context.route("**/api/v1/managed-apps", (route) => route.fulfill({ json: { apps: [sample] } }));
  await context.route("https://app.t3.codes/**", (route) => {
    assert.equal(route.request().url(), official);
    assert.equal(route.request().headers().referer, undefined);
    requests++;
    return route.fulfill({
      contentType: "text/html", headers: blockFrame ? { "X-Frame-Options": "DENY" } : {},
      body: "<!doctype html><title>Fixture T3 Connect</title><main><h1>Fixture T3 Connect</h1><p>Paired environments remain in your own T3 account.</p></main>",
    });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(9_000);
  await page.goto(preview.origin);
  await page.locator(".app-dock").getByRole("button", { name: "T3 Code", exact: true }).click();
  const surface = page.getByRole("region", { name: "T3 Code workspace" });
  await surface.waitFor();
  const external = surface.getByRole("link", { name: "Open T3 Connect in a new tab", exact: true });
  const localDashboard = surface.getByRole("link", { name: "Open managed T3 dashboard in a new tab" });
  await localDashboard.waitFor();
  assert.equal(await localDashboard.getAttribute("href"), managed);
  assert.equal(await external.getAttribute("href"), official);
  assert.equal(await external.getAttribute("rel"), "noopener noreferrer");
  assert.equal(requests, 0, "opening the shell window does not load any third-party page");

  const frame = surface.locator("iframe");
  await surface.getByRole("button", { name: "Open T3 Connect inside MSO" }).click();
  await frame.contentFrame().getByRole("heading", { name: "Fixture T3 Connect" }).waitFor();
  assert.equal(await frame.getAttribute("src"), official);
  assert.equal(await frame.getAttribute("sandbox"), "allow-forms allow-scripts allow-same-origin");
  assert.equal(requests, 1);
  const screenshot = process.argv.find((arg) => arg.startsWith("--screenshot="))?.slice("--screenshot=".length);
  if (screenshot) await surface.screenshot({ path: screenshot });

  await surface.getByRole("button", { name: "Close embedded workspace" }).click();
  assert.equal(await frame.count(), 0);
  blockFrame = true;
  const denied = page.waitForEvent("response", (res) => res.url() === official);
  await surface.getByRole("button", { name: "Open T3 Connect inside MSO" }).click();
  assert.equal((await (await denied).allHeaders())["x-frame-options"], "DENY");
  await surface.getByText(/If the frame stays blank or sign-in is blocked/).waitFor();
  const newPage = context.waitForEvent("page");
  await external.click();
  const popup = await newPage;
  await popup.getByRole("heading", { name: "Fixture T3 Connect" }).waitFor();
  assert.equal(popup.url(), official);
  await context.close();

  // Viewer can't launch the pane even with the direct URL.
  state.role = "viewer";
  const deniedPage = await browser.newPage();
  await deniedPage.goto(preview.origin + "/t3");
  await deniedPage.getByText("This app is unavailable for your current role.").waitFor();
  assert.equal(await deniedPage.getByRole("region", { name: "T3 Code workspace" }).count(), 0);
  assert.equal(await deniedPage.getByRole("button", { name: "T3 Code", exact: true }).count(), 0);

  state.role = "owner";
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.route("**/api/v1/managed-apps", (route) => route.fulfill({ status: 403, json: {} }));
  await mobile.goto(preview.origin + "/t3");
  await mobile.getByText("This device cannot read the managed T3 dashboard.").waitFor();
  await mobile.getByRole("link", { name: "Open T3 Connect in a new tab" }).waitFor();
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  console.log("PASS T3 via Svelte dock and deep link, explicit sandbox, XFO-denied frame fallback, Viewer denial, and mobile 403");
} finally {
  await browser?.close();
  if (preview?.proc && preview.proc.exitCode === null) {
    const exited = once(preview.proc, "exit");
    preview.proc.kill();
    await exited;
  }
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}
