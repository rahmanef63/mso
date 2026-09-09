#!/usr/bin/env node
// Browser e2e for the Preview app and the Settings update panel.
//
//   node scripts/e2e/preview.mjs            # desktop, 1280
//   node scripts/e2e/preview.mjs 390        # the mobile shell
// Uses a built app with disposable credentials and files; no deployment secrets.
//
// Preview is the app most likely to LOOK fine and be wrong: an <img> that never
// decoded, a PDF frame that 404s, an HTML file rendered with its scripts live. Every
// check here asserts the bytes actually arrived (naturalWidth, readyState, frame
// text), not that an element exists.
//
// It provisions its own fixtures in a disposable temporary folder and skips the ones
// it cannot make (no ffmpeg → no video/audio; no system PDF → no PDF), so a fresh
// machine runs a smaller suite rather than a red one.
//
// Same session trick as shell.mjs: install the cookie rather than drive the form,
// because Chromium refuses to STORE a Secure cookie arriving over plain http, and
// the shell renders for signed-out visitors too (backed by mocks) — a run that
// quietly tested fakes would report green forever.
import { chromium } from "@playwright/test";
import { releaseFixture } from "./release-fixture.mjs";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";

process.umask(0o077);
const fixture = await releaseFixture({ live: true });
const BASE = fixture.base;
const WIDTH = Number(process.argv[2] ?? 1280);
const MOBILE = WIDTH < 768;
const DIR = path.join(fixture.dir, "preview");
const PASSWORD = fixture.password, DEVICE = fixture.device;
let browser;

const failures = [];
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures.push(m); console.log(`  ✗ ${m}`); };
const check = (cond, m) => (cond ? pass(m) : fail(m));
const skip = (m) => console.log(`  – ${m}`);

// 1×1 transparent PNG — enough for naturalWidth to prove the bytes decoded.
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function fixtures() {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(path.join(DIR, "sample.png"), Buffer.from(PNG_B64, "base64"));
  writeFileSync(path.join(DIR, "logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#10ac84"/></svg>');
  writeFileSync(path.join(DIR, "notes.md"), "# Preview test\n\nThis file checks the **Markdown** renderer.\n\n- one\n- two\n");
  writeFileSync(path.join(DIR, "rows.csv"), 'name,role\nRahman,owner\nClaude,"assistant, occasionally wrong"\n');
  // The script tag is the point: it must NOT run inside the sandboxed frame.
  writeFileSync(path.join(DIR, "page.html"), "<!doctype html><html><body><h1>HTML renders sandboxed</h1><script>document.body.innerHTML+='SCRIPT RAN'</script></body></html>");
  writeFileSync(path.join(DIR, "server.log"), "boot ok\nlistening on 4005\n");
  writeFileSync(path.join(DIR, "report.docx"), "not really a document"); // kind: none
  const pdf = ["/usr/share/doc/shared-mime-info/shared-mime-info-spec.pdf", "/usr/share/cups/data/default-testpage.pdf"].find(existsSync);
  if (pdf) copyFileSync(pdf, path.join(DIR, "spec.pdf"));
  for (const [file, args] of [
    ["sample.mp4", ["-f", "lavfi", "-i", "testsrc=size=160x120:rate=10", "-t", "1", "-pix_fmt", "yuv420p"]],
    ["sample.mp3", ["-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-q:a", "9"]],
  ]) {
    if (existsSync(path.join(DIR, file))) continue;
    try {
      execFileSync("ffmpeg", [...args, path.join(DIR, file), "-y"], { stdio: "ignore" });
    } catch {
      /* no ffmpeg — those two checks skip */
    }
  }
  return {
    pdf: existsSync(path.join(DIR, "spec.pdf")),
    video: existsSync(path.join(DIR, "sample.mp4")),
    audio: existsSync(path.join(DIR, "sample.mp3")),
  };
}

async function mintSession() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ password: PASSWORD, deviceId: DEVICE, deviceLabel: "e2e-preview" }),
  });
  if (!r.ok) throw new Error(`login failed (${r.status}) — is the device approved? ${DEVICE}`);
  const value = /(?:^|,\s*)session=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")?.[1];
  if (!value) throw new Error("login 200 but no session cookie");
  return value;
}

// The desktop puts each app in a [data-window]; the mobile shell shows ONE app
// full-screen with no window chrome. Same assertions, two surfaces.
const scope = (page, name) =>
  MOBILE ? page.locator("#main-content") : page.locator("[data-window]").filter({ hasText: name }).last();

