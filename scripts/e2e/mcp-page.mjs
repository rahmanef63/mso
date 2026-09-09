#!/usr/bin/env node
// Browser contract for the iframe-free ChatGPT MSO Page external-app handoff.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(path.join(process.cwd(), "os-browser/node_modules/playwright"));
const registry = [{
  id: "play-together",
  title: "Play Together",
  description: "Controlled external app fixture",
  origin: "https://game.example.com",
  startPath: "/embed",
  renderer: "iframe",
  presentation: "inline",
  environment: "production",
  sandbox: "allow-scripts allow-same-origin",
}];
const resource = JSON.parse(execFileSync(
  "bun",
  ["-e", 'import { MSO_PAGE_RESOURCE } from "./lib/mcp/ui-surface"; console.log(JSON.stringify(await MSO_PAGE_RESOURCE))'],
  { encoding: "utf8", env: { ...process.env, MSO_SURFACE_APPS_JSON: JSON.stringify(registry), OS_PUBLIC_ORIGIN: "https://mso.example.com", OS_MCP_UI_ORIGIN: "https://mso-ui.example.com" } },
));
const output = {
  route: "/apps/play-together",
  kind: "app",
  title: "Play Together",
  openPath: "/browser",
  catalog: [],
  app: {
    id: "play-together",
    title: "Play Together",
    description: "Controlled external app fixture",
    origin: "https://game.example.com",
    startPath: "/embed",
    renderer: "remote",
    presentation: "inline",
    environment: "production",
    reason: "External apps use the remote-browser seam so the ChatGPT Page stays free of nested external iframes.",
    url: "https://game.example.com/embed",
  },
};

assert.equal(resource.uri, "ui://mso/page-v13.html");
assert.equal(resource._meta.ui.csp.frameDomains, undefined);
assert.equal(resource._meta["openai/widgetCSP"].frame_domains, undefined);
assert(!resource.text.includes('createElement("iframe")'));
assert(!resource.text.includes("mountReviewedFrame"));
assert(resource.text.includes('"renderer":"remote"'));

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
let assertions = 6;
try {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 800 }]) {
    const page = await browser.newPage({ viewport });
    await page.route("https://mso-ui.example.com/qa", (route) => route.fulfill({
      contentType: "text/html",
      body: `<script>window.openai={toolOutput:${JSON.stringify({ structuredContent: output })}}</script>${resource.text}`,
    }));
    await page.route("https://chatgpt.com/qa", (route) => route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><iframe src="https://mso-ui.example.com/qa" style="width:100%;height:740px"></iframe>',
    }));

    await page.goto("https://chatgpt.com/qa");
    const component = page.frameLocator('iframe[src="https://mso-ui.example.com/qa"]');
    await component.getByText("Play Together opens through MSO Browser", { exact: true }).waitFor();
    assert.equal(await component.locator("iframe").count(), 0, "MSO Page must not mount a nested external iframe"); assertions++;
    assert.equal(await component.locator("#open").getAttribute("data-mso-path"), "/browser"); assertions++;
    assert.equal(await component.getByText(/remote-browser seam/i).count(), 1); assertions++;
    assert.equal(await component.getByRole("button", { name: "Open Remote Browser" }).count(), 1); assertions++;
    console.log(`PASS iframe-free external app handoff ${viewport.width}x${viewport.height}`);
    await page.close();
  }
  console.log(`MCP Page browser checks: ${assertions} assertions passed`);
} finally {
  await browser.close();
}
