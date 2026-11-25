import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveAppIcon, squircleIconDataUri } from "../src/lib/shell/app-icons.ts";
import { DOCK_APPS } from "../src/lib/shell/shell-registry.ts";
import { DESKTOP_ICONS } from "../src/lib/shell/desktop-icons-data.ts";

const readRel = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const SHELL_FILES = [
  "../src/lib/shell/MacosMenuBar.svelte",
  "../src/lib/shell/MacosDock.svelte",
  "../src/lib/shell/ControlCenter.svelte",
  "../src/lib/shell/WindowFrame.svelte",
  "../src/lib/shell/AppSquircleIcon.svelte",
  "../src/lib/shell/AppleSegmented.svelte",
  "../src/lib/shell/app-icons.ts",
  "../src/lib/shell/desktop-icons-data.ts",
];

test("every Dock and Desktop app resolves to real icon art, never a bare monogram box", () => {
  const dockApps = new Set(DOCK_APPS.map((item) => item.app));
  for (const icon of DESKTOP_ICONS) dockApps.add(icon.app);

  const withoutArt: string[] = [];
  for (const app of dockApps) {
    const visual = resolveAppIcon(app, "macos");
    if (!visual.image) withoutArt.push(app);
    else assert.ok(
      visual.image.startsWith("/app-icons/") || visual.image.startsWith("data:image/svg+xml"),
      `${app} resolved an unexpected icon source: ${visual.image}`,
    );
    assert.ok(visual.gradient.includes("linear-gradient"), `${app} needs a squircle gradient`);
  }
  assert.deepEqual(withoutArt, [], `apps without squircle art: ${withoutArt.join(", ")}`);
});

test("apps without a .webp asset get an inline SVG squircle, and cached URIs stay stable", () => {
  for (const app of [
    "workflows", "camoufox", "apps", "services", "packages", "organization",
    "n8n", "pickers", "clipboard", "devices", "infra", "memory",
    "agent-group", "bot-desktops",
  ]) {
    const uri = squircleIconDataUri(app);
    assert.ok(uri.startsWith("data:image/svg+xml"), `${app} must use an inline SVG squircle`);
    assert.equal(squircleIconDataUri(app), uri, `${app} squircle URI must be cached`);
    assert.equal(uri.includes("<text"), false, `${app} squircle must be a glyph, not typed text`);
  }
  assert.equal(
    resolveAppIcon("files", "macos").image,
    "/app-icons/macos/files.webp",
    "existing .webp apps must keep their asset",
  );
  assert.equal(
    resolveAppIcon("files", "windows").image,
    "/app-icons/windows/files.webp",
    "the windows chrome dir must stay intact",
  );
});

test("macOS menubar drops the fabricated battery and keeps the E2E selector contract", () => {
  const src = readRel("../src/lib/shell/MacosMenuBar.svelte");
  assert.equal(src.includes("87%"), false, "hardcoded 87% battery must be gone");
  assert.equal(src.includes("getBattery"), true, "battery must come from navigator.getBattery when available");
  assert.equal(src.includes("batteryLevel === null"), true, "battery must render only when a real level exists");
  assert.equal(src.includes('aria-label="Shell chrome"'), true, "keep the Shell chrome select for E2E");
  assert.equal(src.includes('aria-label="Sign out"'), true, "keep the Sign out button name for E2E");
  assert.equal(src.includes("data-host-online"), true, "menubar needs a live host status indicator");
  assert.match(src, /\.status-select\s*\{[^}]*background:\s*transparent;/, "Shell chrome select must be borderless");
  assert.match(src, /\.status-select\s*\{[^}]*border:\s*0;/, "Shell chrome select must have no border");
  assert.match(src, /\.status-signout-btn\s*\{[^}]*border:\s*0;/, "Sign out must be a borderless menu item");
  assert.match(src, /\.status-signout-btn\s*\{[^}]*background:\s*transparent;/, "Sign out must be transparent");
});

test("dock bounces launches for ~520ms and gives Trash real feedback", () => {
  const src = readRel("../src/lib/shell/MacosDock.svelte");
  assert.equal(src.includes("@keyframes bounceUp"), true, "dock needs a bounceUp keyframe");
  assert.match(src, /animation:\s*bounceUp\s*520ms/, "bounce must run ~520ms");
  assert.equal(src.includes("const BOUNCE_MS = 520"), true, "bounce duration must be a named constant");
  assert.equal(src.includes("triggerBounce"), true, "launching an app must trigger the bounce");
  assert.equal(src.includes("onTrash?"), true, "Trash must offer a host hook");
  assert.equal(src.includes("dock-toast"), true, "Trash must fall back to a real toast");
  assert.equal(src.includes('data-reduced-motion="true"'), true, "bounce must respect reduced motion");
});

test("Command Center resolves dark mode from a prop instead of normalizedTheme", () => {
  const src = readRel("../src/lib/shell/ControlCenter.svelte");
  assert.equal(src.includes("isDark?"), true, "ControlCenter must accept the resolved isDark prop");
  assert.equal(
    src.includes('normalizedTheme !== "light"'),
    false,
    "normalizedTheme must not decide dark mode",
  );
  assert.equal(src.includes("prefers-color-scheme: dark"), true, "fallback must read the media query");
  assert.equal(src.includes("AppleSegmented"), true, "theme picker must use AppleSegmented");
  assert.equal(src.includes("applyAppearanceToDom"), true, "Reduce Glass and High Contrast must hit the DOM");
  assert.equal(src.includes("navigator.clipboard.writeText"), true, "Share must copy the workspace URL");
  assert.equal(src.includes('role="status"'), true, "every safe action needs a real toast");
  assert.equal(src.includes('aria-label="Shell chrome"'), true, "keep the Shell chrome select reachable");
});

test("window frame offers a titlebar toolbar slot and dims unfocused traffic lights", () => {
  const src = readRel("../src/lib/shell/WindowFrame.svelte");
  assert.equal(src.includes("toolbarActions?: Snippet"), true, "WindowFrame must accept toolbarActions");
  assert.equal(src.includes("{@render toolbarActions()}"), true, "toolbarActions must render in the title bar");
  assert.match(
    src,
    /\.win-frame\[data-chrome="macos"\]:not\(\.focused\) \.win-btn\s*\{[^}]*opacity:\s*0?\.\d+/,
    "unfocused traffic lights must be visibly dimmed",
  );
});

test("shell files keep zero em dashes and stay under the 400 char line ratchet", () => {
  for (const rel of SHELL_FILES) {
    const src = readRel(rel);
    assert.equal(src.includes("\u2014"), false, `found em dash in ${rel}`);
    const longest = Math.max(...src.split("\n").map((line) => line.length));
    assert.ok(longest <= 400, `${rel} has a ${longest} char line (> 400)`);
  }
});
