import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdirSync } from "node:fs";

import { setTimeout as delay } from "node:timers/promises";

import { launchChromium } from "./_browser-launch.mjs";
import { ensureBuild, startVitePreview } from "./_os-matrix-servers.mjs";

// Demo shell (?demo=1) owns its own fixture data, so no synthetic backend is needed.
const SHOT_DIR = process.env.MSO_SCREENSHOT_DIR || "/tmp/opencode";
mkdirSync(SHOT_DIR, { recursive: true });

ensureBuild();
let preview;
let browser;
try {
  preview = await startVitePreview("http://127.0.0.1:9");
  browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(15_000);

  await page.goto(`${preview.origin}/reel-editor?demo=1`);
  const root = page.locator(".reel-root");
  await root.waitFor();

  // Seed project: 4 + 5 + 3 = 12s across three clips.
  const timecode = page.getByLabel("Current timecode");
  await timecode.waitFor();
  assert.match(await timecode.innerText(), /00:00\.0 \/ 00:12\.0/);

  const firstClip = page.locator(".clip-block").first();
  const clipDurationBefore = await firstClip.locator(".clip-dur").innerText();
  assert.equal(clipDurationBefore, "4s");

  // Drag the start handle 25% of the clip width to the right and commit.
  const handle = page.getByRole("button", { name: "Trim start of Opening Hook" });
  await handle.scrollIntoViewIfNeeded();
  await delay(200);
  const handleBox = await handle.boundingBox();
  const clipBox = await firstClip.boundingBox();
  assert.ok(handleBox && clipBox, "trim handle and clip block must be laid out");
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + clipBox.width * 0.25, handleBox.y + handleBox.height / 2, { steps: 8 });
  await page.mouse.up();

  await page.locator(".clip-block.selected .clip-dur").waitFor();
  const clipDurationAfter = await firstClip.locator(".clip-dur").innerText();
  assert.notEqual(clipDurationAfter, "4s", `expected a trim after the drag, saw ${clipDurationAfter}`);
  assert.match(clipDurationAfter, /trimmed$/);
  assert.match(await timecode.innerText(), /\/ 00:1[01]\.\d/, "total duration must shrink with the trim");

  // Keyboard path: the same handle must trim without a pointer.
  const beforeKey = await firstClip.locator(".clip-dur").innerText();
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await delay(60);
  const afterKey = await firstClip.locator(".clip-dur").innerText();
  assert.notEqual(afterKey, beforeKey, `keyboard trim must change the clip duration (${beforeKey} -> ${afterKey})`);

  await page.setViewportSize({ width: 390, height: 844 });
  await delay(250);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "no page overflow at 390px");
  assert.deepEqual(errors, []);

  await page.setViewportSize({ width: 1440, height: 900 });
  await delay(200);
  await page.screenshot({ path: `${SHOT_DIR}/reel-editor-trim.png` });
  console.log(`PASS Reel Editor: drag trim ${clipDurationBefore} -> ${clipDurationAfter}, keyboard trim -> ${afterKey}, no overflow at 390px`);
} finally {
  await browser?.close();
  if (preview) {
    preview.proc.kill("SIGTERM");
    await once(preview.proc, "exit").catch(() => {});
  }
}
