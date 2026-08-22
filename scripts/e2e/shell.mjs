#!/usr/bin/env node
// Browser e2e for the shell. THE detector this repo did not have.
//
// Every bug found in the 2026-08-10 audits was found by READING code — an
// `apps.list` that always answered "no apps installed", a file listing that
// rendered "(0b)" for everything, a MOCK banner that was false, four hydration
// mismatches. All of them are invisible to a unit test and obvious the moment a
// browser actually loads the page. So: load the page.
//
//   node scripts/e2e/shell.mjs                    # against http://127.0.0.1:4005
//   E2E_BASE_URL=… E2E_PASSWORD=… node scripts/e2e/shell.mjs
//
// Playwright lives under os-browser/node_modules (the repo's only install, CJS) —
// see CLAUDE.md. Requires an APPROVED device id, which is seeded into localStorage
// before first paint rather than clicking through an approval flow.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(path.join(process.cwd(), "os-browser/node_modules/playwright"));

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:4005";
const HEADLESS = process.env.E2E_HEADED !== "1";

function env(key) {
  const raw = readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
  return new RegExp(`^${key}=(.*)$`, "m").exec(raw)?.[1]?.trim().replace(/^["']|["']$/g, "");
}
function approvedDevice() {
  const file = process.env.OS_DEVICE_STORE ?? path.join(os.homedir(), ".mso", "auth-devices.json");
  const ids = Object.keys(JSON.parse(readFileSync(file, "utf8")).approved ?? {});
  if (!ids.length) throw new Error(`no approved device in ${file} — run: mso device approve <id> "e2e"`);
  return ids[0];
}

const PASSWORD = process.env.E2E_PASSWORD ?? env("OS_LOGIN_PASSWORD");
const DEVICE = process.env.E2E_DEVICE ?? approvedDevice();

/** Log in ONCE and hand back the raw signed cookie value.
 *  Cached: the login route rate-limits per IP, and minting one session per viewport
 *  429s the second run of the day. */
let sessionValue = null;
async function mintSession() {
  if (sessionValue) return sessionValue;
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ password: PASSWORD, deviceId: DEVICE, deviceLabel: "e2e" }),
  });
  if (!r.ok) throw new Error(`login failed (${r.status}) — is the device approved? ${DEVICE}`);
  const raw = r.headers.get("set-cookie") ?? "";
  const value = /(?:^|,\s*)session=([^;]+)/.exec(raw)?.[1];
  if (!value) throw new Error(`login 200 but no session cookie in: ${raw.slice(0, 120)}`);
  sessionValue = value;
  return value;
}

const failures = [];
const fail = (m) => { failures.push(m); console.log(`  ✗ ${m}`); };
const pass = (m) => console.log(`  ✓ ${m}`);
const check = (cond, m) => (cond ? pass(m) : fail(m));

// Noise we do not control and that does not indicate a broken shell.
// App titles, for the mobile home where tiles are buttons rather than links.
const TITLES = {
  files: "Files", monitor: "System Monitor", settings: "Settings",
  code: "Code", terminal: "Terminal",
};

const IGNORE = [
  /favicon/i,
  /Download the React DevTools/i,
  /net::ERR_INTERNET_DISCONNECTED/i,
  // The stock image search reaches third-party hosts; offline that is not our bug.
  /openverse|unsplash/i,
];

