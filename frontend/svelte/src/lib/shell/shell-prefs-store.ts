import {
  MOBILE_VIEWPORT_MAX_PX,
  isChromeChoice,
  isChromeProfile,
  type ChromeChoice,
  type ChromeProfile,
} from "./chrome-profile.ts";
import { isWallpaperId, type WallpaperId } from "./wallpaper-store.ts";
import { clampFontScale, DEFAULT_FONT_SCALE } from "./desktop-icons-data.ts";
import type { PrefTweaks, ThemeMode } from "../settings/prefs-api.ts";

export type DesktopShellId = "macos" | "windows" | "dashboard";
export type MobileShellId = "ios" | "android";
export type ShellSurface = "desktop" | "mobile";
export type IosStyleVariant = "classic" | "modern";

export type ShellPrefs = {
  desktop: DesktopShellId;
  mobile: MobileShellId;
  override: ChromeChoice;
  iosStyle: IosStyleVariant;
};

export type AppearanceRuntime = {
  theme: ThemeMode;
  wallpaper: WallpaperId;
  fontScale: number;
  reduceGlass: boolean;
  highContrast: boolean;
  reducedMotion: boolean;
};

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

export const SHELL_STORAGE_KEY = "sv:shell";
const DESKTOP_SET = new Set<string>(["macos", "windows", "dashboard"]);
const MOBILE_SET = new Set<string>(["ios", "android"]);

export const DEFAULT_SHELL_PREFS: Readonly<ShellPrefs> = Object.freeze({
  desktop: "macos",
  mobile: "ios",
  override: "auto",
  iosStyle: "classic",
});

export function isDesktopShell(value: unknown): value is DesktopShellId {
  return typeof value === "string" && DESKTOP_SET.has(value);
}

export function isMobileShell(value: unknown): value is MobileShellId {
  return typeof value === "string" && MOBILE_SET.has(value);
}

export function isIosStyleVariant(value: unknown): value is IosStyleVariant {
  return value === "classic" || value === "modern";
}

export function surfaceOfShell(id: ChromeProfile): ShellSurface {
  return isMobileShell(id) ? "mobile" : "desktop";
}

export function surfaceForViewport(viewportWidth: number): ShellSurface {
  if (!Number.isFinite(viewportWidth)) return "desktop";
  return viewportWidth <= MOBILE_VIEWPORT_MAX_PX ? "mobile" : "desktop";
}

export function normalizeShellPrefs(raw: unknown, fallback: ShellPrefs = DEFAULT_SHELL_PREFS): ShellPrefs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...fallback };
  }
  const rec = raw as Record<string, unknown>;
  return {
    desktop: isDesktopShell(rec.desktop) ? rec.desktop : fallback.desktop,
    mobile: isMobileShell(rec.mobile) ? rec.mobile : fallback.mobile,
    override: isChromeChoice(rec.override) ? rec.override : fallback.override,
    iosStyle: isIosStyleVariant(rec.iosStyle) ? rec.iosStyle : fallback.iosStyle,
  };
}

/**
 * Reads and migrates local `sv:shell` safely. Supports legacy React `{ desktop, mobile }`,
 * new `{ desktop, mobile, override, iosStyle }`, and gracefully recovers from corrupt JSON.
 */
export function readLocalShellPrefs(storage?: StorageLike | null): {
  prefs: ShellPrefs;
  hadStored: boolean;
  corrupt: boolean;
} {
  const target = storage === undefined ? getShellStorage() : storage;
  if (!target) return { prefs: { ...DEFAULT_SHELL_PREFS }, hadStored: false, corrupt: false };
  try {
    const raw = target.getItem(SHELL_STORAGE_KEY);
    if (!raw) return { prefs: { ...DEFAULT_SHELL_PREFS }, hadStored: false, corrupt: false };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { prefs: { ...DEFAULT_SHELL_PREFS }, hadStored: false, corrupt: true };
    }
    const rec = parsed as Record<string, unknown>;
    const hasValidField =
      isDesktopShell(rec.desktop)
      || isMobileShell(rec.mobile)
      || isChromeChoice(rec.override)
      || isIosStyleVariant(rec.iosStyle);
    return {
      prefs: normalizeShellPrefs(parsed),
      hadStored: hasValidField,
      corrupt: !hasValidField,
    };
  } catch {
    return { prefs: { ...DEFAULT_SHELL_PREFS }, hadStored: false, corrupt: true };
  }
}

