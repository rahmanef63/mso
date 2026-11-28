import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";

import { launchChromium } from "./_browser-launch.mjs";
import { ensureBuild, startVitePreview } from "./_os-matrix-servers.mjs";

// Synthetic 1200x800 PNG so the editor exercises a real decode, not a stub.
const photo = await sharp({
  create: { width: 1200, height: 800, channels: 3, background: { r: 32, g: 96, b: 200 } },
}).png().toBuffer();

const owner = { authenticated: true, deviceId: "fixture-owner", deviceLabel: "Owner fixture", role: "owner" };
const stats = {
  cpu: { pct: 12, cores: 4 },
  mem: { used: 1024 ** 3, total: 4 * 1024 ** 3 },
  disk: { used: 2 * 1024 ** 3, total: 8 * 1024 ** 3 },
  uptime: 3_660_000,
};
let writes = 0;

const backend = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/api/auth/me") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(owner));
    return;
  }
  if (url.pathname === "/api/v1/sys/stats") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(stats));
    return;
  }
  if (url.pathname === "/api/v1/fs/raw") {
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.end(photo);
    return;
  }
  if (url.pathname === "/api/v1/fs/write" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      writes += 1;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: body.includes("data:image/") }));
    });
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.statusCode = 404;
  res.end("{}");
});

const SHOT_DIR = process.env.MSO_SCREENSHOT_DIR || "/tmp/opencode";
mkdirSync(SHOT_DIR, { recursive: true });

ensureBuild();
await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
let preview;
let browser;
try {
  preview = await startVitePreview(`http://127.0.0.1:${backend.address().port}`);
  browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(15_000);

  await page.goto(`${preview.origin}/image-editor`);
  const root = page.locator(".image-editor-root");
  await root.waitFor();
  assert.equal(await root.getAttribute("data-image-loaded"), "false");

  await page.getByLabel("Host image path").fill("/home/demo/photo.png");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.locator(".image-editor-root[data-image-loaded='true']").waitFor();

  // A press on an overlay that never drags must not leave a half-open history edit
  // behind: one undo after the next action has to revert that action only.
  await page.keyboard.press("t");
  await page.getByRole("button", { name: "Add Text" }).click();
  await page.keyboard.press("v");
  await delay(120);
  const stageBox = await page.locator("canvas.editor-canvas").boundingBox();
  assert.ok(stageBox, "stage canvas must render before the click probe");
  await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await delay(120);

  await page.getByRole("tab", { name: "Filters" }).click();
  await page.getByRole("button", { name: "Noir" }).click();
  await page.getByRole("tab", { name: "Adjust" }).click();
  await page.getByLabel("Brightness").evaluate((el) => {
    el.value = "180";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.getByLabel("Brightness").evaluate((el) => {
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await delay(120);
  const activeFilterTag = () => page.locator(".active-tag");
  await page.getByRole("button", { name: "Undo" }).click();
  await delay(150);
  await page.getByRole("tab", { name: "Filters" }).click();
  assert.equal(
    (await activeFilterTag().innerText()).trim().toLowerCase(),
    "noir",
    "one undo after a slider drag must restore the preset that preceded the drag",
  );
  await page.getByRole("tab", { name: "Adjust" }).click();
  assert.equal(
    await page.getByLabel("Brightness").inputValue(),
    "98",
    "one undo must revert the drag, not the preset",
  );
  await page.getByRole("button", { name: "Redo" }).click();
  await delay(150);
  assert.equal(await page.getByLabel("Brightness").inputValue(), "180", "redo restores the drag");

  await page.getByRole("tab", { name: "Layers" }).click();
  const layers = await page.locator(".layer-item").count();
  assert.ok(layers >= 2, `expected the image plus drawing layer, saw ${layers}`);
  await page.getByRole("button", { name: "+ Draw Layer" }).click();
  assert.equal(await page.locator(".layer-item").count(), layers + 1);

  const canvas = page.locator("canvas.editor-canvas");
  const box = await canvas.boundingBox();
  assert.ok(box && box.width > 100 && box.height > 60, `canvas must render, saw ${JSON.stringify(box)}`);

  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export Image" });
  await dialog.waitFor();
  await page.getByLabel("Save to VPS path (/api/v1/fs/write)").fill("~/Pictures/out.png.dataurl");
  await dialog.getByRole("button", { name: "Save to VPS" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(writes, 1, "export wrote exactly one data URL through /api/v1/fs/write");
  await page.getByText("Saved export to ~/Pictures/out.png.dataurl.").waitFor();

  await page.setViewportSize({ width: 390, height: 844 });
  await delay(250);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 1440, height: 900 });
  await delay(200);
  await page.screenshot({ path: `${SHOT_DIR}/image-editor-studio.png` });
  console.log(`PASS Image Editor: load, presets, adjustments, layers=${layers + 1}, canvas, VPS export, no overflow at 390px`);
} finally {
  await browser?.close();
  if (preview) {
    preview.proc.kill("SIGTERM");
    await once(preview.proc, "exit").catch(() => {});
  }
  backend.closeAllConnections();
  await new Promise((resolve) => backend.close(resolve));
}
