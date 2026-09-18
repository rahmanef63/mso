#!/usr/bin/env node
import { chromium, expect } from '@playwright/test';
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { releaseFixture } from './release-fixture.mjs';

const app = { id: 'automation', title: 'n8n', description: 'Reviewed test provider', origin: 'https://automation.example.test', startPath: '/editor', externalAuthPath: '/signin', renderer: 'iframe', presentation: 'inline', environment: 'production', placements: ['workflows'], sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads' };
const liveOrigin = process.env.E2E_WORKFLOW_EMBED_ORIGIN;
const parentOrigin = process.env.E2E_WORKFLOW_EMBED_PARENT_ORIGIN;
if (liveOrigin && (!parentOrigin || !parentOrigin.startsWith('https://') || new URL(parentOrigin).origin !== parentOrigin)) throw new Error('Exact approved HTTPS E2E_WORKFLOW_EMBED_PARENT_ORIGIN required for live policy verification');
if (liveOrigin && (new URL(liveOrigin).origin !== liveOrigin || !liveOrigin.startsWith('https://'))) throw new Error('Exact HTTPS E2E_WORKFLOW_EMBED_ORIGIN required');
const fixture = await releaseFixture({ surfaceApps: [app] });
let browser;
const evidence = [];
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(device => { if (window !== window.top) return; localStorage.setItem('mso.device.id', device); localStorage.setItem('mso:onboarding:v1', 'done'); }, fixture.device);
  let frameRequests = 0;
  await context.route('https://automation.example.test/**', async route => {
    frameRequests++;
    await route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><title>Fixture editor</title></head><body><h1>Fixture editor</h1><label>External draft <input aria-label="External draft"></label></body></html>' });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(30000);
  const frameNetwork = [];
  page.on("requestfailed", request => { if (liveOrigin && request.url().startsWith(liveOrigin)) frameNetwork.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText }); });
  page.on("response", response => { if (liveOrigin && response.url().startsWith(liveOrigin) && response.status() >= 400) frameNetwork.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(fixture.base + '/login?returnTo=%2Fworkflows');
  await page.locator('input[type="password"]').fill(fixture.password);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page).toHaveURL(fixture.base + '/workflows');
  await expect(page.getByRole('tab', { name: 'n8n', exact: true })).toBeVisible();
  expect(frameRequests).toBe(0);
  const saved = await page.evaluate(async app => {
    const state = await (await fetch('/api/v1/workflow-embeds')).json();
    const input = { app, expectedRevision: state.revision, confirm: true };
    const write = () => fetch('/api/v1/workflow-embeds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const response = await write();
    return { status: response.status, updated: await response.json(), staleStatus: (await write()).status };
  }, app);
  expect(saved.status).toBe(200); expect(saved.updated.id).toBe(app.id); expect(saved.staleStatus).toBe(409);
  evidence.push({ ownerReviewedConfiguration: true, staleRevisionRejected: true });
  console.log('PASS owner metadata save and stale-revision refusal');
  const result = await page.evaluate(async () => {
    const res = await fetch('/api/v1/workflows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', graph: { name: 'Native fixture', description: 'Private fixture', status: 'draft', inputs: {}, metadata: { provenance: 'user' }, nodes: [{ id: 'manual', name: 'Manual', type: 'manual', position: { x: 80, y: 160 }, config: {} }, { id: 'output', name: 'Output', type: 'output', position: { x: 420, y: 160 }, config: {} }], edges: [{ id: 'start', source: 'manual', target: 'output' }] } }) });
    return res.status;
  });
  expect(result).toBe(200);
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.reload();
    await expect(page.getByLabel('Workflow name')).toHaveValue('Native fixture');
    await page.getByLabel('Workflow name').fill('Unsaved fixture');
    await page.getByRole('tab', { name: 'n8n', exact: true }).click();
    const frame = page.frameLocator('iframe[title="n8n workflow editor"]');
    await expect(frame.getByRole('heading', { name: 'Fixture editor' })).toBeVisible();
    await frame.getByLabel('External draft').fill('External unsaved draft');
    const requestsBeforeSwitch = frameRequests;
    await page.getByRole('tab', { name: 'MSO', exact: true }).click();
    await expect(page.getByLabel('Workflow name')).toHaveValue('Unsaved fixture');
    await page.getByRole('tab', { name: 'MSO', exact: true }).press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'n8n', exact: true })).toBeFocused();
    await expect(frame.getByLabel('External draft')).toHaveValue('External unsaved draft');
    expect(frameRequests).toBe(requestsBeforeSwitch);
    expect(await page.locator('[data-slot="workflows-workspace"]').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    const iframeBox = await page.locator('iframe[title="n8n workflow editor"]').boundingBox();
    if (iframeBox.height <= 120 && process.env.E2E_EVIDENCE_DIR) {
      await mkdir(process.env.E2E_EVIDENCE_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.E2E_EVIDENCE_DIR, 'embed-height-diagnostic.png'), fullPage: true });
      console.log(JSON.stringify({ viewport, iframeBox, layout: await page.locator('[data-slot="workflows-workspace"]').evaluate(el => ({ workspace: el.getBoundingClientRect().toJSON(), children: [...el.children].map(x => ({ tag: x.tagName, hidden: x.hidden, rect: x.getBoundingClientRect().toJSON() })) })) }));
    }
    expect(iframeBox.height).toBeGreaterThan(120);
    await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute('href', app.origin + '/signin');
    await expect(page.getByRole('link', { name: 'Open n8n', exact: true })).toHaveAttribute('target', '_blank');
    await page.getByRole('button', { name: 'Reload n8n', exact: true }).click();
    await expect(frame.getByLabel('External draft')).toHaveValue('');
    evidence.push({ viewport, nativeDraftPreserved: true, externalDraftPreserved: true, reload: true, keyboard: true, reflow: true, frameHeight: iframeBox.height });
  }
  console.log('PASS provider tabs, native/external draft preservation and all three viewport sizes');
  await fixture.setRole('viewer');
  expect(await page.evaluate(async () => (await fetch('/api/v1/workflow-embeds')).status)).toBe(403);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('tab', { name: 'n8n', exact: true })).toHaveCount(0);
  await expect(page.locator('iframe[title="n8n workflow editor"]')).toHaveCount(0);
  console.log('PASS demotion response and removed frame');
  await fixture.setRole('owner');
  await writeFile(path.join(fixture.dir, 'surface-apps.json'), JSON.stringify([{ ...app, renderer: 'remote', reason: 'Fixture provider requires top-level access' }]));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('tab', { name: 'n8n', exact: true }).click();
  await expect(page.getByText('Fixture provider requires top-level access')).toBeVisible();
  await expect(page.locator('iframe[title="n8n workflow editor"]')).toHaveCount(0);
  evidence.push({ ownerDemotion: '403 and frame removed', remoteOnly: 'no iframe' });
  console.log('PASS remote-only fallback');
  // Cookies have no port isolation: prove a reviewed same-host HTTPS editor is
  // visibly blocked before any frame/login/navigation can send the fixture session.
  const unsafe = new URL(fixture.base); unsafe.protocol = 'https:'; unsafe.port = '4443';
  let unsafeRequests = 0;
  const watchUnsafe = request => { if (request.url().startsWith(unsafe.origin)) unsafeRequests++; };
  page.on('request', watchUnsafe);
  await writeFile(path.join(fixture.dir, 'surface-apps.json'), JSON.stringify([{ ...app, origin: unsafe.origin }]));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('tab', { name: 'n8n', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'this editor would receive the MSO session cookie' })).toBeVisible();
  await expect(page.locator('iframe[title="n8n workflow editor"]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Open n8n', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveCount(0);
  expect(unsafeRequests).toBe(0);
  page.off('request', watchUnsafe);
  evidence.push({ cookieCollision: 'blocked frame, login and navigation', unsafeRequests });
  console.log('PASS cookie-isolated external editors: no unsafe frame, link or request');

  if (liveOrigin) {
    await writeFile(path.join(fixture.dir, 'surface-apps.json'), JSON.stringify([{ ...app, id: 'live-n8n', origin: liveOrigin, startPath: '/home/workflows' }]));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.locator('[role="tab"][id$="-tab-live-n8n"]').click();
    await expect(page.getByRole('link', { name: 'Open n8n', exact: true })).toHaveAttribute('href', liveOrigin + '/home/workflows');
    await expect.poll(() => frameNetwork.some(row => row.error === 'net::ERR_BLOCKED_BY_RESPONSE'), {timeout:20000}).toBe(true);
    await expect(page.getByRole('link', { name: 'Open n8n', exact: true })).toBeVisible();
    evidence.push({ unapprovedLocalParentBlocked: true, fallbackVisible: true });
    const probe = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const probePage = await probe.newPage();
    probePage.setDefaultTimeout(15000);
    const probeUrl = parentOrigin + '/__workflow_embed_policy_probe__';
    // Synthetic parent document at the explicitly approved origin; the child is
    // live n8n. No owner session, response-header rewrite or browser-security flag.
    await probe.route(probeUrl, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><title>n8n frame policy verification</title></head><body style="margin:0"><iframe title="Live n8n" style="display:block;width:100vw;height:100vh;border:0" referrerpolicy="no-referrer" sandbox="' + app.sandbox + '" src="' + liveOrigin + '/home/workflows"></iframe></body></html>' }));
    await probePage.goto(probeUrl);
    await probePage.bringToFront();
    await expect(probePage.frameLocator('iframe').locator('input[type="password"]')).toBeVisible({ timeout:30000 });
    const capturePaint = async filename => {
      let image;
      await expect.poll(async () => {
        image = await probePage.screenshot({ fullPage: false, animations: 'disabled' });
        return (await sharp(image).stats()).entropy;
      }, { timeout:10000, intervals:[100,250,500] }).toBeGreaterThan(0.1);
      if (process.env.E2E_EVIDENCE_DIR) {
        await mkdir(process.env.E2E_EVIDENCE_DIR, { recursive: true });
        await writeFile(path.join(process.env.E2E_EVIDENCE_DIR, filename), image);
      }
    };
    await capturePaint('n8n-approved-parent-desktop.png');
    await probePage.setViewportSize({ width:390, height:844 });
    await expect(probePage.frameLocator('iframe').locator('input[type="password"]')).toBeVisible();
    await capturePaint('n8n-approved-parent-mobile.png');
    evidence.push({ liveProvider: liveOrigin, approvedParentOrigin: parentOrigin, parentDocumentIsSynthetic: true, signedOutLoginRendered: true, paintVerified: true, authenticatedEditorTested: false });
    await probe.close();
  }
  expect(errors).toEqual([]);
  if (process.env.E2E_EVIDENCE_DIR) await writeFile(path.join(process.env.E2E_EVIDENCE_DIR, 'workflow-embed-browser.json'), JSON.stringify({ passed: true, evidence }, null, 2));
  console.log(JSON.stringify({ passed: true, evidence }, null, 2));
  await context.close();
} finally { await browser?.close(); await fixture.close(); }
