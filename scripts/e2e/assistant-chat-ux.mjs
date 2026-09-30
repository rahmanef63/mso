#!/usr/bin/env node
import { chromium, expect } from "@playwright/test";
import { releaseFixture } from "./release-fixture.mjs";

const fixture = await releaseFixture();
let browser;
try {
  const login = await fetch(fixture.base + "/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json", origin: fixture.base },
    body: JSON.stringify({ password: fixture.password, deviceId: fixture.device }),
  });
  expect(login.ok).toBe(true);
  const cookie = /session=([^;]+)/.exec(login.headers.get("set-cookie") || "")?.[1];
  expect(cookie).toBeTruthy();
  browser = await chromium.launch({ headless: true });
  for (const viewport of [{ width: 1363, height: 936 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, hasTouch: viewport.width < 768 });
    await context.addCookies([{ name: "session", value: cookie, url: fixture.base }]);
    await context.addInitScript((device) => {
      localStorage.setItem("mso.device.id", device);
      localStorage.setItem("mso:onboarding:v1", "done");
    }, fixture.device);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let request;
    await page.route("**/api/assistant", (route) => { request = route; });
    await page.goto(fixture.base + "/assistant");
    const input = page.locator("textarea:visible").first();
    await expect(input).toBeVisible();
    const send = async (text) => {
      request = undefined;
      await input.fill(text);
      await page.getByRole("button", { name: "Send message", exact: true }).first().click();
      await expect.poll(() => Boolean(request)).toBe(true);
    };
    const run = page.getByRole("region", { name: "Assistant run" });
    const respond = async (body, status = 200) => {
      const route = request; request = undefined;
      await route.fulfill({ status, contentType: status === 200 ? "text/event-stream" : "application/json", body });
    };
    await send("Create a test folder");
    await expect(run.getByRole("status")).toHaveText("Working");
    await expect(run.getByText(/elapsed/)).toBeVisible();
    await respond('event: tool_use\ndata: {"id":"mkdir","name":"fs.mkdir","input":{"path":"~/projects/chat-ux-fixture"}}\n\nevent: done\ndata: {"stopReason":"tool_use"}\n\n');
    await expect(run.getByRole("status")).toHaveText("Waiting for approval");
    await expect(input).toHaveAttribute("placeholder", "Waiting for your approval…");
    await page.getByRole("switch").last().click();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect.poll(() => Boolean(request)).toBe(true);
    await respond('event: delta\ndata: "Folder ready."\n\nevent: done\ndata: {"stopReason":"end_turn"}\n\n');
    await expect(run.getByRole("status")).toHaveText("Done");
    await expect(page.getByText("Always approve: 1 exact calls")).toBeVisible();
    await send("Create that same folder again");
    await respond('event: tool_use\ndata: {"id":"mkdir2","name":"fs.mkdir","input":{"path":"~/projects/chat-ux-fixture"}}\n\nevent: done\ndata: {"stopReason":"tool_use"}\n\n');
    await expect.poll(() => Boolean(request)).toBe(true);
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
    await respond('event: delta\ndata: "Already ready."\n\nevent: done\ndata: {"stopReason":"end_turn"}\n\n');
    await expect(run.getByRole("status")).toHaveText("Done");
    await page.getByText("Always approve: 1 exact calls").click();
    await page.getByRole("button", { name: "Reset all approvals" }).click();
    await send("Pause for approval");
    await respond('event: tool_use\ndata: {"id":"mkdir3","name":"fs.mkdir","input":{"path":"~/projects/chat-ux-fixture"}}\n\nevent: done\ndata: {"stopReason":"tool_use"}\n\n');
    await expect(run.getByRole("status")).toHaveText("Waiting for approval");
    await run.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(run.getByRole("status")).toHaveText("Stopped");
    await expect(page.getByRole("button", { name: "Send message", exact: true }).first()).toBeVisible();
    await send("Simulate a provider failure");
    await respond('{"error":"provider_unavailable"}', 503);
    await expect(run.getByRole("status")).toHaveText("Failed");
    await run.getByRole("button", { name: "Details" }).click();
    await expect(page.getByRole("heading", { name: "Run details" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
    await context.close();
    console.log(`PASS Assistant explicit states, scoped approval/reset, Stop and details ${viewport.width}x${viewport.height}`);
  }
} finally {
  await browser?.close();
  await fixture.close();
}
