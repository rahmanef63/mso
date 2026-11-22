import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CHROME_PROFILES } from "../src/lib/shell/chrome-profile.ts";
import {
  clampFontScale,
  DEFAULT_FONT_SCALE,
  DESKTOP_ICONS,
  MAX_FONT_SCALE,
  MIN_FONT_SCALE,
  visibleDesktopIcons,
} from "../src/lib/shell/desktop-icons-data.ts";

test("DESKTOP_ICONS enforces unique app ids, unique badges, and clean titles", () => {
  assert.ok(DESKTOP_ICONS.length >= 15, "expected core MSO apps in DESKTOP_ICONS");

  const apps = new Set<string>();
  const badges = new Set<string>();
  let ownerOnlyCount = 0;
  let sharedCount = 0;

  for (const icon of DESKTOP_ICONS) {
    assert.match(icon.app, /^[a-z0-9-]+$/, `invalid app id: ${icon.app}`);
    assert.equal(apps.has(icon.app), false, `duplicate app id: ${icon.app}`);
    apps.add(icon.app);

    assert.match(icon.badge, /^[A-Z0-9]{2,3}$/, `invalid badge: ${icon.badge}`);
    assert.equal(badges.has(icon.badge), false, `duplicate badge: ${icon.badge}`);
    badges.add(icon.badge);

    assert.ok(icon.title.trim().length > 0, `empty title for ${icon.app}`);
    assert.equal(icon.title.includes("\u2014"), false, `em dash in title for ${icon.app}`);

    if (icon.ownerOnly) ownerOnlyCount += 1;
    else sharedCount += 1;
  }

  assert.ok(sharedCount > 0, "expected shared apps visible to non-owners");
  assert.ok(ownerOnlyCount > 0, "expected owner-only apps");
  for (const required of ["assistant", "files", "settings", "inspector", "terminal", "devices"]) {
    assert.equal(apps.has(required), true, `missing expected app: ${required}`);
  }
});

test("visibleDesktopIcons hides ownerOnly apps for non-owners and includes all for owner", () => {
  const ownerIcons = visibleDesktopIcons("owner");
  assert.equal(ownerIcons.length, DESKTOP_ICONS.length);
  assert.notEqual(ownerIcons, DESKTOP_ICONS);
  assert.ok(ownerIcons.some((icon) => icon.app === "terminal" && icon.ownerOnly));
  assert.ok(ownerIcons.some((icon) => icon.app === "devices" && icon.ownerOnly));

  const expectedShared = DESKTOP_ICONS.filter((icon) => !icon.ownerOnly);
  for (const nonOwnerRole of ["viewer", "operator", null, undefined] as const) {
    const visible = visibleDesktopIcons(nonOwnerRole);
    assert.equal(visible.length, expectedShared.length);
    assert.equal(
      visible.every((icon) => !icon.ownerOnly),
      true,
      `non-owner role ${String(nonOwnerRole)} should not receive ownerOnly icons`,
    );
    assert.deepEqual(
      visible.map((icon) => icon.app),
      expectedShared.map((icon) => icon.app),
    );
  }
});

test("clampFontScale bounds values to 0.9..1.2 and guards non-finite input", () => {
  assert.equal(MIN_FONT_SCALE, 0.9);
  assert.equal(MAX_FONT_SCALE, 1.2);
  assert.equal(DEFAULT_FONT_SCALE, 1);

  assert.equal(clampFontScale(0.5), 0.9);
  assert.equal(clampFontScale(0.89), 0.9);
  assert.equal(clampFontScale(0.9), 0.9);
  assert.equal(clampFontScale(0.95), 0.95);
  assert.equal(clampFontScale(1), 1);
  assert.equal(clampFontScale(1.05), 1.05);
  assert.equal(clampFontScale(1.1000000000000001), 1.1);
  assert.equal(clampFontScale(1.2), 1.2);
  assert.equal(clampFontScale(1.21), 1.2);
  assert.equal(clampFontScale(3.5), 1.2);

  assert.equal(clampFontScale(Number.NaN), 1);
  assert.equal(clampFontScale(Number.POSITIVE_INFINITY), 1);
  assert.equal(clampFontScale(Number.NEGATIVE_INFINITY), 1);
});

test("os-chrome.css covers all 5 OS chrome profiles and shell files contain no em dashes", () => {
  const css = readFileSync(new URL("../src/lib/shell/os-chrome.css", import.meta.url), "utf8");
  for (const profile of CHROME_PROFILES) {
    assert.equal(
      css.includes(`.workspace[data-chrome="${profile.id}"]`),
      true,
      `missing CSS selector for chrome profile: ${profile.id}`,
    );
  }

  const files = [
    "../src/lib/shell/DesktopIcons.svelte",
    "../src/lib/shell/WidgetsBar.svelte",
    "../src/lib/shell/ShellSettingsApp.svelte",
    "../src/lib/shell/desktop-icons-data.ts",
    "../src/lib/shell/os-chrome.css",
  ];
  for (const rel of files) {
    const content = readFileSync(new URL(rel, import.meta.url), "utf8");
    assert.equal(content.includes("\u2014"), false, `found em dash in ${rel}`);
  }
});
