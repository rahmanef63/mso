import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { APPLE_CHROME, APPLE_MOTION, APPLE_Z } from "../src/lib/shell/apple-config.ts";
import {
  APPLE_DEVICES,
  APPLE_DEVICE_BY_ID,
  appleDeviceToChrome,
  appleModeFromProp,
  appleSwitchSegments,
  resolveAppleDevice,
} from "../src/lib/shell/apple-devices.ts";
import {
  APPLE_ACCENTS,
  APPLE_WALLPAPERS,
  appleThemeCssString,
  appleWallpaperCss,
  appleWallpaperFilter,
  computeAppleVars,
} from "../src/lib/shell/apple-theme.ts";
import { eqAppleColor, formatAppleClock, shadeHex } from "../src/lib/shell/apple-utils.ts";

const SHELL_DIR = resolve(import.meta.dirname, "../src/lib/shell");
const OWNED_FILES = [
  resolve(SHELL_DIR, "apple-config.ts"),
  resolve(SHELL_DIR, "apple-devices.ts"),
  resolve(SHELL_DIR, "apple-theme.ts"),
  resolve(SHELL_DIR, "apple-utils.ts"),
  resolve(SHELL_DIR, "AppleIcons.svelte"),
  resolve(SHELL_DIR, "AppleDeviceSwitcher.svelte"),
  resolve(import.meta.dirname, "apple-shell.test.ts"),
];

test("apple-config matches motion, chrome geometry, and z-index scale", () => {
  assert.deepEqual(APPLE_MOTION, { base: ".42s", fast: ".2s" });
  assert.equal(APPLE_CHROME.macToolbar, 52);
  assert.equal(APPLE_CHROME.macMenuBar, 26);
  assert.equal(APPLE_CHROME.phoneStatus, 44);
  assert.equal(APPLE_CHROME.phoneTabBar, 92);
  assert.equal(APPLE_CHROME.padToolbar, 48);
  assert.ok(APPLE_Z.wall < APPLE_Z.screen && APPLE_Z.screen < APPLE_Z.chrome);
  assert.ok(APPLE_Z.dock < APPLE_Z.menuBar && APPLE_Z.menuBar < APPLE_Z.menuDrop);
  assert.ok(APPLE_Z.ctx < APPLE_Z.toast && APPLE_Z.toast < APPLE_Z.preview);
});

test("apple-devices resolves viewports, switch segments, and chrome mappings", () => {
  assert.equal(APPLE_DEVICES.length, 3);
  assert.equal(APPLE_DEVICE_BY_ID.ios.formFactor, "phone");
  assert.equal(APPLE_DEVICE_BY_ID.ipad.formFactor, "tablet");
  assert.equal(APPLE_DEVICE_BY_ID.mac.formFactor, "desktop");
  assert.equal(APPLE_DEVICE_BY_ID.ios.frame?.w, 402);
  assert.equal(APPLE_DEVICE_BY_ID.ipad.frame?.w, 1024);
  assert.equal(APPLE_DEVICE_BY_ID.mac.frame, null);

  assert.equal(resolveAppleDevice(320), "ios");
  assert.equal(resolveAppleDevice(759), "ios");
  assert.equal(resolveAppleDevice(760), "ipad");
  assert.equal(resolveAppleDevice(1199), "ipad");
  assert.equal(resolveAppleDevice(1200), "mac");
  assert.equal(resolveAppleDevice(1920), "mac");
  assert.equal(resolveAppleDevice(Number.NaN), "mac");

  assert.equal(appleModeFromProp("iPhone"), "ios");
  assert.equal(appleModeFromProp("iPad"), "ipad");
  assert.equal(appleModeFromProp("Mac"), "mac");
  assert.equal(appleModeFromProp("auto"), "auto");
  assert.equal(appleModeFromProp("unknown"), "auto");

  const segs = appleSwitchSegments();
  assert.deepEqual(segs.map((s) => s.id), ["auto", "ios", "ipad", "mac"]);
  assert.equal(segs[0].icon, "dev-auto");

  assert.equal(appleDeviceToChrome("auto"), "auto");
  assert.equal(appleDeviceToChrome("ios"), "ios");
  assert.equal(appleDeviceToChrome("ipad"), "ios");
  assert.equal(appleDeviceToChrome("mac"), "macos");
});

