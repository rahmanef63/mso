#!/usr/bin/env node
// Browser contract for the iframe-free ChatGPT MSO Page external-app handoff.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";
import path from "node:path";
import { mkdir } from "node:fs/promises";

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

assert.equal(resource.uri, "ui://mso/page-v14.html");
assert.equal(resource._meta.ui.csp.frameDomains, undefined);
assert.equal(resource._meta["openai/widgetCSP"].frame_domains, undefined);
assert(!resource.text.includes('createElement("iframe")'));
assert(!resource.text.includes("mountReviewedFrame"));
assert(resource.text.includes('"renderer":"remote"'));

const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
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
  // Reproduce a small initial host frame with legacy maxHeight=200. Standard
  // containerDimensions must win and resize it to the complete work area.
  const snapshot={user:"studio",users:[{id:"studio",label:"Studio",isDefault:true}],connections:[],bindings:[]};
  const integrationOutput={route:"/integrations",kind:"integrations",title:"Integrations",openPath:"/integrations",integrations:snapshot};
  const page=await browser.newPage({viewport:{width:768,height:900}});
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.route("https://mso-ui.example.com/qa",route=>route.fulfill({contentType:"text/html",body:`<!doctype html><script>window.openai={maxHeight:200,theme:"light",toolOutput:${JSON.stringify({structuredContent:integrationOutput})}}</script>${resource.text}`}));
  await page.route("https://chatgpt.com/qa",route=>route.fulfill({contentType:"text/html",body:`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#171717}iframe{display:block;border:0;width:100%;height:140px}</style><script>
  window.hostContext={theme:"dark",displayMode:"inline",availableDisplayModes:["inline","fullscreen"],containerDimensions:{maxHeight:680}};
  window.addEventListener("message",event=>{
    const m=event.data;if(!m||m.jsonrpc!=="2.0")return;
    const frame=document.querySelector("iframe");if(event.origin!=="https://mso-ui.example.com"||event.source!==frame.contentWindow)return;let result;
    if(m.method==="ui/initialize")result={protocolVersion:"2026-01-26",hostContext:window.hostContext};
    else if(m.method==="ui/notifications/size-changed"){window.lastSize=m.params;frame.style.height=m.params.height+"px";return}
    else if(m.method==="ui/request-display-mode"){window.hostContext.displayMode=m.params.mode;frame.style.height=m.params.mode==="fullscreen"?"900px":"680px";result={mode:m.params.mode}}
    else if(m.method==="tools/call")result={structuredContent:{result:${JSON.stringify(snapshot)}}};
    else return;
    if(m.id!==undefined)event.source.postMessage({jsonrpc:"2.0",id:m.id,result},"https://mso-ui.example.com");
  });
  </script><iframe title="MSO Page" src="https://mso-ui.example.com/qa"></iframe></html>`}));
  await page.goto("https://chatgpt.com/qa");
  const component=page.frameLocator("iframe"),surface=component.locator(".surface"),body=component.locator("#surface-body");
  await component.getByRole("button",{name:"Add MCP",exact:true}).waitFor();
  await page.waitForFunction(()=>window.lastSize?.height===680);
  assert.equal(await surface.evaluate(el=>el.getBoundingClientRect().height),680);assertions++;
  assert.equal(await component.locator("html").getAttribute("data-theme"),"dark");assertions++;
  assert.equal(await component.locator(".brand svg").count(),1);assertions++;
  assert.equal(await component.locator("#surface-pip").isVisible(),false);assertions++;
  assert(await body.evaluate(el=>el.clientHeight>580),"work area must not collapse to the heading");assertions++;
  for(const width of [320,390,736,1280]){
    await page.setViewportSize({width,height:900});
    assert(await component.locator("html").evaluate(el=>el.scrollWidth<=innerWidth+1),"no horizontal overflow at "+width);assertions++;
    assert.equal(Math.round(await surface.evaluate(el=>el.getBoundingClientRect().height)),680);assertions++;
  }
  await page.setViewportSize({width:736,height:900});
  await component.getByRole("button",{name:"Fullscreen",exact:true}).click();
  await component.getByRole("button",{name:"Exit fullscreen",exact:true}).waitFor();
  assert.equal(await surface.evaluate(el=>el.getBoundingClientRect().height),900);assertions++;
  await component.getByRole("button",{name:"Exit fullscreen",exact:true}).click();
  await component.getByRole("button",{name:"Fullscreen",exact:true}).waitFor();
  const setContext=async context=>{
    await page.evaluate(context=>{window.hostContext={...window.hostContext,...context};document.querySelector("iframe").contentWindow.postMessage({jsonrpc:"2.0",method:"ui/notifications/host-context-changed",params:context},"https://mso-ui.example.com")},context);
    await page.waitForFunction(height=>window.lastSize?.height===height,context.containerDimensions.height??context.containerDimensions.maxHeight);
  };
  await setContext({theme:"light",containerDimensions:{height:720}});
  assert.equal(await surface.evaluate(el=>el.getBoundingClientRect().height),720);assertions++;
  assert.equal(await component.locator("html").getAttribute("data-theme"),"light");assertions++;
  await setContext({theme:"dark",containerDimensions:{maxHeight:680}});
  const imageDir=process.env.MSO_SCREENSHOT_DIR;
  if(imageDir){await mkdir(imageDir,{recursive:true});await page.locator("iframe").screenshot({path:path.join(imageDir,"mso-page-integrations.png")})}
  await component.getByRole("button",{name:"Add MCP",exact:true}).click();
  await component.getByRole("heading",{name:"Add MCP to project",exact:true}).waitFor();
  if(imageDir)await page.locator("iframe").screenshot({path:path.join(imageDir,"mso-page-add-mcp.png")});
  assert.deepEqual(errors,[]);assertions++;
  await page.close();
  console.log(`MCP Page browser checks: ${assertions} assertions passed (full height, host resize, theme, mobile, logo, Add MCP, fullscreen)`);
} finally {
  await browser.close();
}
