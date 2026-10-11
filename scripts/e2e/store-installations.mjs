#!/usr/bin/env node
// Fresh defaults and UI installs use generated owner state, never deployment data.
import { chromium, firefox, webkit, expect as assertion } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { releaseFixture } from './release-fixture.mjs';

const expect = assertion.configure({ timeout: 15000 });
const engine = process.argv[2] ?? 'chromium';
if (!['chromium', 'firefox', 'webkit'].includes(engine)) throw new Error('Unknown browser');
const output = process.env.MSO_SCREENSHOT_DIR;
const fixture = await releaseFixture({live:true});
const results = []; let browser;
// Observe native fetch completion in the active document; SDK cache events can outlive it.
async function settle(page) {
  await expect.poll(() => page.evaluate(() => window.qaPendingFetches?.size ?? 0)).toBe(0);
}
const shells = ['macos', 'windows', 'dashboard', 'ios', 'android'];
const mobile = shell => ['ios', 'android'].includes(shell);
const viewport = shell => mobile(shell) ? {width:390,height:844} : {width:1363,height:936};
const card = (page, title) => page.getByRole('tabpanel').getByRole('article', {name:`${title} app`,exact:true});
const installed = entry => entry.getByRole('button', {name:/^(Installed|Uninstall)$/});
async function screenshot(page, name) {
  if (!output) return;
  await mkdir(output, {recursive:true, mode:0o700});
  await page.screenshot({path:path.join(output,`${engine}-${name}.png`),animations:'disabled'});
}
async function track(context) {
  // Playwright routing disables HTTP cache, giving completed request events on reload.
  await context.route('**/*', route => route.continue());
  await context.addInitScript(() => {
    const nativeFetch = window.fetch;
    const pending = window.qaPendingFetches = new Set();
    window.fetch = (...args) => {
      const promise = nativeFetch(...args);
      const url = new URL(args[0] instanceof Request ? args[0].url : String(args[0]), location.href);
      if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
        pending.add(promise);
        void promise.then(response => response.clone().arrayBuffer()).then(() => pending.delete(promise), () => pending.delete(promise));
      }
      return promise;
    };
  });
}
async function switchShell(page, shell) {
  await page.setViewportSize(viewport(shell));
  await page.evaluate(({shell, isMobile}) => localStorage.setItem('sv:shell',JSON.stringify({desktop:isMobile?'macos':shell,mobile:isMobile?shell:'ios'})), {shell,isMobile:mobile(shell)});
  await settle(page);await page.reload();
  await expect(page.locator(`[data-shell="${shell}"]`)).toBeVisible();
}
try {
  const response=await fetch(fixture.base+'/api/auth/login',{method:'POST',headers:{origin:fixture.base,'content-type':'application/json'},body:JSON.stringify({password:fixture.password,deviceId:fixture.device,deviceLabel:'Synthetic Store QA'})});
  expect(response.ok).toBe(true);
  const cookie=/(?:^|,\s*)session=([^;]+)/.exec(response.headers.get('set-cookie')??'')?.[1]; expect(cookie).toBeTruthy();
  browser=await ({chromium,firefox,webkit})[engine].launch({headless:true});
  const sentinel=path.join(fixture.dir,'fixture.txt'), original=await readFile(sentinel,'utf8');
  for (const initialShell of shells) {
    const context=await browser.newContext({viewport:viewport(initialShell),deviceScaleFactor:mobile(initialShell)?3:2,hasTouch:mobile(initialShell),serviceWorkers:'block'});
    await track(context);
    await context.addCookies([{name:'session',value:cookie,url:fixture.base,sameSite:'Strict'}]);
    await context.addInitScript(({shell,isMobile})=>{
      if (window !== window.top || !["http:", "https:"].includes(location.protocol)) return;
      if (!localStorage.getItem('sv:shell')) localStorage.setItem('sv:shell',JSON.stringify({desktop:isMobile?'macos':shell,mobile:isMobile?shell:'ios'}));
      localStorage.setItem('mso:onboarding:v1','done');
    },{shell:initialShell,isMobile:mobile(initialShell)});
    const page=await context.newPage(), errors=[];
    context.on('page', p=>p.on('pageerror',error=>errors.push(error.message))); page.on('pageerror',error=>errors.push(error.message));
    await settle(page);await page.goto(fixture.base);await expect(page.locator(`[data-shell="${initialShell}"]`)).toBeVisible();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mso:quicklinks") ?? "null"))).toEqual([]);
    await screenshot(page,`${initialShell}-essentials-home`);
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox',{name:'Spotlight search'}).fill('Agent Vault');
    await expect(page.getByRole('option').filter({hasText:'Agent Vault'})).toHaveCount(0);
    await page.keyboard.press('Escape');
    await settle(page);await page.goto(fixture.base+'/store');
    await expect(page.getByRole('tab',{name:'Apps',exact:true})).toHaveAttribute('aria-selected','true');
    const panel=page.getByRole('tabpanel'), cards=panel.getByRole('article');
    await expect(cards).toHaveCount(27);
    if (mobile(initialShell)) await expect(page.getByRole('button',{name:'Apps',exact:true})).toBeInViewport({ratio:1});
    await expect(panel.getByRole('button',{name:/^(Installed|Uninstall)$/})).toHaveCount(6);
    await expect(panel.getByRole('button',{name:'Required',exact:true})).toBeDisabled();
    await expect(card(page,'Camoufox')).toBeVisible(); await expect(installed(card(page,'Hermes'))).toBeVisible();
    await expect(card(page,'Agent Vault').getByRole('button',{name:'Install',exact:true})).toBeVisible();
    const n8n=card(page,'n8n');
    await expect.poll(()=>n8n.locator('img').evaluate(img=>img.complete && img.naturalWidth>0)).toBe(true);
    await expect(n8n.locator('img')).toHaveAttribute('src','/brand/official/n8n.svg');
    await screenshot(page,`${initialShell}-native-catalog`);
    const a11y=await new AxeBuilder({page}).include('[role="tabpanel"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    expect(a11y.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}))).toEqual([]);
    await n8n.getByRole('button',{name:'Install',exact:true}).focus();await page.keyboard.press('Enter');await expect(installed(n8n)).toBeVisible();
    // Change only presentation; all five shells read the same install record.
    for (const shell of shells) {
      await switchShell(page,shell);await expect(installed(card(page,'n8n'))).toBeVisible();
      expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('mso:enabled:v1')).n8n)).toBe(true);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    }
    await page.setViewportSize({width:844,height:390});await settle(page);await page.reload();
    await expect(installed(card(page,'n8n'))).toBeVisible();await screenshot(page,`${initialShell}-shared-landscape`);
    const other=await context.newPage();await settle(other);await other.goto(fixture.base+'/store');await expect(installed(card(other,'n8n'))).toBeVisible();
    await installed(card(page,'n8n')).click();
    const confirm=page.getByRole('dialog');await expect(confirm.getByText('Your data stays on disk. You can reinstall any time.')).toBeVisible();
    await confirm.getByRole('button',{name:'Cancel',exact:true}).click();await expect(installed(card(page,'n8n'))).toBeVisible();
    await installed(card(page,'n8n')).click();await confirm.getByRole('button',{name:'Uninstall',exact:true}).click();
    await expect(card(other,'n8n').getByRole('button',{name:'Install',exact:true})).toBeVisible();
    expect(await readFile(sentinel,'utf8')).toBe(original);await settle(other);expect(other.isClosed()).toBe(false);
    await settle(page);await page.reload();await expect(card(page,'n8n').getByRole('button',{name:'Install',exact:true})).toBeVisible();
    await switchShell(page,initialShell);
    // Replacing a document with pending telemetry can produce native WebKit diagnostics; keep raw stress evidence separately.
    const requests=[];page.on('request',r=>requests.push(new URL(r.url()).pathname));
    await settle(page);await page.goto(fixture.base+'/n8n');await expect(page.getByText('n8n is not installed.',{exact:true})).toBeVisible();
    await expect(page.locator('[data-slot="n8n-feature"]')).toHaveCount(0);expect(requests.includes('/api/v1/workflow-embeds')).toBe(false);
    await screenshot(page,`${initialShell}-uninstalled-deep-link`);
    await page.getByRole('button',{name:'Open App Store',exact:true}).click();
    await expect(page.getByPlaceholder('Search apps')).toHaveValue('n8n');
    await card(page,'n8n').getByRole('button',{name:'Install',exact:true}).click();
    await settle(page);await page.goto(fixture.base+'/n8n');await expect(page.locator('[data-slot="n8n-feature"]')).toBeVisible();
    // Keep the observing tab alive through reload; forced driver-close diagnostics are audited separately.
    await expect(installed(card(other,'n8n'))).toBeVisible();expect(errors).toEqual([]);await context.close();
    results.push({engine,initialShell,dpr:mobile(initialShell)?3:2,freshEssentials:7,freshQuicklinks:0,catalog:27,switches:5,crossTab:'PASS',reload:'PASS',keyboard:'PASS',landscape:'PASS',uninstalledLazyLoad:'PASS',a11y:'PASS',sentinel:'PASS'});
    console.log(`PASS ${engine}/${initialShell}: seven defaults, complete catalog, all-shell install, cross-tab/reload, guarded removal, lazy deep link and accessibility`);
  }
  // A remote menu removal preserves a running editor until its draft is saved.
  const draftFile=path.join(fixture.dir,'synthetic-draft.txt'), originalDraft='Generated draft fixture.\n', draft='Generated edited draft, no user content.\n';
  await writeFile(draftFile,originalDraft,{mode:0o600});
  for (const draftShell of shells) {
  await writeFile(draftFile,originalDraft,{mode:0o600});
  const context=await browser.newContext({viewport:viewport(draftShell),deviceScaleFactor:mobile(draftShell)?3:2,serviceWorkers:'block'});
  const savedLinks=[{id:'generated',title:'Generated cached shortcut',url:'about:blank'}];
  await context.addInitScript(links=>{
    if (window===window.top && ['http:','https:'].includes(location.protocol) && !localStorage.getItem('mso:quicklinks')) localStorage.setItem('mso:quicklinks',JSON.stringify(links));
  },savedLinks);
  // Omit the server section to exercise the unchanged cached-shortcut restore path.
  await context.route('**/api/prefs',route=>route.request().method()==='GET'?route.fulfill({json:{}}):route.continue());
  await track(context);
  await context.addCookies([{name:'session',value:cookie,url:fixture.base,sameSite:'Strict'}]);
  await context.addInitScript(()=>{if (['http:','https:'].includes(location.protocol) && window===window.top) localStorage.setItem('mso:onboarding:v1','done');});
  const editor=await context.newPage();await settle(editor);await editor.goto(fixture.base+'/store');await switchShell(editor,draftShell);
  await card(editor,'Code').getByRole('button',{name:'Install',exact:true}).click();
  await settle(editor);await editor.goto(fixture.base+'/code'+draftFile);const textarea=editor.locator('textarea').first();
  await expect.poll(()=>editor.evaluate(()=>JSON.parse(localStorage.getItem('mso:quicklinks')))).toEqual(savedLinks);
  await expect(textarea).toHaveValue(originalDraft);await textarea.fill(draft);
  const remote=await context.newPage();await settle(remote);await remote.goto(fixture.base+'/store');
  await installed(card(remote,'Code')).click();await remote.getByRole('dialog').getByRole('button',{name:'Uninstall',exact:true}).click();
  await expect.poll(()=>editor.evaluate(()=>JSON.parse(localStorage.getItem('mso:enabled:v1'))['code-editor'])).toBe(false);
  await expect(textarea).toHaveValue(draft);expect(await readFile(draftFile,'utf8')).toBe(originalDraft);
  await screenshot(editor,`${draftShell}-cross-tab-draft-preserved`);
  await textarea.focus();await textarea.press('Control+s');
  await expect.poll(()=>readFile(draftFile,'utf8')).toBe(draft);
  await settle(editor);await editor.reload();await expect(editor.getByText('Code is not installed.',{exact:true})).toBeVisible();
  expect(await editor.evaluate(()=>JSON.parse(localStorage.getItem('mso:quicklinks')))).toEqual(savedLinks);
  await context.close();results.push({engine,draftShell,cachedShortcuts:'PASS',crossTabDraft:'PASS',saveAfterMenuRemoval:'PASS',newMountRequiresInstall:'PASS'});
  }
  const runtimeContext=await browser.newContext({viewport:{width:1363,height:936},serviceWorkers:'block'});
  await track(runtimeContext);
  await runtimeContext.addCookies([{name:'session',value:cookie,url:fixture.base,sameSite:'Strict'}]);
  const runtimeEntry='https://excalidraw.com';
  await writeFile(path.join(fixture.dir,'surface-apps.json'),JSON.stringify([{id:'synthetic-connection',title:'Synthetic connection',description:'Generated reviewed fixture',origin:'https://excalidraw.com',startPath:'/',renderer:'iframe',presentation:'inline',environment:'production',placements:['shell'],sandbox:'allow-scripts allow-same-origin allow-forms'}]),{mode:0o600});
  await runtimeContext.route('https://excalidraw.com/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><label>Generated draft<input aria-label="Generated draft"></label></body></html>'}));
  await runtimeContext.addInitScript(entry=>{
    if (window!==window.top || !['http:','https:'].includes(location.protocol) || localStorage.getItem('mso:apps')) return;
    localStorage.setItem('mso:onboarding:v1','done');
    localStorage.setItem('mso:apps',JSON.stringify([{appId:'siteforge',title:'SiteForge',glyph:'code',gradient:'gray',runtime:'html',entry,source:'store',installed:true}]));
  },runtimeEntry);
  const running=await runtimeContext.newPage();await settle(running);await running.goto(fixture.base+'/siteforge');
  const input=running.frameLocator('iframe').getByLabel('Generated draft');await input.fill('Generated unsaved value');
  const store=await runtimeContext.newPage();await settle(store);await store.goto(fixture.base+'/store');
  await store.getByRole('button',{name:'Featured',exact:true}).click();
  const runtimePanel=store.getByRole('tabpanel');
  await expect(runtimePanel.getByText('SiteForge',{exact:true})).toHaveCount(2);
  await installed(runtimePanel).last().click();await store.getByRole('dialog').getByRole('button',{name:'Uninstall',exact:true}).click();
  await expect.poll(()=>running.evaluate(()=>JSON.parse(localStorage.getItem('mso:apps'))[0].installed)).toBe(false);
  await expect(input).toHaveValue('Generated unsaved value');
  expect(await running.evaluate(()=>JSON.parse(localStorage.getItem('mso:apps'))[0].entry)).toBe(runtimeEntry);
  await screenshot(running,'runtime-draft-preserved');await settle(running);await running.reload();
  await expect(running.getByText('SiteForge is not installed.',{exact:true})).toBeVisible();
  await runtimeContext.close();results.push({engine,runtimeCrossTab:'PASS',runtimeDraft:'PASS',runtimeSourcePreserved:'PASS'});
  if (output) await writeFile(path.join(output,`${engine}-store-results.json`),JSON.stringify({synthetic:true,results},null,2),{mode:0o600});
} finally {await browser?.close();await fixture.close();}
