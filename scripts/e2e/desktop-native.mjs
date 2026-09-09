#!/usr/bin/env node
// Native desktop acceptance: real navigation/search, taskbar reuse, narrow windows.
// Uses a built app with disposable credentials; E2E_BASE_URL is demo-only.
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { releaseFixture } from "./release-fixture.mjs";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.umask(0o077);
const demo = process.env.E2E_DEMO === "1";
const fixture = demo ? null : await releaseFixture({ live: true });
const base = fixture?.base ?? process.env.E2E_BASE_URL ?? "http://127.0.0.1:4005";
const captureOnly = process.env.E2E_CAPTURE_ONLY === "1";
const out = process.env.MSO_SCREENSHOT_DIR ?? path.join(os.tmpdir(), "mso-desktop-native");
mkdirSync(out, { recursive: true, mode: 0o700 });
let browser;
try {
  let device, cookie;
  if (fixture) {
    device = fixture.device;
    const r = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ password: fixture.password, deviceId: device, deviceLabel: "desktop-native-e2e" }), redirect: "error" });
    assert(r.ok, "Authentication failed: " + r.status);
    cookie = /(?:^|,\s*)session=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")?.[1];
    assert(cookie, "Missing authenticated session");
  }
  browser = await chromium.launch({ headless: true });
  for (const shell of ["windows", "macos"]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    if (cookie) await ctx.addCookies([{ name: "session", value: cookie, url: base, sameSite: "Strict" }]);
    await ctx.addInitScript(({ shell, device }) => {
      localStorage.setItem("sv:shell", JSON.stringify({ desktop: shell, mobile: "ios" }));
      localStorage.setItem("mso:onboarding:v1", "done");
      if (device) {
        localStorage.setItem("mso.device.id", device);
        localStorage.setItem("mso:tweaks", JSON.stringify({server:{mode:"live",activeTargetId:"vps",url:""}}));
      }
    }, { shell, device });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/files" + (fixture?.dir ?? ""), { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForSelector('#main-content[data-shell="' + shell + '"]');
    if (!demo) assert.equal(await page.evaluate(async () => (await (await fetch("/api/auth/me")).json()).authenticated), true);
    const files = page.locator('[data-window]').last();
    await files.locator("[data-name]").first().waitFor({ timeout: 30000 });
    await page.screenshot({ path: path.join(out, shell + "-files-" + (captureOnly ? "before" : "after") + ".png") });
    if (!captureOnly) {
      const nativeFiles = page.locator('[data-app="files-manager"]');
      assert.equal(await nativeFiles.count(), 1);
      await nativeFiles.getByLabel("Search this folder").fill("___no_matching_files___");
      await nativeFiles.getByText("No matching files", { exact: true }).waitFor();
      await nativeFiles.getByLabel("Clear search").click();
      await nativeFiles.locator("[data-name]").first().waitFor();
      await nativeFiles.getByRole("button", { name: "List view", exact: true }).click();
      await nativeFiles.getByRole("button", { name: "Grid view", exact: true }).click();
      assert.equal(await nativeFiles.getByRole("button", { name: "Grid view", exact: true }).getAttribute("aria-pressed"), "true");
      const firstItem = nativeFiles.locator("[data-name]").first();
      await firstItem.click();
      await page.keyboard.press(shell === "windows" ? "F2" : "Enter");
      await firstItem.locator("input").waitFor();
      await page.keyboard.press("Escape");
      if (shell === "windows") {
        const pin = page.locator('button[aria-label="File Explorer"]');
        await pin.click();
        await nativeFiles.waitFor({ state: "hidden" });
        await pin.click();
        await nativeFiles.waitFor({ state: "visible" });
        assert.equal(await nativeFiles.count(), 1, "Taskbar must restore the same Files window");
      }
      // Resizing via the shared window handle must reveal the sidebar drawer affordance.
      const box = await nativeFiles.boundingBox();
      await page.mouse.move(box.x + box.width - 10, box.y + box.height - 10);
      await page.mouse.down();
      await page.mouse.move(box.x + 520, box.y + box.height - 10, { steps: 12 });
      await page.mouse.up();
      await nativeFiles.getByRole("button", { name: "Open sidebar", exact: true }).waitFor();
      await page.screenshot({ path: path.join(out, shell + "-files-narrow.png") });
    }
    await page.goto(base + "/settings", { waitUntil: "networkidle", timeout: 90000 });
    const settings = page.locator('[data-window]').last();
    await settings.getByText("Appearance", { exact: true }).last().waitFor();
    await page.screenshot({ path: path.join(out, shell + "-settings-" + (captureOnly ? "before" : "after") + ".png") });
    if (!captureOnly) {
      const nativeSettings = page.locator('[data-app="os-settings"]');
      const search = nativeSettings.getByRole("textbox", { name: "Find a setting" });
      await search.fill("theme");
      await nativeSettings.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Theme", exact: true }).click();
      await nativeSettings.getByRole("heading", { name: "Theme", exact: true }).waitFor();
      await search.fill("___unknown___");
      await nativeSettings.getByText("No settings found.", { exact: true }).waitFor();
      await search.fill("");
      const nav = nativeSettings.getByRole("navigation", { name: "Settings sections" });
      assert.equal(await nav.getByRole("button").count(), 11);
      await nav.getByRole("button", { name: "Appearance", exact: true }).click();
      const b = await nativeSettings.boundingBox();
      await page.mouse.move(b.x + b.width - 10, b.y + b.height - 10);
      await page.mouse.down();
      await page.mouse.move(b.x + 520, b.y + b.height - 10, { steps: 12 });
      await page.mouse.up();
      assert((await nativeSettings.boundingBox()).width < 600, "Settings resized below 600px");
      await page.screenshot({ path: path.join(out, shell + "-settings-narrow.png") });
      await nativeSettings.getByRole("button", { name: "Settings sections", exact: true }).click();
      await page.getByRole("dialog").getByRole("textbox", { name: "Find a setting" }).waitFor();
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert(await nativeSettings.locator('[data-slot="settings-row"]').evaluateAll((rows) => rows.every((r) => r.scrollWidth <= r.clientWidth + 1)), "Settings rows must fit the narrow pane");
      await page.screenshot({ path: path.join(out, shell + "-settings-narrow.png") });
    }
    assert.deepEqual(errors, [], shell + " browser errors");
    console.log("PASS " + shell + ": " + (captureOnly ? "baseline captured" : "Files search/view, taskbar, Settings search/navigation, narrow layouts"));
    await ctx.close();
  }
} finally { await browser?.close(); await fixture?.close(); }