export function writeLocalShellPrefs(prefs: ShellPrefs, storage?: StorageLike | null): boolean {
  const target = storage === undefined ? getShellStorage() : storage;
  if (!target) return false;
  try {
    target.setItem(SHELL_STORAGE_KEY, JSON.stringify(normalizeShellPrefs(prefs)));
    return true;
  } catch {
    return false;
  }
}

/**
 * Extracts shell preferences from server `/api/prefs` `tweaks` without corrupting
 * historical color palette presets (e.g., `preset: "modern-minimal"`).
 * Migrates legacy Svelte-written shell IDs from `tweaks.preset` idempotently.
 */
export function extractShellPrefsFromTweaks(
  tweaks: PrefTweaks | undefined,
  base: ShellPrefs = DEFAULT_SHELL_PREFS,
): { prefs: ShellPrefs; migratedFromLegacyPreset: boolean; preservedPalettePreset: string | null } {
  if (!tweaks) {
    return { prefs: { ...base }, migratedFromLegacyPreset: false, preservedPalettePreset: null };
  }
  const rawPreset = typeof tweaks.preset === "string" ? tweaks.preset : null;
  const presetIsShellId = isChromeProfile(rawPreset);
  const preservedPalettePreset = rawPreset && !presetIsShellId ? rawPreset : null;

  if (tweaks.shell && typeof tweaks.shell === "object" && !Array.isArray(tweaks.shell)) {
    return {
      prefs: normalizeShellPrefs(tweaks.shell, base),
      migratedFromLegacyPreset: false,
      preservedPalettePreset,
    };
  }

  if (presetIsShellId && rawPreset) {
    const surface = surfaceOfShell(rawPreset);
    const next: ShellPrefs = {
      ...base,
      desktop: surface === "desktop" ? (rawPreset as DesktopShellId) : base.desktop,
      mobile: surface === "mobile" ? (rawPreset as MobileShellId) : base.mobile,
      override: rawPreset,
    };
    return { prefs: next, migratedFromLegacyPreset: true, preservedPalettePreset: null };
  }

  return { prefs: { ...base }, migratedFromLegacyPreset: false, preservedPalettePreset };
}

/**
 * Builds a `/api/prefs` tweaks patch that stores shell selection under `tweaks.shell`
 * while preserving any existing color palette in `tweaks.preset`.
 */
export function buildShellTweaksPatch(
  nextShell: ShellPrefs,
  existingTweaks?: PrefTweaks,
): PrefTweaks {
  const patch: PrefTweaks = { shell: normalizeShellPrefs(nextShell) };
  // Clear legacy Svelte shell-id pollution in `preset`, but never touch real color palettes.
  if (existingTweaks && isChromeProfile(existingTweaks.preset)) {
    patch.preset = null;
  }
  return patch;
}

/**
 * Resolves the effective OS chrome profile for the active viewport and user agent.
 * Policy:
 * - Explicit override (`macos`/`windows`/`dashboard`/`ios`/`android`) always wins.
 * - `override === "auto"`:
 *   - Viewport <= 640px (phone portrait / cover screen): uses `prefs.mobile`
 *     (default `ios`, or `android` when user has not stored a custom choice and UA is Android).
 *   - Viewport > 640px (desktop, tablet 768-1024px, landscape phone, unfolded foldable, Windows):
 *     uses `prefs.desktop` (historical default `macos`; explicit `windows` or `dashboard` persists).
 */
