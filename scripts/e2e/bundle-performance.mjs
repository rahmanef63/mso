#!/usr/bin/env node
// Cold-load and first-open regressions against synthetic stores, never live state.
import fs from 'node:fs';
import path from 'node:path';
import { chromium, expect as assertion } from '@playwright/test';
import { releaseFixture } from './release-fixture.mjs';

const expect = assertion.configure({ timeout: 15000 });
const chunks = new Map(fs.readdirSync('.next/static/chunks').filter(file => file.endsWith('.js'))
  .map(file => [file, fs.readFileSync(path.join('.next/static/chunks', file), 'utf8')]));
const heavyMarkers = ['react-flow__renderer', 'Konva error', 'xterm-screen', 'ort-wasm-simd-threaded'];
const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9);
if (output) fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const fixture = await releaseFixture();
let browser;
const results = [];
try {
  browser = await chromium.launch({ headless: true });
  for (const shell of ['macos', 'windows', 'dashboard', 'ios', 'android']) {
    const mobile = ['ios', 'android'].includes(shell);
    const viewport = mobile ? { width: 390, height: 844 } : { width: 1363, height: 936 };
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    await context.addInitScript(({ shell, mobile }) => {
      localStorage.setItem('sv:shell', JSON.stringify({ desktop: mobile ? 'macos' : shell, mobile: mobile ? shell : 'ios' }));
      localStorage.setItem('mso:onboarding:v1', 'done');
    }, { shell, mobile });
    const page = await context.newPage();
    const errors = [];
    const pendingScripts = new Set();
    const requestedScripts = new Set();
    let lastScriptAt = Date.now();
    const isScript = request => /\/_next\/static\/.*\.js(?:\?|$)/.test(request.url());
    page.on('request', request => {
      if (isScript(request)) { pendingScripts.add(request); requestedScripts.add(new URL(request.url()).pathname.split('/').at(-1)); lastScriptAt = Date.now(); }
    });
    const settled = request => { if (isScript(request)) { pendingScripts.delete(request); lastScriptAt = Date.now(); } };
    page.on('requestfinished', settled); page.on('requestfailed', settled);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/_next/static/chunks/*.js', async route => {
      const file = new URL(route.request().url()).pathname.split('/').at(-1);
      // First-open must settle by itself even when the deferred panel arrives late.
      if (chunks.get(file)?.includes('Spotlight search')) await new Promise(resolve => setTimeout(resolve, 350));
      await route.continue();
    });
    await page.goto(fixture.base);
    await expect(page.locator(`#main-content[data-shell="${shell}"]`)).toBeVisible();
    await expect(page.getByLabel('Server connection mode')).toBeVisible();
    // Telemetry/SSE/SW traffic is intentionally long-lived. Wait only for the
    // local startup JavaScript, not an impossible globally idle network.
    await expect.poll(() => pendingScripts.size === 0 && Date.now() - lastScriptAt > 500).toBe(true);
    const resources = await page.evaluate(() => performance.getEntriesByType('resource')
      .filter(entry => entry.name.includes('/_next/static/') && new URL(entry.name).pathname.endsWith('.js'))
      .map(entry => ({ file: new URL(entry.name).pathname.split('/').at(-1), decodedBytes: entry.decodedBodySize, transferBytes: entry.transferSize })));
    const heavy = [...requestedScripts].filter(file => heavyMarkers.some(marker => chunks.get(file)?.includes(marker)));
    expect(heavy).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (output) await page.screenshot({ path: path.join(output, `${shell}-cold.png`) });
    const search = page.getByRole('combobox', { name: 'Spotlight search' });
    if (shell === 'macos') {
      const delayed = page.waitForResponse(response => {
        const file = new URL(response.url()).pathname.split('/').at(-1);
        return Boolean(chunks.get(file)?.includes('Spotlight search'));
      });
      const requested = page.waitForRequest(request => {
        const file = new URL(request.url()).pathname.split('/').at(-1);
        return Boolean(chunks.get(file)?.includes('Spotlight search'));
      });
      await page.keyboard.press('Control+k'); await requested;
      await page.keyboard.press('Control+k'); await delayed;
      await expect(search).not.toBeVisible();
    }
    await page.keyboard.press('Control+k');
    await expect(search).toBeVisible(); await expect(search).toBeFocused();
    await search.fill('Terminal'); await expect(page.getByRole('listbox')).toContainText('Terminal');
    await page.keyboard.press('Escape'); await expect(search).not.toBeVisible();
    await page.keyboard.press('Control+k'); await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    await page.keyboard.press('Escape'); await expect(search).not.toBeVisible();
    // Capture a copy BEFORE ever importing clipboard presentation.
    const capturedSelection = await page.evaluate(() => {
      const node = document.createElement('p'); node.style.userSelect = 'text'; node.textContent = 'bundle-capture-before-open'; document.body.appendChild(node);
      const range = document.createRange(); range.selectNodeContents(node);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      const selected = getSelection().toString();
      document.dispatchEvent(new Event('copy')); getSelection().removeAllRanges(); node.remove();
      return selected;
    });
    expect(capturedSelection).toBe('bundle-capture-before-open');
    await page.keyboard.press('Control+Shift+v');
    await expect(page.getByText('Clipboard history', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'bundle-capture-before-open', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    if (shell === 'macos' || shell === 'windows') {
      await page.keyboard.press('Control+i');
      const close = page.getByRole('button', { name: 'Close inspector (⌘I)', exact: true });
      await expect(close).toBeVisible();
      const inspector = page.locator('aside').filter({ has: close });
      await inspector.getByRole('button', { name: 'AI', exact: true }).click();
      await close.click(); await expect(close).not.toBeVisible();
      await page.keyboard.press('Control+i');
      await expect(inspector.getByRole('button', { name: 'AI', exact: true })).toHaveClass(/bg-secondary/);
      await close.click();
    } else if (mobile) {
      await page.keyboard.press('Control+i');
      const close = page.getByRole('button', { name: 'Close Alfa', exact: true });
      await expect(close).toBeVisible(); await close.click(); await expect(close).not.toBeVisible();
    }
    expect(errors).toEqual([]);
    results.push({ shell, viewport, coldJsRequests: resources.length,
      coldJsDecodedBytes: resources.reduce((n, row) => n + row.decodedBytes, 0),
      coldJsTransferBytes: resources.reduce((n, row) => n + row.transferBytes, 0),
      heavyEnginesLoadedOnColdStart: heavy.length, pageErrors: errors.length,
      firstOpenSearch: 'pass', eagerClipboardCapture: 'pass', resources });
    await context.close();
    console.log(`PASS ${shell}: no cold graph/editor/terminal/ONNX engines, deferred search, clipboard and inspector lifecycle`);
  }
  if (output) fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify({ synthetic: true, results }, null, 2));
} finally {
  await browser?.close();
  await fixture.close();
}
console.log('bundle performance E2E: all five shells passed');
