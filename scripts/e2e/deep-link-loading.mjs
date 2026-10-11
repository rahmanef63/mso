#!/usr/bin/env node
// Cold deep links use only synthetic owner state and never warm unrelated apps.
import fs from 'node:fs';
import path from 'node:path';
import { chromium, expect as assertion } from '@playwright/test';
import { releaseFixture, installFixtureApps } from './release-fixture.mjs';
const expect = assertion.configure({ timeout: 15000 });
const chunks = new Map(fs.readdirSync('.next/static/chunks').filter(file => file.endsWith('.js'))
  .map(file => [file, fs.readFileSync(path.join('.next/static/chunks', file), 'utf8')]));
const vaultFiles = new Set([...chunks].filter(([, text]) => text.includes('Repository knowledge and recorded progress')).map(([file]) => file));
expect(vaultFiles.size).toBeGreaterThan(0);
const heavy = ['react-flow__renderer', 'Konva error', 'xterm-screen', 'ort-wasm-simd-threaded'];
const fixture = await releaseFixture({ live: true });
let browser;
try {
  const response = await fetch(fixture.base + '/api/auth/login', { method: 'POST', headers: { origin: fixture.base, 'content-type': 'application/json' }, body: JSON.stringify({ password: fixture.password, deviceId: fixture.device, deviceLabel: 'Synthetic deep-link QA' }) });
  expect(response.ok).toBe(true);
  const cookie = /(?:^|,\s*)session=([^;]+)/.exec(response.headers.get('set-cookie') ?? '')?.[1];
  expect(cookie).toBeTruthy();
  browser = await chromium.launch({ headless: true });
  for (const [shell, dpr] of [['macos', 2], ['windows', 2], ['dashboard', 1], ['ios', 3], ['android', 3], ['ios', 4]]) {
    const mobile = ['ios', 'android'].includes(shell);
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, serviceWorkers: 'block', deviceScaleFactor: dpr });
    await installFixtureApps(context, ["agent-vault"]);
    await context.addCookies([{ name: 'session', value: cookie, url: fixture.base, sameSite: 'Strict' }]);
    await context.addInitScript(({ shell, mobile, device }) => {
      localStorage.setItem('mso.device.id', device);
      localStorage.setItem('mso:onboarding:v1', 'done');
      localStorage.setItem('sv:shell', JSON.stringify({ desktop: mobile ? 'macos' : shell, mobile: mobile ? shell : 'ios' }));
    }, { shell, mobile, device: fixture.device });
    const page = await context.newPage(), requests = [], errors = [];
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    page.on('request', request => requests.push(new URL(request.url()).pathname));
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(fixture.base + '/agent-vault', { waitUntil: 'domcontentloaded' });
    await expect(page.locator(`#main-content[data-shell="${shell}"]`)).toBeVisible();
    await expect(page.locator('[data-slot="native-vault"]')).toBeVisible();
    if (mobile) {
      expect(requests.filter(url => url.startsWith('/app-icons/'))).toEqual([]);
      expect(await page.evaluate(() => {
        const home = [...document.querySelectorAll('[inert][aria-hidden="true"]')].find(el => el.className.includes('shell-platform-mark_img'));
        return home && [...home.querySelectorAll('.shell-platform-mark img')].every(img => getComputedStyle(img).display === 'none');
      })).toBe(true);
      await page.getByRole('button', {name:'Back to Home',exact:true}).click();
    }
    await expect.poll(() => requests.findIndex(url => url.startsWith('/app-icons/'))).toBeGreaterThan(-1);
    const vaultIndex = requests.findIndex(url => vaultFiles.has(url.split('/').at(-1)));
    expect(vaultIndex).toBeGreaterThan(-1);
    expect(vaultIndex).toBeLessThan(requests.findIndex(url => url.startsWith('/app-icons/')));
    expect(requests.filter(url => heavy.some(marker => chunks.get(url.split('/').at(-1))?.includes(marker)))).toEqual([]);
    // Lazy artwork outside the viewport need not load; visible icons must decode at sufficient density.
    await expect.poll(() => page.locator('.shell-platform-mark img').evaluateAll(images => {
      const visible = images.filter(image => { const r = image.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && getComputedStyle(image).visibility !== 'hidden'; });
      return visible.length > 0 && visible.every(image => {
        const full = image.src.includes('/macos/') || image.src.includes('/windows/') ? 256 : 192;
        const pixels = image.currentSrc.endsWith('-128.webp') ? 128 : full;
        return image.complete && image.naturalWidth > 0 && pixels >= Math.min(full, image.getBoundingClientRect().width * devicePixelRatio);
      });
    })).toBe(true);
    if (!mobile && shell !== 'dashboard') await expect.poll(() => page.locator('.shell-platform-mark img').evaluateAll(images => images.some(image => image.getBoundingClientRect().width > 0 && image.currentSrc.endsWith('-128.webp') && image.complete))).toBe(true);
    if (mobile) expect(requests.filter(url => url.startsWith('/app-icons/') && url.endsWith('-128.webp'))).toEqual([]);
    if (mobile) expect(requests.filter(url => /\/app-icons\/(macos|windows)\/.+\.avif$/.test(url)).length).toBeGreaterThan(0);
    // Exercise the shared mark at larger sizes and the conservative fallback for browsers without auto sizing.
    await page.evaluate(() => {
      const mark = document.querySelector('.shell-platform-mark').cloneNode(true);
      mark.id = 'qa-artwork-size'; mark.style.cssText = 'position:fixed;left:0;top:40px;width:160px;height:160px;z-index:9999';
      document.body.appendChild(mark);
    });
    const enlarged = page.locator('#qa-artwork-size img');
    await expect.poll(() => enlarged.evaluate(image => image.complete && image.naturalWidth > 0 && !image.currentSrc.endsWith('-128.webp'))).toBe(true);
    await enlarged.evaluate(image => { image.parentElement.style.width = '24px'; image.parentElement.style.height = '24px'; image.sizes = '256px'; });
    await expect.poll(() => enlarged.evaluate(image => image.complete && image.naturalWidth > 0 && !image.currentSrc.endsWith('-128.webp'))).toBe(true);
    await enlarged.evaluate(image => image.parentElement.querySelectorAll('[type="image/avif"]').forEach(source => { source.type = 'image/qa-unsupported'; }));
    await expect.poll(() => enlarged.evaluate(image => image.complete && image.naturalWidth > 0 && image.currentSrc.endsWith('.webp') && !image.currentSrc.endsWith('-128.webp'))).toBe(true);
    await page.locator('#qa-artwork-size').evaluate(mark => mark.remove());
    if (shell === 'macos') {
      const dockIcon = page.locator('a[href="/files"].relative.block').filter({ has: page.locator('.shell-platform-mark') });
      await dockIcon.hover();
      await expect.poll(() => dockIcon.locator('img').evaluate(image => {
        const pixels = image.currentSrc.endsWith('-128.webp') ? 128 : 256;
        return image.complete && image.naturalWidth > 0 && pixels >= Math.min(256, image.getBoundingClientRect().width * devicePixelRatio);
      })).toBe(true);
    }
    if (shell === 'macos') {
      await expect(page.getByRole('textbox', {name:'Search apps', exact:true})).toHaveCount(0);
      await page.getByRole('button', {name: shell === 'macos' ? 'Launchpad' : 'Back to Home', exact:true}).click();
      await expect(page.getByRole('textbox', {name:'Search apps', exact:true})).toBeFocused();
      await expect.poll(() => page.locator('.shell-platform-mark img').evaluateAll(images => {
        const visible = images.filter(img => { const r=img.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0; });
        return visible.length > 3 && visible.every(img => img.complete && img.naturalWidth > 0);
      })).toBe(true);
    }
    expect(errors).toEqual([]);
    console.log(`PASS ${shell} DPR ${dpr}: requested Vault before artwork, no unrelated heavy engine or page error`);
    await context.close();
  }
} finally { await browser?.close(); await fixture.close(); }
