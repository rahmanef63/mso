import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readRel = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

function maxZIndex(src: string): number {
  let max = 0;
  for (const match of src.matchAll(/z-index\s*:\s*(\d+)/g)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > max) max = value;
  }
  return max;
}

test("WindowsTaskbar exposes Task View accessible name and optional onToggleApp fallback", () => {
  const src = readRel("../src/lib/shell/WindowsTaskbar.svelte");
  assert.equal(src.includes('aria-label="Task View"'), true, "Task View button must use aria-label='Task View'");
  assert.equal(src.includes('title="Task View"'), true, "Task View button must keep title='Task View'");
  assert.equal(
    src.includes('aria-label="Mission Control"'),
    false,
    "WindowsTaskbar must not label Task View as Mission Control",
  );
  assert.match(src, /onToggleApp\?\s*:\s*\(item:\s*DockAppDef\)\s*=>\s*void/);
  assert.equal(src.includes("if (onToggleApp)"), true, "WindowsTaskbar must invoke onToggleApp when supplied");
  assert.equal(
    src.includes("onOpenApp(item.app, item.title, item.payload, item.multi)"),
    true,
    "WindowsTaskbar must fall back to onOpenApp when onToggleApp is omitted",
  );
  assert.equal(src.includes("onclick={() => handleAppClick(item)}"), true);
});

test("MacosDock exposes optional onFocusOrOpenApp fallback and respects reducedMotion", () => {
  const src = readRel("../src/lib/shell/MacosDock.svelte");
  assert.match(src, /onFocusOrOpenApp\?\s*:\s*\(item:\s*DockAppDef\)\s*=>\s*void/);
  assert.equal(
    src.includes("if (onFocusOrOpenApp)"),
    true,
    "MacosDock must invoke onFocusOrOpenApp when supplied",
  );
  assert.equal(
    src.includes("onOpenApp(item.app, item.title, item.payload, item.multi)"),
    true,
    "MacosDock must fall back to onOpenApp when onFocusOrOpenApp is omitted",
  );
  assert.equal(src.includes("onclick={() => handleAppClick(slot.item)}"), true);
  assert.equal(src.includes('dataset.reducedMotion === "true"'), true);
});

test("LockScreen sits above dock/menu bar, auto-focuses Unlock, traps Tab, supports Enter/Space, and has no em dashes", () => {
  const lockSrc = readRel("../src/lib/shell/LockScreen.svelte");
  const dockSrc = readRel("../src/lib/shell/MacosDock.svelte");
  const taskbarSrc = readRel("../src/lib/shell/WindowsTaskbar.svelte");
  const menuSrc = readRel("../src/lib/shell/MacosMenuBar.svelte");

  const lockZ = maxZIndex(lockSrc);
  const highestShellChromeZ = Math.max(maxZIndex(dockSrc), maxZIndex(taskbarSrc), maxZIndex(menuSrc));
  assert.ok(lockZ >= 1200, `LockScreen z-index (${lockZ}) must be >= 1200`);
  assert.ok(
    lockZ > highestShellChromeZ,
    `LockScreen z-index (${lockZ}) must sit above dock/taskbar/menubar (${highestShellChromeZ})`,
  );

  assert.equal(lockSrc.includes("onMount("), true, "LockScreen must auto-focus on mount");
  assert.equal(lockSrc.includes("unlockBtn?.focus()"), true, "LockScreen must focus Unlock button");
  assert.equal(lockSrc.includes('event.key === "Tab"'), true, "LockScreen must trap Tab key");
  assert.equal(lockSrc.includes("event.shiftKey"), true, "LockScreen must handle Shift+Tab wrap");
  assert.equal(
    lockSrc.includes('event.key === "Enter" || event.key === " "'),
    true,
    "LockScreen must support Enter and Space unlock",
  );
  assert.equal(lockSrc.includes("\u2014"), false, "LockScreen must contain zero em dashes");
});

test("os-chrome.css implements iOS Modern glass chrome, solid app surfaces, and accessibility fallbacks", () => {
  const css = readRel("../src/lib/shell/os-chrome.css");
  const ios = readRel("../src/lib/shell/IosHomeScreen.svelte");

  for (const selector of [
    '.workspace[data-chrome="ios"][data-ios-style="modern"] .ios-shell .ios-status-bar.workspace-header',
    '.workspace[data-chrome="ios"][data-ios-style="modern"] .ios-shell .ios-brand-pill',
    '.workspace[data-chrome="ios"][data-ios-style="modern"] .ios-shell .ios-glass-pill',
    '.workspace[data-chrome="ios"][data-ios-style="modern"] .ios-shell .ios-dock.app-dock',
    '.workspace[data-chrome="ios"][data-ios-style="modern"] .ios-shell .ios-home-pill',
  ]) {
    assert.equal(css.includes(selector), true, `os-chrome.css missing iOS Modern selector: ${selector}`);
  }

  assert.equal(
    css.includes("inset 0 0.5px 0 rgba(255, 255, 255, 0.48)"),
    true,
    "iOS Modern glass material must include subtle inner specular highlight",
  );
  assert.equal(
    css.includes('.workspace[data-chrome="ios"][data-ios-style="modern"] .ios-sheet-windows .win-frame'),
    true,
    "iOS Modern must preserve solid app window surfaces",
  );
  assert.equal(
    css.includes('.workspace[data-chrome="ios"][data-ios-style="modern"] .ios-library-sheet'),
    true,
    "iOS Modern must preserve solid App Library sheet surface",
  );

  for (const a11yRule of [
    ':root[data-reduce-glass="true"] .workspace[data-chrome="ios"][data-ios-style="modern"]',
    ':root[data-high-contrast="true"] .workspace[data-chrome="ios"][data-ios-style="modern"]',
    ':root[data-reduced-motion="true"] .workspace[data-chrome="ios"][data-ios-style="modern"]',
  ]) {
    assert.equal(css.includes(a11yRule), true, `os-chrome.css missing accessibility fallback: ${a11yRule}`);
  }

  assert.equal(ios.includes("flex-wrap: nowrap;"), true, "IosHomeScreen status bar should stay compact on mobile");
  assert.equal(ios.includes("\u2014"), false, "IosHomeScreen must contain zero em dashes");
});

test("All shell-modern-polish owned files keep line length <= 400 and zero em dashes", () => {
  const files = [
    "../src/lib/files/FilesManager.svelte",
    "../src/lib/shell/WindowsTaskbar.svelte",
    "../src/lib/shell/MacosDock.svelte",
    "../src/lib/shell/LockScreen.svelte",
    "../src/lib/shell/IosHomeScreen.svelte",
    "../src/lib/shell/os-chrome.css",
  ];
  for (const rel of files) {
    const src = readRel(rel);
    assert.equal(src.includes("\u2014"), false, `found em dash (U+2014) in ${rel}`);
    const maxLen = Math.max(...src.split("\n").map((line) => line.length));
    assert.ok(maxLen <= 400, `${rel} has line of ${maxLen} chars (> 400 limit)`);
  }

  const filesMgr = readRel("../src/lib/files/FilesManager.svelte");
  const lines = filesMgr.split("\n").length - (filesMgr.endsWith("\n") ? 1 : 0);
  assert.ok(lines <= 210, `FilesManager.svelte has ${lines} lines (limit 210)`);
});