export function resolveActiveShell(
  prefs: ShellPrefs,
  viewportWidth: number,
  userAgent = "",
  options?: { preferAndroidUaWhenDefault?: boolean },
): ChromeProfile {
  if (prefs.override !== "auto" && isChromeProfile(prefs.override)) {
    return prefs.override;
  }
  const surface = surfaceForViewport(viewportWidth);
  if (surface === "mobile") {
    if (options?.preferAndroidUaWhenDefault && prefs.mobile === "ios" && /android/i.test(userAgent)) {
      return "android";
    }
    return prefs.mobile;
  }
  return prefs.desktop;
}

/**
 * Updates shell preferences when the user picks a shell from quick pickers or menus.
 * Keeps desktop and mobile selections independent while respecting explicit overrides.
 */
export function applyQuickShellChoice(
  current: ShellPrefs,
  choice: ChromeChoice,
  viewportWidth: number,
): ShellPrefs {
  if (choice === "auto") {
    return { ...current, override: "auto" };
  }
  const activeSurface = surfaceForViewport(viewportWidth);
  const chosenSurface = surfaceOfShell(choice);
  if (chosenSurface === "desktop") {
    return {
      ...current,
      desktop: choice as DesktopShellId,
      // If currently on desktop, stay in surface-following auto mode so mobile still uses prefs.mobile;
      // if user explicitly previews a desktop shell on a narrow viewport, keep override pinned.
      override: activeSurface === "desktop" ? "auto" : choice,
    };
  }
  return {
    ...current,
    mobile: choice as MobileShellId,
    // If on mobile viewport, stay in auto so desktop keeps prefs.desktop; on desktop, pin mobile preview.
    override: activeSurface === "mobile" ? "auto" : choice,
  };
}

export function extractAppearanceFromTweaks(tweaks: PrefTweaks | undefined): AppearanceRuntime {
  const theme: ThemeMode =
    tweaks?.theme === "light" || tweaks?.theme === "dark" ? tweaks.theme : "system";
  const wallpaper: WallpaperId = isWallpaperId(tweaks?.wallpaper) ? tweaks.wallpaper : "auto";
  const fontScale = clampFontScale(
    typeof tweaks?.fontScale === "number" ? tweaks.fontScale : DEFAULT_FONT_SCALE,
  );
  return {
    theme,
    wallpaper,
    fontScale,
    reduceGlass: Boolean(tweaks?.reduceGlass),
    highContrast: Boolean(tweaks?.highContrast),
    reducedMotion: Boolean(tweaks?.reducedMotion),
  };
}

export function applyAppearanceToDom(appearance: Partial<AppearanceRuntime>): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (appearance.theme !== undefined) {
    if (appearance.theme === "light" || appearance.theme === "dark") {
      root.dataset.theme = appearance.theme;
    } else {
      delete root.dataset.theme;
    }
  }
  if (appearance.fontScale !== undefined) {
    root.style.fontSize = `${Math.round(clampFontScale(appearance.fontScale) * 100)}%`;
  }
  if (appearance.reduceGlass !== undefined) {
    if (appearance.reduceGlass) root.dataset.reduceGlass = "true";
    else delete root.dataset.reduceGlass;
  }
  if (appearance.highContrast !== undefined) {
    if (appearance.highContrast) root.dataset.highContrast = "true";
    else delete root.dataset.highContrast;
  }
  if (appearance.reducedMotion !== undefined) {
    if (appearance.reducedMotion) root.dataset.reducedMotion = "true";
    else delete root.dataset.reducedMotion;
  }
}

/** The browser storage these preferences live in, or null when the getter itself
 *  throws (site data blocked, sandboxed frame). Exported so a backup surface reads
 *  through the same guard instead of opening a second raw `localStorage` path. */
export function getShellStorage(): StorageLike | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}
