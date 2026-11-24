import type { ChromeProfile } from "./chrome-profile.ts";

export type WallpaperId = "auto" | "aurora" | "aurora-dark" | "win11" | "ios" | "material";

export type WallpaperMeta = {
  readonly id: WallpaperId;
  readonly label: string;
  readonly url: string | null;
};

export const WALLPAPERS: ReadonlyArray<WallpaperMeta> = [
  { id: "auto", label: "Auto (match OS)", url: null },
  { id: "aurora", label: "Aurora Light", url: "/wallpapers/aurora.webp" },
  { id: "aurora-dark", label: "Aurora Dark", url: "/wallpapers/aurora-dark.webp" },
  { id: "win11", label: "Windows Bloom", url: "/wallpapers/win11.webp" },
  { id: "ios", label: "iOS Gradient", url: "/wallpapers/ios.webp" },
  { id: "material", label: "Material You", url: "/wallpapers/material.webp" },
];

const WALLPAPER_BY_ID = new Map<WallpaperId, WallpaperMeta>(
  WALLPAPERS.map((entry) => [entry.id, entry]),
);

const FALLBACK_GRADIENT: Record<ChromeProfile, { light: string; dark: string }> = {
  macos: {
    light: "radial-gradient(circle at 20% 20%, #3b82f6 0%, #6366f1 35%, #1e1b4b 78%, #090d16 100%)",
    dark: "radial-gradient(circle at 18% 18%, #1d4ed8 0%, #312e81 40%, #0f172a 78%, #05070d 100%)",
  },
  windows: {
    light: "radial-gradient(circle at 60% 35%, #2563eb 0%, #1e3a8a 45%, #0b132b 100%)",
    dark: "radial-gradient(circle at 58% 32%, #1d4ed8 0%, #172554 48%, #070d1f 100%)",
  },
  ios: {
    light: "linear-gradient(155deg, #1d4ed8 0%, #6d28d9 48%, #0f172a 100%)",
    dark: "linear-gradient(155deg, #1e3a8a 0%, #4c1d95 48%, #090d16 100%)",
  },
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
  dark: boolean,
): string | null {
  if (wallpaper === "auto") {
    switch (chrome) {
      case "dashboard":
        return null;
      case "windows":
        return "/wallpapers/win11.webp";
      case "ios":
        return "/wallpapers/ios.webp";
      case "android":
        return "/wallpapers/material.webp";
      case "macos":
      default:
        return dark ? "/wallpapers/aurora-dark.webp" : "/wallpapers/aurora.webp";
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