async function session(browser, { width, height, label, touch = width < 768, expectedSurface = width < 768 ? "mobile" : "desktop" }) {
  console.log(`\n▶ ${label} (${width}×${height})`);
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    hasTouch: touch,
    isMobile: touch,
  });
  const errors = [];
  ctx.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (!IGNORE.some((re) => re.test(t))) errors.push(t);
  });
  ctx.on("weberror", (e) => errors.push(String(e.error()?.message ?? e.error())));
  // Track failed requests WITH their URL. A bare "401 (Unauthorized)" in the console
  // is unactionable; the URL is the whole finding.
  const http = [];
  ctx.on("response", (r) => {
    if (r.status() >= 400) http.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
  });

  // Sign in by INSTALLING the session cookie, not by driving the form.
  //
  // The cookie the server issues is `Secure` — correct, prod is HTTPS — and Chromium
  // refuses to STORE a Secure cookie that arrives over plain http, even on loopback.
  // The consequence is nastier than a failed login: the shell renders for signed-out
  // visitors too, backed by mock data (auth-gate.tsx, "signed-in AND signed-out →
  // the shell"), so the form appears to work, the desktop appears, and every
  // assertion below would pass against fakes. The first version of this file did
  // exactly that and reported green.
  //
  // Browsers only enforce Secure when RECEIVING a cookie, so a cookie we install
  // ourselves with secure:false is sent over http and is byte-identical to the
  // server's on the way back. The login FORM is covered by unit tests; what this
  // file exists to exercise is the shell behind it.
  await ctx.addCookies([{ name: "session", value: await mintSession(), url: BASE, sameSite: "Strict" }]);

  const page = await ctx.newPage();
  // Seed BEFORE first paint: the device id is read during the auth gate's first
  // render, so an addInitScript is the only place it lands in time.
  await page.addInitScript(
    ([id, key, onboarding]) => {
      localStorage.setItem(key, id);
      localStorage.setItem(onboarding, "done"); // skip the first-run tour
    },
    [DEVICE, "mso.device.id", "mso:onboarding:v1"],
  );

  await page.goto(BASE, { waitUntil: "domcontentloaded" });

  // `#main-content[data-shell]` — the attribute is ON the element, not a descendant.
  await page.waitForSelector("#main-content[data-shell]", { timeout: 20_000 }).catch(() => {});
  const shell = await page.getAttribute("#main-content", "data-shell");
  check(shell != null, `shell resolved (${shell})`);

  // ASSERT THE SESSION, do not assume it. The shell renders for signed-OUT visitors
  // too, backed by mock data — so "the desktop appeared" proves nothing about auth,
  // and a run that quietly tested mocks would report green forever.
  const me = await page.evaluate(async () => (await fetch("/api/auth/me", { cache: "no-store" })).json());
  check(me?.authenticated === true, `really signed in (authenticated=${me?.authenticated})`);
  if (!me?.authenticated) fail("everything below this line is testing MOCK data — fix auth first");
  check(
    expectedSurface === "mobile" ? ["ios", "android"].includes(shell) : ["macos", "windows", "dashboard"].includes(shell),
    `${shell} is the right ${expectedSurface} shell for this viewport`,
  );

  // ── no horizontal overflow. A shell that scrolls sideways is broken on a phone
  // and nothing in a unit test can see it.
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(overflow <= 1, `no horizontal overflow (${overflow}px)`);

  // ── open every app by DEEP LINK rather than by clicking the dock.
  //
  // Deliberate: the URL is the documented contract ("the OS is addressable" —
  // CLAUDE.md), so this exercises the same routing a bookmark or a shared link
  // uses, and it does not depend on dock geometry. Clicking was tried first and was
  // hopelessly flaky: macOS magnifies icons on hover so the hit box moves under the
  // pointer, and the iOS home paginates so half the grid is off-screen. A launcher
  // that cannot be clicked is a real finding, but it is a DIFFERENT test from "does
  // this app render", and conflating them made both unreliable.
  const nativeSlugs = [
    "files", "browser", "code", "terminal", "claude", "studio", "reel", "viewer",
    "store", "create", "monitor", "assistant", "links", "docs", "settings",
  ];
  for (const slug of nativeSlugs) {
    await page.goto(`${BASE}/${slug}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    // Desktop puts the app in a [data-window]; iOS/Android render it full-screen in
    // the shell, with no window chrome at all. Assert the surface-appropriate thing
    // rather than a window that is correctly absent on a phone.
    check(page.url().endsWith(`/${slug}`), `/${slug} deep-link kept the URL`);
    if (width >= 768) {
      check((await page.locator("[data-window]").count()) > 0, `/${slug} opened a window`);
    }
    // A spinner that never resolves is the exact failure window-content.tsx used to
    // sit in forever when a chunk import rejected.
    check((await page.locator(".animate-spin").count()) === 0, `/${slug} rendered without a stuck spinner`);

    // iOS System Settings deliberately owns its own navigation chrome. Guard the
    // Apple-style hierarchy so the generic app header (icon/title/Done) cannot
    // silently reappear and duplicate the in-app Settings navigation.
    if (slug === "settings" && shell === "ios") {
      check((await page.locator('[data-slot="ios-settings-root"]').count()) === 1, "/settings uses the native iOS Settings root");
      check((await page.locator('[data-slot="ios-settings-root"] h1', { hasText: "Settings" }).count()) === 1, "/settings shows the iOS large title");
      check((await page.locator('[data-slot="ios-settings-root"] input[type="search"]').count()) === 1, "/settings exposes functional Search");
      check((await page.getByRole("button", { name: "Done", exact: true }).count()) === 0, "/settings does not duplicate the generic iOS Done header");
    }
  }

  // ── the regression that shipped for months: a tool/list that renders every file
  // as "(0b)" because fs.list does not report sizes.
  const zeroBytes = await page.locator("text=/\\(0b\\)/").count();
  check(zeroBytes === 0, "no bogus (0b) file sizes rendered");

  // /api/prefs 401s once before sign-in BY DESIGN: the appearance + quicklinks
  // providers mount outside AuthGate so persisted UI state applies on first paint,
  // and the pull is silent when it fails. Any OTHER 4xx/5xx is a real finding, so it
  // is excluded by exact path rather than by status.
  const badHttp = [...new Set(http)].filter((h) => h !== "401 GET /api/prefs");
  check(badHttp.length === 0, `no unexpected failed requests${badHttp.length ? ` — ${badHttp.join(", ")}` : ""}`);

  const realErrors = errors.filter((e) => !/401 \(Unauthorized\)/.test(e) || badHttp.length > 0);
  check(realErrors.length === 0, `zero console errors${realErrors.length ? ` — first: ${realErrors[0].slice(0, 160)}` : ""}`);
  for (const e of realErrors.slice(0, 5)) console.log(`      · ${e.slice(0, 200)}`);

  // Managed-app routes are cross-origin embeds in production. On a loopback E2E
  // origin their own frame-ancestors/session policy correctly rejects the iframe,
  // so exercise host routing/rendering here without treating that origin mismatch
  // as an MSO host-network failure. Their own runtime has separate managed-app tests.
  for (const slug of ["hermes", "openclaw"]) {
    await page.goto(`${BASE}/${slug}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    check(page.url().endsWith(`/${slug}`), `/${slug} managed-app deep-link kept the URL`);
    if (width >= 768) check((await page.locator("[data-window]").count()) > 0, `/${slug} managed-app opened a window`);
    check((await page.locator(".animate-spin").count()) === 0, `/${slug} managed-app host rendered without a stuck spinner`);
  }

  await ctx.close();
}

const browser = await chromium.launch({ headless: HEADLESS });
try {
  await session(browser, { width: 1280, height: 800, label: "desktop" });
  await session(browser, { width: 390, height: 844, label: "mobile portrait" });
  await session(browser, { width: 844, height: 390, label: "phone landscape → desktop", touch: true, expectedSurface: "desktop" });
} finally {
  await browser.close();
}

console.log(`\n${failures.length === 0 ? "✅ shell e2e passed" : `❌ ${failures.length} failure(s)`}`);
process.exit(failures.length === 0 ? 0 : 1);
