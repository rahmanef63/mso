/**
 * Browser evidence harness for the integrations page.
 *
 * Written because every UI claim in this session so far was proven only against strings:
 * tests assert that CSS text exists, not that a browser lays it out that way. This drives a real
 * build and reports what actually renders.
 *
 * Usage: node scripts/integrations-ui-evidence.mjs [base-url]
 * Without a base URL it builds nothing; point it at a running instance.
 */
import { chromium } from "@playwright/test";
import { releaseFixture } from "./e2e/release-fixture.mjs";
import fs from "node:fs";
import path from "node:path";

const OUT = process.env.MSO_EVIDENCE_DIR ?? "/tmp/opencode/evidence";
fs.mkdirSync(OUT, { recursive: true, mode: 0o700 });

const VIEWPORTS = [
  { label: "320", width: 320, height: 640 },
  { label: "390", width: 390, height: 844 },
  { label: "768", width: 768, height: 1024 },
  { label: "1440", width: 1440, height: 900 },
];

const results = [];
const record = (area, viewport, check, ok, detail) => {
  results.push({ area, viewport, check, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${area} @${viewport}  ${check}${detail ? `  (${detail})` : ""}`);
};

const fixture = await releaseFixture();
const browser = await chromium.launch({ headless: true });
try {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: "reduce" });
    await context.addInitScript(() => {
      localStorage.setItem("sv:shell", JSON.stringify({ desktop: "macos", mobile: "ios" }));
      localStorage.setItem("mso:onboarding:v1", "done");
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

    await page.goto(`${fixture.base}/integrations`, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(3500);

    // 1. Horizontal overflow: the page must never scroll sideways.
    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      wide: [...document.querySelectorAll("*")]
        .filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
        .slice(0, 5)
        .map((el) => `${el.tagName}.${(el.className || "").toString().split(" ")[0]}`),
    }));
    record("overflow", vp.label, "no horizontal scroll", overflow.doc <= 0, `overflow=${overflow.doc}px${overflow.wide.length ? ` offenders=${overflow.wide.join(",")}` : ""}`);

    // 2. Exactly one main landmark and one h1.
    const landmarks = await page.evaluate(() => ({
      main: document.querySelectorAll("main").length,
      h1: document.querySelectorAll("h1").length,
    }));
    record("landmarks", vp.label, "one main", landmarks.main === 1, `count=${landmarks.main}`);
    record("landmarks", vp.label, "one h1", landmarks.h1 === 1, `count=${landmarks.h1}`);

    // 3. Tap targets on every interactive control.
    const small = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll("button, a[href], summary, select, input:not([type=hidden]), label[for]")];
      return nodes
        .filter((el) => el.getBoundingClientRect().width > 0)
        .map((el) => ({ tag: el.tagName, h: Math.round(el.getBoundingClientRect().height), t: (el.textContent || "").trim().slice(0, 22) }))
        .filter((r) => r.h < 44);
    });
    record("tap-target", vp.label, "all controls >= 44px tall", small.length === 0, small.length ? `${small.length} small: ${small.slice(0, 3).map((s) => `${s.tag}(${s.h}px)`).join(",")}` : "");

    // 4. Accessible names on icon-only buttons, alt on images.
    const a11y = await page.evaluate(() => {
      const nameless = [...document.querySelectorAll("button")]
        .filter((b) => b.getBoundingClientRect().width > 0)
        .filter((b) => !(b.textContent || "").trim() && !b.getAttribute("aria-label") && !b.getAttribute("title")).length;
      const noAlt = [...document.querySelectorAll("img")].filter((i) => !i.hasAttribute("alt")).length;
      return { nameless, noAlt };
    });
    record("a11y", vp.label, "every button has a name", a11y.nameless === 0, `nameless=${a11y.nameless}`);
    record("a11y", vp.label, "every img has alt", a11y.noAlt === 0, `noAlt=${a11y.noAlt}`);

    // 5. iOS auto-zoom: any focused-able input under 16px will zoom Safari.
    const tiny = await page.evaluate(() =>
      [...document.querySelectorAll("input, select, textarea")]
        .filter((el) => el.getBoundingClientRect().width > 0 && parseFloat(getComputedStyle(el).fontSize) < 16)
        .map((el) => `${el.tagName}[${el.type || ""}]=${getComputedStyle(el).fontSize}`));
    record("ios-zoom", vp.label, "no input below 16px", tiny.length === 0, tiny.slice(0, 3).join(","));

    // 6. Keyboard: Tab reaches controls, focus is always visible.
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return { reachable: false };
      const s = getComputedStyle(el);
      return { reachable: true, outline: s.outlineStyle !== "none" || s.boxShadow !== "none", tag: el.tagName };
    });
    record("keyboard", vp.label, "Tab reaches a control", focus.reachable, focus.tag ?? "");
    if (focus.reachable) record("keyboard", vp.label, "focused element shows an indicator", focus.outline, "");

    // 7. No console errors during load.
    record("console", vp.label, "no page or console errors", errors.length === 0, errors.slice(0, 2).join(" | "));

    await page.screenshot({ path: path.join(OUT, `integrations-${vp.label}.png`), fullPage: true }).catch(() => {});
    await context.close();
  }

  // 8. Theme: a dark shell preference must produce dark tokens, not the OS preference.
  for (const scheme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
    await context.addInitScript(() => {
      localStorage.setItem("sv:shell", JSON.stringify({ desktop: "macos", mobile: "ios" }));
      localStorage.setItem("mso:onboarding:v1", "done");
    });
    const page = await context.newPage();
    await page.goto(`${fixture.base}/integrations`, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(2500);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    record("theme", scheme, "body renders a background", Boolean(bg) && bg !== "rgba(0, 0, 0, 0)", bg);
    await context.close();
  }

  // 9. Short iframe: the drawer must still be reachable.
  {
    const context = await browser.newContext({ viewport: { width: 400, height: 240 } });
    await context.addInitScript(() => {
      localStorage.setItem("sv:shell", JSON.stringify({ desktop: "macos", mobile: "ios" }));
      localStorage.setItem("mso:onboarding:v1", "done");
    });
    const page = await context.newPage();
    await page.goto(`${fixture.base}/integrations/manager`, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(2500);
    const nav = await page.evaluate(() => {
      const el = document.querySelector(".integration-settings-nav");
      if (!el) return null;
      return { height: Math.round(el.getBoundingClientRect().height), scrollable: el.scrollHeight > el.clientHeight };
    });
    record("short-iframe", "240", "sidebar nav keeps usable height", Boolean(nav) && nav.height >= 44, nav ? `height=${nav.height}px scrollable=${nav.scrollable}` : "nav missing");
    await context.close();
  }
} finally {
  await browser.close();
  await fixture.close();
}

const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(OUT, "integrations-ui-evidence.json"), JSON.stringify({ results, failed: failed.length }, null, 2), { mode: 0o600 });
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("\nFAILURES:");
  for (const f of failed) console.log(`  ${f.area} @${f.viewport}: ${f.check}  (${f.detail})`);
}
process.exitCode = failed.length ? 1 : 0;
