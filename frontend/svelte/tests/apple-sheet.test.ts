import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readRel = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const sheetSrc = readRel("../src/lib/shell/AppleSheet.svelte");
const toastSrc = readRel("../src/lib/shell/NotificationToast.svelte");

test("AppleSheet exports the three sheet modes and its prop contract", () => {
  assert.equal(sheetSrc.includes('export type AppleSheetKind = "share" | "actions" | "form";'), true);
  assert.equal(sheetSrc.includes("export type AppleSheetAction"), true);
  assert.equal(sheetSrc.includes("export type AppleSheetShareApp"), true);
  assert.equal(sheetSrc.includes("export type AppleSheetProps"), true);
  assert.match(sheetSrc, /kind:\s*AppleSheetKind;/);
  assert.match(sheetSrc, /readonly actions\?:\s*ReadonlyArray<AppleSheetAction>;/);
  assert.match(sheetSrc, /readonly shareApps\?:\s*ReadonlyArray<AppleSheetShareApp>;/);
  assert.match(sheetSrc, /readonly onClose:\s*\(\)\s*=>\s*void;/);
});

test("AppleSheet renders an accessible modal with escape and backdrop dismissal", () => {
  assert.equal(sheetSrc.includes('role="dialog"'), true);
  assert.equal(sheetSrc.includes('aria-modal="true"'), true);
  assert.match(sheetSrc, /aria-label=\{title\}/);
  assert.equal(sheetSrc.includes('event.key === "Escape"'), true);
  assert.equal(sheetSrc.includes("if (event.target === event.currentTarget) onClose();"), true);
  assert.match(sheetSrc, /dialogEl\?\.focus\(\)/);
  assert.equal(sheetSrc.includes('bind:this={dialogEl}'), true);
});

test("AppleSheet uses sheetUp on mobile and ccIn on desktop glass dialog", () => {
  assert.match(sheetSrc, /animation:\s*sheetUp/);
  assert.match(sheetSrc, /animation:\s*ccIn/);
  assert.match(sheetSrc, /width:\s*min\(380px/);
  assert.match(sheetSrc, /border-radius:\s*22px/);
  assert.match(sheetSrc, /width:\s*36px;\s*\n\s*height:\s*5px;/);
  assert.equal(sheetSrc.includes("aos-sheet-cancel-card"), true);
  assert.equal(sheetSrc.includes("aria-label=\"Close\""), true);
});

test("AppleSheet keeps a destructive tint while light theme stays WCAG AA", () => {
  assert.equal(sheetSrc.includes("--sheet-danger"), true);
  assert.match(sheetSrc, /--sheet-danger:\s*#d70015;/);
  assert.match(sheetSrc, /--sheet-danger:\s*#ff453a;/);
});

test("NotificationToast stays a floating glass pill with preserved a11y contracts", () => {
  assert.equal(toastSrc.includes('role="status"') || toastSrc.includes('"alert" | "status"'), true);
  assert.equal(toastSrc.includes('role={roleFor(item.tone)}'), true);
  assert.match(toastSrc, /return tone === "error" \|\| tone === "warn" \? "alert" : "status";/);
  assert.equal(toastSrc.includes("data-toast-id={item.id}"), true);
  assert.equal(toastSrc.includes("data-tone={item.tone}"), true);
  assert.equal(toastSrc.includes("aria-label={`Dismiss ${item.title}`}"), true);
  assert.equal(toastSrc.includes('aria-live="polite"'), true);
});

test("NotificationToast pill geometry, glass treatment, and motion are pinned", () => {
  assert.match(toastSrc, /bottom:\s*72px;/);
  assert.match(toastSrc, /bottom:\s*110px;/);
  assert.match(toastSrc, /left:\s*50%;/);
  assert.match(toastSrc, /transform:\s*translateX\(-50%\);/);
  assert.match(toastSrc, /border-radius:\s*14px;/);
  assert.match(toastSrc, /background:\s*var\(--glass-bg\);/);
  assert.match(toastSrc, /backdrop-filter:\s*blur\(30px\) saturate\(180%\);/);
  assert.match(toastSrc, /border:\s*0\.5px solid var\(--glass-stroke\);/);
  assert.match(toastSrc, /animation:\s*toastIn 0\.2s/);
});

test("shell sheet and toast copy avoids em dashes", () => {
  for (const [name, src] of [
    ["AppleSheet.svelte", sheetSrc],
    ["NotificationToast.svelte", toastSrc],
  ] as const) {
    assert.equal(src.includes("\u2014"), false, `${name} must not contain U+2014`);
  }
});