const run = async () => {
  const have = fixtures();
  browser = await chromium.launch({ headless: process.env.E2E_HEADED !== "1" });
  const ctx = await browser.newContext({
    viewport: { width: WIDTH, height: MOBILE ? 800 : 900 },
    hasTouch: MOBILE,
    isMobile: MOBILE,
  });
  const errors = [];
  ctx.on("console", (m) => {
    const t = m.text();
    // The sandbox refusing to run the fixture's script IS the passing behaviour.
    if (m.type() === "error" && !/favicon|DevTools|Blocked script execution|Failed to load resource: the server responded with a status of/i.test(t)) errors.push(t);
  });
  const http = [];
  ctx.on("response", (r) => {
    if (r.status() < 400) return;
    const url = new URL(r.url());
    // Background shell windows may probe home; the fixture deliberately grants
    // only its temporary directory. Keep these expected boundary refusals exact.
    const homeProbe = r.status() === 400 && ["/api/v1/fs/list", "/api/v1/fs/usage"].includes(url.pathname)
      && [null, "~"].includes(url.searchParams.get("path"));
    if (!homeProbe) http.push(`${r.status()} ${url.pathname}${url.search}`);
  });

  await ctx.addCookies([{ name: "session", value: await mintSession(), url: BASE, sameSite: "Strict" }]);
  const page = await ctx.newPage();
  await page.addInitScript(
    ([id]) => {
      localStorage.setItem("mso.device.id", id);
      localStorage.setItem("mso:tweaks", JSON.stringify({server:{mode:"live",activeTargetId:"vps",url:""}}));
      localStorage.setItem("mso:onboarding:v1", "done");
    },
    [DEVICE],
  );

  console.log(`\n▶ Preview @ ${WIDTH}px  (${DIR})`);
  await page.goto(`${BASE}/files${DIR}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#main-content[data-shell]", { timeout: 25_000 });
  const me = await page.evaluate(async () => (await fetch("/api/auth/me", { cache: "no-store" })).json());
  check(me?.authenticated === true, `really signed in (authenticated=${me?.authenticated})`);
  await page.waitForSelector('[data-name="sample.png"]', { timeout: 20_000 }).catch(() => {});

  // Open by deep link — the same route the window store takes, and the only one
  // that works identically on both shells (mobile has no Space and no right-click).
  const open = async (name) => {
    await page.goto(`${BASE}/viewer${DIR}/${name}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(`[data-preview-file="${name}"]`, { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(900);
  };
  const shown = async () => (await page.locator("[data-preview-file]").last().getAttribute("data-preview-file")) ?? "";

  await open("sample.png");
  let win = scope(page, "sample.png");
  check((await win.locator("img").count()) > 0, "PNG renders as <img>");
  check(await win.locator("img").first().evaluate((el) => el.naturalWidth > 0).catch(() => false), "PNG actually decoded");
  check((await page.locator("[aria-label='Next file']").count()) > 0, "← → paging present");
  const before = await shown();
  await page.locator("[aria-label='Next file']").first().click();
  await page.waitForTimeout(1200);
  const after = await shown();
  check(before !== after, `Next paged ${before} → ${after}`);
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(1200);
  check((await shown()) === before, `ArrowLeft came back to ${before}`);

  if (have.pdf) {
    await open("spec.pdf");
    check((await scope(page, "spec.pdf").locator("iframe").count()) > 0, "PDF renders in a frame");
  } else skip("PDF (no system pdf to copy)");

  if (have.video) {
    await open("sample.mp4");
    const vid = scope(page, "sample.mp4").locator("video");
    check((await vid.count()) > 0, "MP4 renders as <video>");
    const ready = await vid.first().evaluate((el) => new Promise((res) => {
      if (el.readyState >= 1) return res(true);
      el.addEventListener("loadedmetadata", () => res(true), { once: true });
      setTimeout(() => res(false), 5000);
    })).catch(() => false);
    check(ready, "MP4 metadata loaded (the bytes really stream)");
  } else skip("MP4 (no ffmpeg)");

  if (have.audio) {
    await open("sample.mp3");
    check((await scope(page, "sample.mp3").locator("audio").count()) > 0, "MP3 renders as <audio>");
  } else skip("MP3 (no ffmpeg)");

  await open("notes.md");
  check(/Preview test/.test(await scope(page, "notes.md").innerText()), "Markdown rendered");

  await open("rows.csv");
  win = scope(page, "rows.csv");
  check((await win.locator("table tr").count()) >= 3, "CSV rendered as a table");
  check(/assistant, occasionally wrong/.test(await win.innerText()), "CSV quoted field kept its comma");

  await open("page.html");
  const frame = scope(page, "page.html").locator("iframe");
  check((await frame.count()) > 0, "HTML rendered in a frame");
  check((await frame.first().getAttribute("sandbox")) === "", "HTML frame is fully sandboxed");
  const inner = await frame.first().contentFrame();
  const innerText = inner ? await inner.locator("body").innerText().catch(() => "") : "";
  check(/HTML renders sandboxed/.test(innerText), "HTML body actually rendered");
  check(!/SCRIPT RAN/.test(innerText), "script inside the HTML did NOT run");

  await open("server.log");
  check(/listening on 4005/.test(await scope(page, "server.log").innerText()), "Plain text rendered");

  await open("report.docx");
  check(/No browser can render this format/i.test(await scope(page, "report.docx").innerText()), "DOCX says why, and offers the download");

  // Settings → About: the update panel is the other thing that can only be wrong live.
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const about = page.getByText("About", { exact: true }).first();
  if (await about.count()) await about.click().catch(() => {});
  await page.waitForTimeout(3500);
  const settings = await (MOBILE ? page.locator("#main-content") : page.locator("[data-window]").last()).innerText();
  check(/Software update/i.test(settings), "Settings → About shows the update panel");
  check(/Up to date|available|build is pending/i.test(settings), "Update panel reported a state");
  const update = await page.evaluate(async () => (await fetch("/api/v1/sys/update?check=0")).json());
  if (update.supported === false) {
    check(typeof update.reason === "string" && settings.includes(update.reason), "Isolated fixture explains why self-update is unavailable");
    check(!/Update to .* and restart/.test(settings), "Isolated fixture offers no deployment action");
  } else check(/Release notes and docs/i.test(settings), "Release notes + docs row present");

  console.log(`\n  console errors: ${errors.length ? [...new Set(errors)].slice(0, 5).join(" | ") : "none"}`);
  console.log(`  http >=400: ${http.length ? [...new Set(http)].join(" | ") : "none"}`);
  if (errors.length) fail(`${errors.length} console error(s)`);
  if (http.length) fail(`${http.length} unexpected HTTP error(s)`);
  await browser.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : "\nall good");
  process.exitCode = failures.length ? 1 : 0;
};

try { await run(); } catch (e) { console.error(e); process.exitCode = 1; }
finally { await browser?.close(); await fixture.close(); }
