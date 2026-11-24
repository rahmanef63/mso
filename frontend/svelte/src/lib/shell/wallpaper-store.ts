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

export function nextWallpaper(current: WallpaperId): WallpaperId {
  const index = WALLPAPERS.findIndex((entry) => entry.id === current);
  if (index < 0) return "aurora";
  return WALLPAPERS[(index + 1) % WALLPAPERS.length].id;
}