test("apple-theme computes tokens, a11y overrides, CSS strings, and wallpapers", () => {
  assert.ok(APPLE_ACCENTS.includes("#0a84ff"));
  assert.deepEqual(Object.keys(APPLE_WALLPAPERS), ["aurora", "graphite", "sunset"]);

  const darkVars = computeAppleVars(true, {}, "#bf5af2");
  assert.equal(darkVars.bg, "#1c1c1e");
  assert.equal(darkVars.grouped, "#000000");
  assert.equal(darkVars.tint, "#bf5af2");
  assert.equal(darkVars.blur, "26px");

  const lightVars = computeAppleVars(false, { reduceTransparency: true, increaseContrast: true });
  assert.equal(lightVars.bg, "#ffffff");
  assert.equal(lightVars.blur, "0px");
  assert.equal(lightVars.glassBg, "#f4f4f6");
  assert.equal(lightVars.glassHi, "transparent");
  assert.equal(lightVars.label, "#000000");
  assert.equal(lightVars.glassStroke, "rgba(0,0,0,.5)");

  const css = appleThemeCssString(darkVars, "0s", "0s");
  assert.match(css, /--bg:#1c1c1e;/);
  assert.match(css, /--glass-shadow:rgba\(0,0,0,\.55\);/);
  assert.match(css, /--tint:#bf5af2;/);
  assert.match(css, /--dur:0s;--durF:0s;/);

  assert.equal(appleWallpaperCss("aurora", true), APPLE_WALLPAPERS.aurora.dark);
  assert.equal(appleWallpaperCss("sunset", false), APPLE_WALLPAPERS.sunset.light);
  assert.equal(appleWallpaperCss("missing", true), APPLE_WALLPAPERS.aurora.dark);

  assert.equal(appleWallpaperFilter(74, false), "brightness(1.00)");
  assert.equal(
    appleWallpaperFilter(100, true),
    "brightness(1.14) sepia(.34) saturate(1.14) hue-rotate(-14deg)",
  );
  assert.equal(appleWallpaperFilter(0, false), "brightness(0.62)");
});

test("apple-utils formats clocks without em dashes and shades hex colors", () => {
  const morning = formatAppleClock(new Date(2026, 4, 12, 9, 5));
  assert.equal(morning.t12, "9:05");
  assert.equal(morning.macClock, "Tue 12 May  9:05 AM");
  assert.equal(morning.padStatusLeft, "9:05  \u00b7  Tue 12 May");

  const midnight = formatAppleClock(new Date(2026, 0, 1, 0, 0));
  assert.equal(midnight.t12, "12:00");
  assert.match(midnight.macClock, /12:00 AM$/);

  const noon = formatAppleClock(new Date(2026, 0, 1, 12, 30));
  assert.equal(noon.t12, "12:30");
  assert.match(noon.macClock, /12:30 PM$/);

  assert.equal(shadeHex("#0a84ff"), "#075ab8");
  assert.equal(shadeHex("invalid"), "invalid");
  assert.equal(eqAppleColor("#0A84FF", "#0a84ff"), true);
});

test("static guardrails: line lengths, file lengths, zero em dashes, icons, switcher", () => {
  const emDash = String.fromCharCode(0x2014);
  for (const file of OWNED_FILES) {
    const text = readFileSync(file, "utf8");
    assert.equal(text.includes(emDash), false, `em dash found in ${file}`);
    const lines = text.split("\n");
    if (file.endsWith(".ts")) {
      assert.ok(lines.length <= 180, `${file} exceeds 180 lines (${lines.length})`);
    }
    for (let i = 0; i < lines.length; i += 1) {
      assert.ok(lines[i].length <= 380, `${file}:${i + 1} exceeds 380 chars (${lines[i].length})`);
    }
    if (!file.endsWith(".test.ts")) {
      assert.equal(/localStorage|sessionStorage/.test(text), false, `web storage in ${file}`);
      assert.equal(/window\.(confirm|alert|prompt)/.test(text), false, `modal dialog in ${file}`);
    }
  }

  const icons = readFileSync(resolve(SHELL_DIR, "AppleIcons.svelte"), "utf8");
  const requiredSymbols = [
    "g-apple", "g-chevron-right", "g-chevron-left", "g-check", "g-search", "g-wifi",
    "g-bluetooth", "g-gear", "g-bell", "g-speaker", "g-moon", "g-sun", "g-accessibility",
    "g-globe", "g-clock", "g-folder-fill", "g-folder", "g-download", "g-cloud", "g-people",
    "g-disk", "g-share", "g-grid", "g-list", "g-sliders", "g-trash", "g-info", "g-plus",
    "g-lock", "g-textsize", "g-photo", "g-xmark", "g-arrowup", "g-compose",
    "dev-iphone", "dev-ipad", "dev-mac", "dev-auto",
    "a-trash", "a-settings", "a-files", "a-notes", "a-mail", "a-music", "a-photos",
    "a-safari", "a-messages", "a-maps", "a-sandbox",
  ];
  for (const id of requiredSymbols) {
    assert.ok(icons.includes(`id="${id}"`), `AppleIcons.svelte missing symbol #${id}`);
  }

  const switcher = readFileSync(resolve(SHELL_DIR, "AppleDeviceSwitcher.svelte"), "utf8");
  assert.ok(switcher.includes('type="button"'));
  assert.ok(switcher.includes("aria-label="));
  assert.ok(switcher.includes("aria-pressed="));
  assert.ok(switcher.includes("@media (max-width: 767px)"));
  assert.ok(switcher.includes('data-reduced-motion="true"'));
  assert.ok(switcher.includes('data-reduce-glass="true"'));
});
