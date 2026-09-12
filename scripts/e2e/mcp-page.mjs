#!/usr/bin/env node
// Browser contract for responsive native views and registry-reviewed sandboxed demos.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";
import path from "node:path";
import { mkdir, chmod } from "node:fs/promises";

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
    renderer: "iframe",
    presentation: "inline",
    environment: "production",
    reason: "External apps use the remote-browser seam so the ChatGPT Page stays free of nested external iframes.",
    url: "https://game.example.com/embed",
  },
};

assert.equal(resource.uri, "ui://mso/page-v15.html");
assert.deepEqual(resource._meta.ui.csp.frameDomains, [registry[0].origin]);
assert.deepEqual(resource._meta["openai/widgetCSP"].frame_domains, [registry[0].origin]);
assert(resource.text.includes('el("iframe","preview-frame")'));
assert(!resource.text.includes("mountReviewedFrame"));
assert(resource.text.includes('"renderer":"iframe"'));

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

    await page.route("https://game.example.com/embed",route=>route.fulfill({contentType:"text/html",body:'<!doctype html><html lang="en"><title>Demo</title><button onclick="this.textContent=Number(this.textContent)+1">0</button></html>'}));
    await page.goto("https://chatgpt.com/qa");
    const component = page.frameLocator('iframe[src="https://mso-ui.example.com/qa"]');
    const demo=component.frameLocator("iframe");await demo.getByRole("button",{name:"0",exact:true}).click();
    await demo.getByRole("button",{name:"1",exact:true}).waitFor();assertions++;
    assert.equal(await component.locator("iframe").getAttribute("sandbox"),registry[0].sandbox);assertions++;
    assert.equal(await component.locator("iframe").getAttribute("referrerpolicy"),"no-referrer");assertions++;
    assert.equal(await component.locator("iframe").getAttribute("src"),output.app.url);assertions++;
    assert.equal(await component.locator("#open").getAttribute("data-mso-path"),"/browser");assertions++;
    console.log(`PASS reviewed interactive demo ${viewport.width}x${viewport.height}`);
    await page.close();
  }
  // Reproduce a small initial host frame with legacy maxHeight=200. Standard
  // containerDimensions must win and resize it to the complete work area.
  const snapshot={user:"studio",users:[{id:"studio",label:"Studio",isDefault:true}],connections:[],bindings:[]};
  const integrationOutput={route:"/integrations",kind:"integrations",title:"Integrations",openPath:"/integrations",integrations:snapshot};
  const context=await browser.newContext({viewport:{width:768,height:900}});
  const page=await context.newPage();
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.route("https://mso-ui.example.com/qa",route=>route.fulfill({contentType:"text/html",body:`<!doctype html><script>window.openai={maxHeight:200,theme:"light",toolOutput:${JSON.stringify({structuredContent:integrationOutput})}}</script>${resource.text}`}));
  await page.route("https://chatgpt.com/qa",route=>route.fulfill({contentType:"text/html",body:`<!doctype html><html lang="en"><title>MSO host test</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#171717}iframe{display:block;border:0;width:100%;height:140px}</style><script>
  window.hostContext={theme:"dark",displayMode:"inline",availableDisplayModes:["inline","fullscreen"],containerDimensions:{maxHeight:680}};
  window.addEventListener("message",event=>{
    const m=event.data;if(!m||m.jsonrpc!=="2.0")return;
    const frame=document.querySelector("iframe");if(event.origin!=="https://mso-ui.example.com"||event.source!==frame.contentWindow)return;let result;
    if(m.method==="ui/initialize")result={protocolVersion:"2026-01-26",hostContext:window.hostContext};
    else if(m.method==="ui/notifications/size-changed"){window.lastSize=m.params;frame.style.height=m.params.height+"px";return}
    else if(m.method==="ui/request-display-mode"){window.hostContext.displayMode=m.params.mode;frame.style.height=m.params.mode==="fullscreen"?"900px":"680px";result={mode:m.params.mode}}
    else if(m.method==="tools/call"){
      window.lastTool=m.params;const name=m.params.name,args=m.params.arguments;
      let data=${JSON.stringify(snapshot)};
      if(name==="render_mso_page")data={route:args.route,kind:args.route.slice(1),title:args.route.slice(1),project:args.project,openPath:"/assistant/mcp"};
      if(name==="vps_status")data={health:{cpu:{pct:12,cores:4},mem:{used:32,total:100},disk:{used:44,total:100}},apps:[]};
      if(name==="agent_sessions_list")data=[{id:"session-fixture",title:"Delivery session",source:"mcp"}];
      if(name==="session_artifacts")data={artifacts:[{id:"asset-fixture",filename:"Preview image",mimeType:"image/png",bytes:12}]};
      result={structuredContent:{result:data}};
    }
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
  for(const width of [280,320,390,736,1280]){
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
  const saveScreenshot=async name=>{const file=path.join(imageDir,name);await page.locator("iframe").screenshot({path:file});await chmod(file,0o600)};
  if(imageDir){await mkdir(imageDir,{recursive:true});await saveScreenshot("mso-page-integrations.png")}
  await setContext({theme:"light",containerDimensions:{height:200},styles:{variables:{"--font-family":"system-ui","--font-text-md-size":"18px","--font-text-sm-size":"16px","--border-radius-sm":"3px","--color-background-primary":"#ffffff","--color-text-primary":"#151515"}}});
  await page.setViewportSize({width:320,height:900});
  assert(await body.evaluate(el=>el.clientHeight>=130),"tiny embed keeps a usable scroll area");assertions++;
  assert.equal(await component.getByRole("combobox",{name:"Service",exact:true}).evaluate(el=>getComputedStyle(el).fontSize),"16px");assertions++;
  assert.equal(await component.getByRole("combobox",{name:"Service",exact:true}).evaluate(el=>getComputedStyle(el).borderRadius),"3px");assertions++;
  await component.getByRole("combobox",{name:"Service",exact:true}).selectOption("cloudflare");
  await component.getByRole("heading",{name:"Cloudflare",exact:true}).waitFor();assertions++;
  if(imageDir)await saveScreenshot("mso-page-320x200.png");
  await component.getByRole("combobox",{name:"MSO page",exact:true}).selectOption("/monitor");
  for(const metric of ["12%","32%","44%"]){await component.getByText(metric,{exact:true}).waitFor();assertions++}
  await component.getByRole("combobox",{name:"MSO page",exact:true}).selectOption("/sessions");
  await component.getByText("Delivery session",{exact:true}).waitFor();assertions++;
  await component.getByRole("combobox",{name:"MSO page",exact:true}).selectOption("/assets");
  await component.getByText("Preview image",{exact:true}).waitFor();assertions++;
  await component.getByRole("combobox",{name:"MSO page",exact:true}).selectOption("/integrations");
  await setContext({theme:"dark",containerDimensions:{height:680},styles:{variables:{}}});
  await page.setViewportSize({width:736,height:900});
  await component.getByRole("button",{name:"Add MCP",exact:true}).click();
  await component.getByRole("heading",{name:"Add MCP to project",exact:true}).waitFor();
  if(imageDir)await saveScreenshot("mso-page-add-mcp.png");
  const audit=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze();
  assert.deepEqual(audit.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[]);assertions++;
  assert.deepEqual(errors,[]);assertions++;
  await page.close();
  console.log(`MCP Page browser checks: ${assertions} assertions passed (full height, host resize, theme, mobile, logo, Add MCP, fullscreen)`);
} finally {
  await browser.close();
}
