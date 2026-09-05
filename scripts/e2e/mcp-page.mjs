#!/usr/bin/env node
// Browser contract for the portable MCP host, readiness, timeout and legacy cached output.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(process.cwd(), "os-browser/node_modules/playwright"));
const resource = JSON.parse(execFileSync("bun", ["-e", 'import { MSO_PAGE_RESOURCE } from "./lib/mcp/ui-surface"; console.log(JSON.stringify(MSO_PAGE_RESOURCE))'], { encoding: "utf8" }));
const output = {
  route: "/apps/play-together", kind: "app", title: "Play Together", openPath: "/assistant/mcp", catalog: [],
  app: { id: "play-together", url: "https://game.rahmanef.com/embed" },
};
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
let assertions = 0;
try {
  for (const legacy of [false, true]) {
    const page = await browser.newPage({ viewport: { width: legacy ? 390 : 1280, height: 800 } });
    await page.clock.install();
    let childLoads = 0;
    await page.route("https://game.rahmanef.com/embed", (route) => {
      childLoads++;
      return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Controlled game readiness fixture</title><main>Fixture game shell</main>" });
    });
    await page.route("https://mso-ui.rahmanef.com/qa", (route) => route.fulfill({ contentType: "text/html", body: `${legacy ? `<script>window.openai={toolOutput:${JSON.stringify({ structuredContent: output })}}</script>` : ""}${resource.text}` }));
    await page.route("https://chatgpt.com/qa", (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html><script>
      window.calls=[];window.result=${JSON.stringify(output)};
      window.addEventListener("message",event=>{
        const msg=event.data;if(!msg||msg.jsonrpc!=="2.0")return;calls.push(msg);
        const frame=document.querySelector("iframe").contentWindow;
        if(msg.method==="ui/initialize"&&!${legacy})frame.postMessage({jsonrpc:"2.0",id:msg.id,result:{protocolVersion:"2026-01-26",hostCapabilities:{serverTools:{},openLinks:{}},hostContext:{displayMode:"inline"}}},"https://mso-ui.rahmanef.com");
        if(msg.method==="ui/notifications/initialized"){
          frame.postMessage({jsonrpc:"2.0",method:"ui/notifications/tool-input",params:{arguments:{route:result.route}}},"https://mso-ui.rahmanef.com");
          frame.postMessage({jsonrpc:"2.0",method:"ui/notifications/tool-result",params:{structuredContent:result}},"https://mso-ui.rahmanef.com");
        }
        if(msg.method==="ui/notifications/size-changed")document.querySelector("iframe").style.height=msg.params.height+"px";
        if(msg.method==="ui/open-link")frame.postMessage({jsonrpc:"2.0",id:msg.id,result:{}},"https://mso-ui.rahmanef.com");
      });</script><iframe src="https://mso-ui.rahmanef.com/qa" style="width:100%;height:740px"></iframe>` }));
    await page.goto("https://chatgpt.com/qa");
    const component = page.frameLocator('iframe[src="https://mso-ui.rahmanef.com/qa"]');
    await component.locator('.frame-wrap[data-state="loading"]').waitFor();
    assert.equal(childLoads, 1); assertions++;
    const widget = page.frames().find((frame) => frame.url() === "https://mso-ui.rahmanef.com/qa");
    const game = page.frames().find((frame) => frame.url() === "https://game.rahmanef.com/embed");
    assert(widget && game);
    if (!legacy) {
      const calls = await page.evaluate(() => window.calls);
      assert.equal(calls[0].method, "ui/initialize");
      assert.equal(calls[0].params.appInfo.name, "MSO Page");
      assert.deepEqual(calls[0].params.appCapabilities.availableDisplayModes, ["inline", "fullscreen", "pip"]);
      assert(calls.some((call) => call.method === "ui/notifications/initialized")); assertions++;
    }
    await widget.evaluate(() => window.dispatchEvent(new MessageEvent("message", { origin: "https://game.rahmanef.com", source: window, data: { type: "play-together:embed-ready", schemaVersion: 1 } })));
    assert.equal(await component.locator(".frame-wrap").getAttribute("data-state"), "loading"); assertions++;
    await game.evaluate(() => parent.postMessage({ type: "play-together:embed-ready", schemaVersion: 99 }, "https://mso-ui.rahmanef.com"));
    assert.equal(await component.locator(".frame-wrap").getAttribute("data-state"), "loading"); assertions++;
    await page.clock.fastForward(13000);
    await component.locator('.frame-wrap[data-state="unavailable"]').waitFor();
    await component.getByRole("button", { name: "Retry preview" }).click();
    await component.locator('.frame-wrap[data-state="loading"]').waitFor();
    await page.waitForTimeout(50);
    const reloaded = page.frames().find((frame) => frame.url() === "https://game.rahmanef.com/embed");
    assert(reloaded); assertions++;
    await reloaded.evaluate(() => parent.postMessage({ type: "play-together:embed-ready", schemaVersion: 1 }, "https://mso-ui.rahmanef.com"));
    await component.locator('.frame-wrap[data-state="ready"]').waitFor(); assertions++;
    const previousLoads = childLoads;
    await page.evaluate(() => document.querySelector("iframe").contentWindow.postMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: window.result } }, "https://mso-ui.rahmanef.com"));
    await widget.evaluate(() => window.dispatchEvent(new Event("openai:set_globals")));
    await page.waitForTimeout(50);
    assert.equal(childLoads, previousLoads, "Unchanged results and host globals must not restart the game"); assertions++;
    if (!legacy) {
      await component.getByRole("button", { name: "Open production" }).click();
      assert((await page.evaluate(() => window.calls)).some((call) => call.method === "ui/open-link" && call.params.url === "https://game.rahmanef.com")); assertions++;
    }
    const authAction = component.getByRole("button", { name: "Google login in browser", exact: true });
    await authAction.waitFor();
    const opensBeforeAuth = (await page.evaluate(() => window.calls)).filter(call => call.method === "ui/open-link").length;
    await reloaded.evaluate(() => parent.postMessage({ type: "mso:app-auth-request", schemaVersion: 1, provider: "google" }, "*"));
    await page.waitForTimeout(50);
    assert.equal((await page.evaluate(() => window.calls)).filter(call => call.method === "ui/open-link").length, opensBeforeAuth, "Nested messages must not trigger external navigation"); assertions++;
    if (!legacy) {
      await authAction.click();
      assert((await page.evaluate(() => window.calls)).some(call => call.method === "ui/open-link" && call.params.url === "https://game.rahmanef.com/?auth=google")); assertions++;
    }
    console.log(`PASS ${legacy ? "legacy wrapped toolOutput / mobile" : "pure MCP Apps host / desktop"}: init, source validation, timeout, retry, ready, no repeated reload`);
    await page.close();
  }
  console.log(`MCP Page browser checks: ${assertions} assertions passed`);
} finally { await browser.close(); }
