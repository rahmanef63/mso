#!/usr/bin/env node
import { chromium, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { releaseFixture } from "./release-fixture.mjs";

const fixture = await releaseFixture();
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const context = await browser.newContext({ viewport });
    await context.addInitScript(device => {
      if (window !== window.top) return;
      localStorage.setItem("mso.device.id", device);
      localStorage.setItem("mso:onboarding:v1", "done");
    }, fixture.device);
    await context.route("**/api/v1/managed-apps", route => route.fulfill({ json: { apps: [] } }));
    await context.route("https://tool.example.test/**", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><h1>Custom tool</h1><label>Draft <input aria-label="Draft"></label></body></html>' }));
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(fixture.base + "/login?returnTo=%2Fstore");
    await page.locator('input[type="password"]').fill(fixture.password);
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Apps on your host" })).toBeVisible();
    await page.getByRole("button", { name: "Connect app", exact: true }).click();
    const form = page.getByRole("dialog");
    await form.getByLabel("App name", { exact: true }).fill("Fixture tool");
    await form.getByLabel("App URL", { exact: true }).fill("https://tool.example.test/editor");
    await form.locator("form").hover();
    await page.mouse.wheel(0, 1000);
    await expect(form.getByRole("button", { name: "Connect app", exact: true })).toBeInViewport({ ratio: 1 });
    await form.getByRole("button", { name: "Connect app", exact: true }).click();
    await expect(form).toHaveCount(0);
    const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Fixture tool", exact: true }) });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Open", exact: true }).click();
    const iframe = page.locator('iframe[title="Fixture tool application"]');
    const frame = page.frameLocator('iframe[title="Fixture tool application"]');
    await expect(frame.getByRole("heading", { name: "Custom tool" })).toBeVisible();
    await frame.getByLabel("Draft", { exact: true }).fill("Keep my draft");
    const refreshed = page.waitForResponse(response => response.url().endsWith("/api/v1/shell-apps") && response.request().method() === "GET");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await refreshed;
    await expect(frame.getByLabel("Draft", { exact: true })).toHaveValue("Keep my draft");
    await page.reload();
    await expect(frame.getByRole("heading", { name: "Custom tool" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect((await iframe.boundingBox()).height).toBeGreaterThan(120);
    expect(JSON.parse(await readFile(path.join(fixture.dir, "surface-apps.json"), "utf8"))[0].id).toBe("fixture-tool");
    await page.goto(fixture.base + "/store");
    await card.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("dialog").getByLabel("App URL", { exact: true }).fill("http://192.0.2.10:5678/");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await card.getByRole("button", { name: "Open", exact: true }).click();
    await expect(page.getByRole("link", { name: "Open Fixture tool", exact: true })).toHaveAttribute("href", "http://192.0.2.10:5678/");
    await expect(iframe).toHaveCount(0);
    await page.goto(fixture.base + "/store");
    await card.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect(page.getByText("This removes its shell entry. The application keeps running and its data is untouched.")).toBeVisible();
    const disconnected = page.waitForResponse(response => response.url().endsWith("/api/v1/shell-apps") && response.request().method() === "POST");
    await page.getByRole("dialog").getByRole("button", { name: "Disconnect", exact: true }).click();
    expect((await disconnected).status()).toBe(200);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(card).toHaveCount(0);
    expect(JSON.parse(await readFile(path.join(fixture.dir, "surface-apps.json"), "utf8"))).toEqual([]);
    await fixture.setRole("viewer");
    expect(await page.evaluate(async () => (await fetch("/api/v1/shell-apps")).status)).toBe(403);
    await fixture.setRole("owner");
    expect(errors).toEqual([]);
    await context.close();
    console.log(`PASS connected app CRUD, embed draft retention, persistence, IP fallback and authorization ${viewport.width}x${viewport.height}`);
  }
} finally { await browser?.close(); await fixture.close(); }
