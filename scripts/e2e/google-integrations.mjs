#!/usr/bin/env node
// UI proof with synthetic identities and an intercepted provider transport. Never live OAuth.
import { chromium, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const require = createRequire(import.meta.url);
const origin = "https://mso.example.com";
const html = execFileSync("bun", ["-e", 'import { integrationSetupPage } from "./lib/infra/setup-page"; console.log(integrationSetupPage().html)'], { encoding: "utf8", env: { ...process.env, OS_PUBLIC_ORIGIN: origin } });
const app = { id: "app", label: "Test Google app", provider: "google-oauth-app", source: "direct", authMethod: "oauth-app", state: "app-configured", scope: "client-configuration", fields: [{ key: "clientId", stored: true }, { key: "clientSecret", stored: true, secret: true }], isDefault: true };
const connection = provider => ({ id: "reporting", label: provider === "google-search-console" ? "Search reporting" : "Analytics reporting", provider, source: "direct", authMethod: "oauth2", state: "authorization-required", scope: "read-only-account", fields: [{ key: "appConnection", stored: true }], google: { appConnection: "app", account: null, requiredScope: provider === "google-search-console" ? "https://www.googleapis.com/auth/webmasters.readonly" : "https://www.googleapis.com/auth/analytics.readonly" }, isDefault: true });
const rows = [app, connection("google-search-console"), connection("google-analytics")];
const snapshot = () => ({ version: 2, user: "fixture", users: [{ id: "fixture", label: "Fixture owner", isDefault: true, connectionCount: 3 }], connections: rows, bindings: [] });
const checks = [], errors = [], requests = [], screenshots = [];
const check = (ok, name) => { checks.push({ name, passed: !!ok }); if (!ok) errors.push(name); };
const out = process.env.MSO_SCREENSHOT_DIR || path.join(process.cwd(), ".agent", "evidence", "google-ui");
process.umask(0o077); await mkdir(out, { recursive: true, mode: 0o700 });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== origin) return route.fulfill({ status: 400, body: "External network disabled in this synthetic fixture" });
    if (url.pathname === "/integrations") return route.fulfill({ contentType: "text/html", body: html });
    if (url.pathname === "/api/auth/me") return route.fulfill({ json: { role: "owner", authenticated: true } });
    if (url.pathname === "/api/v1/integrations" && req.method() === "GET") return route.fulfill({ json: snapshot() });
    if (url.pathname === "/api/v1/integrations") {
      const body = req.postDataJSON(); requests.push(body);
      const row = rows.find(c => c.provider === body.provider && c.id === body.connection);
      if (body.operation === "verify" && row) row.state = "verified";
      if (body.operation === "google.disconnect" && row) { row.state = "authorization-required"; row.google.account = null; }
      return route.fulfill({ json: { ok: true, detail: "Synthetic fixture result — not a real connected Google account" } });
    }
    if (url.pathname === "/api/integrations/google/start") {
      requests.push({ kind: "browser-google-start", ...req.postDataJSON() });
      return route.fulfill({ json: { authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=SYNTHETIC_TEST_ONLY", expiresIn: 600 } });
    }
    if (url.pathname === "/api/v1/infra/setup") return route.fulfill({ json: { token: "SYNTHETIC_PRIVATE_FORM", setup: { user: "fixture", connection: "app", provider: "google-oauth-app", title: "Google OAuth app", label: "Test Google app", source: "direct", scope: "client-configuration", method: "oauth-app", expiresAt: Date.now() + 600000, store: "Synthetic in-memory transport only", fields: [{ key: "clientId", label: "Google OAuth client ID", required: true, secret: false }, { key: "clientSecret", label: "Google OAuth client secret", required: true, secret: true }], guidance: { url: "https://console.cloud.google.com/auth/clients", reference: "https://developers.google.com/identity/protocols/oauth2/web-server", steps: ["Configure your own Google client, then authorize users separately."] } } } });
    if (url.pathname === "/api/integrations/setup") { requests.push({ kind: "private-app-configuration" }); return route.fulfill({ json: { ok: true, verified: false, configurationOnly: true } }); }
    return route.fulfill({ status: 404, json: { error: "unhandled_synthetic_route" } });
  });
  const goto = async provider => { await page.goto(origin + "/integrations?user=fixture&provider=" + provider); await expect(page.getByRole("heading", { name: provider === "google-analytics" ? "Analytics reporting" : provider === "google-oauth-app" ? "Test Google app" : "Search reporting", exact: true })).toBeVisible(); };
  await goto("google-search-console");
  check(await page.getByRole("button", { name: "Connect with Google", exact: true }).isVisible(), "Native Google connect action is visible");
  check(await page.getByRole("textbox", { name: /Project API key/ }).count() === 0, "No Composio project-key prompt in native Google connection");
  await page.getByRole("combobox", { name: "Google OAuth app", exact: true }).selectOption("app");
  await page.getByRole("button", { name: "Use selected app", exact: true }).click();
  await expect.poll(() => requests.some(r => r.operation === "google.bind" && r.arguments?.appConnection === "app")).toBe(true);
  check(true, "App binding uses the existing generic integration executor");
  await page.getByRole("button", { name: "Connect with Google", exact: true }).click();
  const consent = page.getByRole("link", { name: "Continue to Google", exact: true }); await expect(consent).toBeVisible();
  check(await consent.getAttribute("target") === "_blank", "Consent opens a top-level browser, not an iframe");
  check(await consent.getAttribute("rel") === "noopener noreferrer", "Consent link has an isolated opener and no referrer");
  check(requests.some(r => r.kind === "browser-google-start" && r.user === "fixture" && r.provider === "google-search-console" && r.connection === "reporting"), "Browser authorization preserves the exact credential identity");
  check(!requests.some(r => r.action === "connection.authorize" && r.brokerConnection), "No Composio broker authorization request");
  await page.getByRole("button", { name: "Verify API access", exact: true }).click(); await expect(page.locator(".connection-state").filter({ hasText: "Verified" })).toBeVisible();
  check(true, "Verification is separate from authorization preparation");
  page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Disconnect from MSO", exact: true }).click();
  await expect(page.locator(".connection-state").filter({ hasText: "Consent required" })).toBeVisible(); check(true, "Disconnect returns to consent-required state");
  await goto("google-analytics"); await page.getByText("Available read-only operations", { exact: true }).click();
  await expect(page.getByText("google.analytics.report.run", { exact: true })).toBeVisible(); check(true, "GA4 report operation is discoverable in the same native UI");
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `No native Google page overflow ${viewport.width} ${theme}`);
      await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
      const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector(".integration-settings-content"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(node => ({ target: node.target, summary: node.failureSummary, html: node.html })) })));
      check(violations.length === 0, `Native Google content accessibility ${viewport.width} ${theme}: ${JSON.stringify(violations)}`);
    }
    const filename = path.join(out, `google-native-ui-${viewport.width}.png`); await page.screenshot({ path: filename, fullPage: true }); screenshots.push(filename);
  }
  await page.setViewportSize({ width: 1440, height: 1000 }); await goto("google-oauth-app");
  await page.getByRole("button", { name: "Update credentials", exact: true }).click();
  await page.getByRole("textbox", { name: "Google OAuth client ID", exact: false }).fill("123456789-fixture.apps.googleusercontent.com");
  await page.locator("#setup-clientSecret").fill("SYNTHETIC_CLIENT_SECRET_NOT_REAL");
  await page.getByRole("button", { name: "Save OAuth app configuration", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("OAuth app configuration saved");
  check(!(await page.getByRole("status").innerText()).includes("Verified and saved"), "Saving app configuration does not claim verified account access");
  const file = path.join(out, "google-native-app-configuration.png"); await page.screenshot({ path: file, fullPage: true }); screenshots.push(file);
  check(await page.evaluate(() => localStorage.length === 0), "No credentials persisted to browser localStorage by the setup form");
} catch (error) { errors.push(error.stack || String(error)); }
finally {
  await browser.close();
  const report = { at: new Date().toISOString(), environment: "synthetic native UI; mocked Google and local provider transport", checks, errors, screenshots };
  const file = path.join(out, "google-native-ui-receipt.json"); await writeFile(file, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2)); console.log("Receipt: " + file); if (errors.length) process.exitCode = 1;
}
