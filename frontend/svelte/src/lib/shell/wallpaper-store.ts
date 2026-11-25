import type { ChromeProfile } from "./chrome-profile.ts";
import { APPLE_WALLPAPERS, appleWallpaperCss } from "./apple-theme.ts";

export type WallpaperId =
  | "auto"
  | "aurora"
  | "aurora-dark"
  | "graphite"
  | "sunset"
  | "win11"
  | "ios"
  | "material";

export type WallpaperMeta = {
  readonly id: WallpaperId;
  readonly label: string;
  readonly url: string | null;
};

export const WALLPAPERS: ReadonlyArray<WallpaperMeta> = [
  { id: "auto", label: "Auto (match OS)", url: null },
  { id: "aurora", label: "Apple Aurora", url: null },
  { id: "graphite", label: "Apple Graphite", url: null },
  { id: "sunset", label: "Apple Sunset", url: null },
  { id: "aurora-dark", label: "Aurora Photo (Dark)", url: "/wallpapers/aurora-dark.webp" },
  { id: "win11", label: "Windows Bloom", url: "/wallpapers/win11.webp" },
  { id: "ios", label: "iOS Photo", url: "/wallpapers/ios.webp" },
  { id: "material", label: "Material You", url: "/wallpapers/material.webp" },
];

const WALLPAPER_BY_ID = new Map<WallpaperId, WallpaperMeta>(
  WALLPAPERS.map((entry) => [entry.id, entry]),
);

const FALLBACK_GRADIENT: Record<ChromeProfile, { light: string; dark: string }> = {
  macos: APPLE_WALLPAPERS.aurora,
  windows: {
    light: "radial-gradient(circle at 60% 35%, #2563eb 0%, #1e3a8a 45%, #0b132b 100%)",
    dark: "radial-gradient(circle at 58% 32%, #1d4ed8 0%, #172554 48%, #070d1f 100%)",
  },
  ios: APPLE_WALLPAPERS.aurora,
  android: {
    light: "linear-gradient(155deg, #0f766e 0%, #1d4ed8 55%, #111827 100%)",
    dark: "linear-gradient(155deg, #115e59 0%, #1e3a8a 55%, #090d16 100%)",
  },
  dashboard: {
    light: "none",
    dark: "none",
  },
};

export function isWallpaperId(value: unknown): value is WallpaperId {
  return typeof value === "string" && WALLPAPER_BY_ID.has(value as WallpaperId);
}

export function resolveWallpaperUrl(
  wallpaper: WallpaperId,
  chrome: ChromeProfile,
  _dark: boolean,
): string | null {
  if (wallpaper === "auto") {
    switch (chrome) {
      case "dashboard":
      case "macos":
      case "ios":
        return null;
      case "windows":
        return "/wallpapers/win11.webp";
      case "android":
        return "/wallpapers/material.webp";
      default:
        return null;
    }
  }
  return WALLPAPER_BY_ID.get(wallpaper)?.url ?? null;
}

export function resolveWallpaperFallback(chrome: ChromeProfile, dark: boolean): string {
  const entry = FALLBACK_GRADIENT[chrome] ?? FALLBACK_GRADIENT.macos;
  return dark ? entry.dark : entry.light;
}

/**
 * Returns a layered CSS background-image value that pairs the wallpaper image
 * with its OS-matched gradient fallback underneath, so missing/404 images never
 * leave an unstyled flat background.
 */
export function resolveWallpaperBackground(
  wallpaper: WallpaperId,
  chrome: ChromeProfile,
  dark: boolean,
): string | undefined {
  if (wallpaper === "aurora" || wallpaper === "graphite" || wallpaper === "sunset") {
    return appleWallpaperCss(wallpaper, dark);
  }
  const url = resolveWallpaperUrl(wallpaper, chrome, dark);
  const fallback = resolveWallpaperFallback(chrome, dark);
  if (!url) return fallback === "none" ? undefined : fallback;
  return fallback === "none" ? `url("${url}")` : `url("${url}"), ${fallback}`;
}

export function nextWallpaper(current: WallpaperId): WallpaperId {
  const index = WALLPAPERS.findIndex((entry) => entry.id === current);
  if (index < 0) return "aurora";
  return WALLPAPERS[(index + 1) % WALLPAPERS.length].id;
}
