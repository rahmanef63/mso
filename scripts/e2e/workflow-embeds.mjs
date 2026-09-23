#!/usr/bin/env node
import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { releaseFixture } from './release-fixture.mjs';

const app = {
  id: 'n8n',
  title: 'n8n',
  description: 'Reviewed test provider',
  origin: 'https://automation.example.test',
  startPath: '/editor',
  externalAuthPath: '/signin',
  renderer: 'iframe',
  presentation: 'inline',
  environment: 'production',
  placements: ['n8n'],
  sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads',
};

const fixture = await releaseFixture({ surfaceApps: [app] });
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(device => {
    if (window !== window.top) return;
    localStorage.setItem('mso.device.id', device);
    localStorage.setItem('mso:onboarding:v1', 'done');
  }, fixture.device);

  let frameRequests = 0;
  await context.route('https://automation.example.test/**', async route => {
    frameRequests++;
    await route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head><title>Fixture editor</title></head><body><h1>Fixture editor</h1><label>External draft <input aria-label="External draft"></label></body></html>',
    });
  });

  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto(fixture.base + '/login?returnTo=%2Fn8n');
  await page.locator('input[type="password"]').fill(fixture.password);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page).toHaveURL(fixture.base + '/n8n');
  await expect(page.getByText('n8n', { exact: true }).first()).toBeVisible();
  await expect(page.locator('iframe[title="n8n automation editor"]')).toBeVisible();
  await expect(page.frameLocator('iframe[title="n8n automation editor"]').getByRole('heading', { name: 'Fixture editor' })).toBeVisible();

  const saved = await page.evaluate(async app => {
    const state = await (await fetch('/api/v1/workflow-embeds')).json();
    const input = { app, expectedRevision: state.revision, confirm: true };
    const write = () => fetch('/api/v1/workflow-embeds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const response = await write();
    return { status: response.status, updated: await response.json(), staleStatus: (await write()).status };
  }, app);
  expect(saved.status).toBe(200);
  expect(saved.updated.id).toBe('n8n');
  expect(saved.staleStatus).toBe(409);

  // n8n is a separate first-class feature. Native Workflows must not mount an external provider tab/frame.
  await page.goto(fixture.base + '/workflows');
  await expect(page.locator('[data-slot="workflows-feature"]')).toBeVisible();
  await expect(page.locator('[data-slot="workflows-workspace"]')).toHaveCount(0);
  await expect(page.locator('iframe[title="n8n automation editor"]')).toHaveCount(0);

  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.goto(fixture.base + '/n8n');
    const frame = page.frameLocator('iframe[title="n8n automation editor"]');
    await expect(frame.getByRole('heading', { name: 'Fixture editor' })).toBeVisible();
    await frame.getByLabel('External draft').fill('External unsaved draft');
    await expect(frame.getByLabel('External draft')).toHaveValue('External unsaved draft');
    const iframeBox = await page.locator('iframe[title="n8n automation editor"]').boundingBox();
    expect(iframeBox.height).toBeGreaterThan(120);
    await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute('href', app.origin + '/signin');
    await expect(page.getByRole('link', { name: 'Open n8n', exact: true })).toHaveAttribute('target', '_blank');
    const before = frameRequests;
    await page.getByRole('button', { name: 'Reload n8n', exact: true }).click();
    await expect(frame.getByLabel('External draft')).toHaveValue('');
    expect(frameRequests).toBeGreaterThan(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }

  await fixture.setRole('viewer');
  expect(await page.evaluate(async () => (await fetch('/api/v1/workflow-embeds')).status)).toBe(403);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('iframe[title="n8n automation editor"]')).toHaveCount(0);
  await expect(page.getByText('App unavailable', { exact: true })).toBeVisible();

  await fixture.setRole('owner');
  await writeFile(path.join(fixture.dir, 'surface-apps.json'), JSON.stringify([{ ...app, renderer: 'remote', reason: 'Fixture provider requires top-level access' }]));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('Fixture provider requires top-level access')).toBeVisible();
  await expect(page.locator('iframe[title="n8n automation editor"]')).toHaveCount(0);

  const unsafe = new URL(fixture.base);
  unsafe.protocol = 'https:';
  unsafe.port = '4443';
  let unsafeRequests = 0;
  const watchUnsafe = request => { if (request.url().startsWith(unsafe.origin)) unsafeRequests++; };
  page.on('request', watchUnsafe);
  await writeFile(path.join(fixture.dir, 'surface-apps.json'), JSON.stringify([{ ...app, origin: unsafe.origin }]));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('alert').filter({ hasText: 'this editor would receive the MSO session cookie' })).toBeVisible();
  await expect(page.locator('iframe[title="n8n automation editor"]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Open n8n', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveCount(0);
  expect(unsafeRequests).toBe(0);
  page.off('request', watchUnsafe);

  expect(errors).toEqual([]);
  console.log('PASS dedicated n8n feature, native Workflows separation, responsive embed, demotion and cookie isolation');
  await context.close();
} finally {
  await browser?.close();
  await fixture.close();
}
