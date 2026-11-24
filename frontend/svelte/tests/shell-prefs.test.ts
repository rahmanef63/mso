import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyQuickShellChoice,
  buildShellTweaksPatch,
  DEFAULT_SHELL_PREFS,
  extractAppearanceFromTweaks,
  extractShellPrefsFromTweaks,
  readLocalShellPrefs,
  resolveActiveShell,
  SHELL_STORAGE_KEY,
  writeLocalShellPrefs,
  type StorageLike,
} from "../src/lib/shell/shell-prefs-store.ts";

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem(k: string) { return Object.hasOwn(data, k) ? data[k] : null; },
    setItem(k: string, v: string) { data[k] = v; },
  };
}

test("readLocalShellPrefs handles empty, legacy React sv:shell, corrupt JSON, and write failures", () => {
  const empty = readLocalShellPrefs(memoryStorage());
  assert.deepEqual(empty.prefs, DEFAULT_SHELL_PREFS);
  assert.equal(empty.hadStored, false);
  assert.equal(empty.corrupt, false);

  // Legacy React `{ desktop, mobile }` migrates cleanly without losing choices.
  const legacy = readLocalShellPrefs(memoryStorage({
    [SHELL_STORAGE_KEY]: JSON.stringify({ desktop: "windows", mobile: "android" }),
  }));
  assert.deepEqual(legacy.prefs, {
    desktop: "windows",
    mobile: "android",
    override: "auto",
    iosStyle: "classic",
  });
  assert.equal(legacy.hadStored, true);
  assert.equal(legacy.corrupt, false);

  // Corrupt JSON degrades safely.
  const corrupt = readLocalShellPrefs(memoryStorage({ [SHELL_STORAGE_KEY]: "{bad json" }));
  assert.deepEqual(corrupt.prefs, DEFAULT_SHELL_PREFS);
  assert.equal(corrupt.corrupt, true);

  // Unknown shell IDs in storage degrade per-field.
  const unknown = readLocalShellPrefs(memoryStorage({
    [SHELL_STORAGE_KEY]: JSON.stringify({ desktop: "linux", mobile: "android", iosStyle: "modern" }),
  }));
  assert.deepEqual(unknown.prefs, {
    desktop: "macos",
    mobile: "android",
    override: "auto",
    iosStyle: "modern",
  });

  // Failing storage (e.g. QuotaExceededError / private browsing) returns false without throwing.
  const failing: StorageLike = {
    getItem() { throw new Error("SecurityError"); },
    setItem() { throw new Error("QuotaExceededError"); },
  };
  assert.equal(readLocalShellPrefs(failing).corrupt, true);
  assert.equal(writeLocalShellPrefs(DEFAULT_SHELL_PREFS, failing), false);
});

test("extractShellPrefsFromTweaks preserves color palette preset while migrating legacy Svelte shell preset", () => {
  // Real color palette preset MUST NOT be treated as a shell ID.
  const palette = extractShellPrefsFromTweaks({ preset: "modern-minimal", theme: "dark" });
  assert.deepEqual(palette.prefs, DEFAULT_SHELL_PREFS);
  assert.equal(palette.migratedFromLegacyPreset, false);
  assert.equal(palette.preservedPalettePreset, "modern-minimal");

  // Legacy Svelte writer wrote shell ID into tweaks.preset; migrate idempotently.
  const legacySvelte = extractShellPrefsFromTweaks({ preset: "windows", theme: "dark" });
  assert.equal(legacySvelte.prefs.desktop, "windows");
  assert.equal(legacySvelte.prefs.override, "windows");
  assert.equal(legacySvelte.migratedFromLegacyPreset, true);
  assert.equal(legacySvelte.preservedPalettePreset, null);

  // Saving cleans legacy Svelte preset pollution, while preserving real palette presets.
  const cleanedPatch = buildShellTweaksPatch(legacySvelte.prefs, { preset: "windows" });
  assert.equal(cleanedPatch.preset, null);
  assert.equal(cleanedPatch.shell?.desktop, "windows");

  const keptPalettePatch = buildShellTweaksPatch({ ...DEFAULT_SHELL_PREFS, desktop: "dashboard" }, { preset: "modern-minimal" });
  assert.equal("preset" in keptPalettePatch, false);
  assert.equal(keptPalettePatch.shell?.desktop, "dashboard");
});

test("resolveActiveShell keeps desktop/mobile choices independent across viewports and quick switches", () => {
  // Historical defaults: macOS >640px, iOS <=640px (Android UA on <=640px when default).
  assert.equal(resolveActiveShell(DEFAULT_SHELL_PREFS, 1440, "Windows NT 10.0"), "macos");
  assert.equal(resolveActiveShell(DEFAULT_SHELL_PREFS, 641, "Mozilla/5.0"), "macos");
  assert.equal(resolveActiveShell(DEFAULT_SHELL_PREFS, 768, "iPad"), "macos");
  assert.equal(resolveActiveShell(DEFAULT_SHELL_PREFS, 640, "iPhone"), "ios");
  assert.equal(resolveActiveShell(DEFAULT_SHELL_PREFS, 390, "Android 15", { preferAndroidUaWhenDefault: true }), "android");

  // Quick picker on desktop switching to Windows persists desktop=windows without overwriting mobile=ios.
  const afterWin = applyQuickShellChoice(DEFAULT_SHELL_PREFS, "windows", 1440);
  assert.equal(afterWin.desktop, "windows");
  assert.equal(afterWin.mobile, "ios");
  assert.equal(afterWin.override, "auto");
  assert.equal(resolveActiveShell(afterWin, 1440), "windows");
  assert.equal(resolveActiveShell(afterWin, 390), "ios");

  // Reload round-trip via localStorage keeps Windows on desktop and Android on mobile.
  const store = memoryStorage();
  const both = applyQuickShellChoice(afterWin, "android", 390);
  assert.equal(writeLocalShellPrefs(both, store), true);
  const reloaded = readLocalShellPrefs(store).prefs;
  assert.equal(resolveActiveShell(reloaded, 1440), "windows");
  assert.equal(resolveActiveShell(reloaded, 390), "android");
});

test("extractAppearanceFromTweaks parses theme, wallpaper, fontScale, and accessibility flags safely", () => {
  const parsed = extractAppearanceFromTweaks({
    theme: "dark",
    wallpaper: "win11",
    fontScale: 1.25,
    reduceGlass: true,
    highContrast: true,
    reducedMotion: true,
  });
  assert.deepEqual(parsed, {
    theme: "dark",
    wallpaper: "win11",
    fontScale: 1.2,
    reduceGlass: true,
    highContrast: true,
    reducedMotion: true,
  });
  assert.equal(extractAppearanceFromTweaks({ fontScale: 1.15 }).fontScale, 1.15);
});
