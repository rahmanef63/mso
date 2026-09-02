"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { parseImage, imageStyle, isCssImage, type ImageValue } from "@/lib/contracts/image";
import { usePrefsSync } from "@/lib/prefs/use-prefs-sync";
import { TWEAK_DEFAULTS, type Tweaks, type ServerConfig } from "./types";
import { normalizeLiveWallpaper, normalizeWallpaper } from "./wallpapers";
import { ensureServerTargets } from "./server-targets";
import { applyPreset, clearPreset } from "./presets/apply";

const KEY = "mso:tweaks";

function upgradeUnsplash(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === "images.unsplash.com") {
      u.searchParams.set("auto", "format");
      u.searchParams.set("fit", "crop");
      u.searchParams.set("w", "2560");
      u.searchParams.set("q", "85");
      u.searchParams.delete("h");
      return u.toString();
    }
  } catch {
    /* not a URL */
  }
  return url;
}

function wallpaperCss(img: ImageValue) {
  if (isCssImage(img)) return imageStyle(img);
  const hi = upgradeUnsplash(img.value);
  const resolved = /^https?:\/\//i.test(hi) ? hi : img.value;
  return imageStyle(img, resolved);
}

function withWallpaperStyle(tweaks: Tweaks): Tweaks {
  const wallpaperImage = parseImage(tweaks.wallpaperImage ?? null);
  return {
    ...tweaks,
    wallpaperImage,
    wallpaperStyle: wallpaperImage ? wallpaperCss(wallpaperImage) : undefined,
  };
}

type Ctx = {
  tweaks: Tweaks;
  setTweaks: (patch: Partial<Tweaks>) => void;
  setServer: (patch: Partial<ServerConfig>) => void;
  setWallpaperImage: (wallpaperImage: ImageValue | null) => void;
};

const AppearanceContext = createContext<Ctx | null>(null);

// Applies the visual tweaks to <html> (data-theme + dir-* + accent) and
// persists them. Kept tiny; the actual palette lives in globals.css tokens.
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [tweaks, setState] = useState<Tweaks>(TWEAK_DEFAULTS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Tweaks & { server?: { token?: string } };
        // Scrub legacy keys from old caches (next persist rewrites without
        // them): the plaintext server token (auth is the session cookie) and
        // the pre-merge fontFamily override (presets own the typeface now).
        if (parsed.server) delete parsed.server.token;
        delete (parsed as Record<string, unknown>).fontFamily;
        const server = { ...TWEAK_DEFAULTS.server, ...parsed.server };
        const wallpaperImage = parseImage(parsed.wallpaperImage ?? null);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot post-hydration restore: this provider wraps SSR'd markup (login screen reads the wallpaper tweak), so a lazy initializer reading localStorage would hydration-mismatch
        setState(withWallpaperStyle({
          ...TWEAK_DEFAULTS,
          ...parsed,
          // Removed legacy presets (dusk/mist/noir/…) coerce to "auto".
          wallpaper: normalizeWallpaper(parsed.wallpaper),
          wallpaperImage,
          liveWallpaper: normalizeLiveWallpaper(parsed.liveWallpaper),
          server: ensureServerTargets(server),
        }));
      }
    } catch {
      /* ignore corrupt cache */
    }
  }, []);

  useEffect(() => {
    const el = document.documentElement;
    el.dataset.theme = tweaks.theme;
    el.classList.toggle("reduce-glass", tweaks.reduceGlass);
    el.classList.toggle("high-contrast", tweaks.highContrast);
    // Scale drives a CSS var (globals.css: html font-size = 100% * --font-scale),
    // so the whole rem cascade reacts live — no fragile cached root font-size.
    el.style.setProperty("--font-scale", String(tweaks.fontScale));
    // Typeface is preset-owned (cssVars.theme font-sans/mono, webfonts loaded
    // by applyPreset) — no separate picker, no inline --font-ui override. Clear
    // any pre-merge leftover so the preset's :root rule actually wins.
    el.style.removeProperty("--font-ui");
    // Color is 100% theme-driven now: a preset owns every chrome token + --accent;
    // stock (no preset) falls back to the globals.css defaults. No inline accent /
    // style (dir) overrides — the preset picker is the single source of truth.
    el.style.removeProperty("--accent");
    if (tweaks.preset) void applyPreset(tweaks.preset);
    else clearPreset();
    try {
      localStorage.setItem(KEY, JSON.stringify(tweaks));
    } catch {
      /* quota / private mode */
    }
  }, [tweaks]);

  // Cross-device sync (lib/prefs): server-stored tweaks win over the local cache
  // on initial load; local edits debounce back up. wallpaperStyle is computed from
  // wallpaperImage (withWallpaperStyle), so it's stripped from the synced payload
  // and recomputed on apply — same shape as the localStorage hydrate above.
  const applyServerTweaks = useCallback((t: Omit<Tweaks, "wallpaperStyle">) => {
    // Synced payloads from pre-merge devices may still carry fontFamily.
    delete (t as Record<string, unknown>).fontFamily;
    setState(withWallpaperStyle({
      ...TWEAK_DEFAULTS,
      ...t,
      wallpaper: normalizeWallpaper(t.wallpaper),
      wallpaperImage: parseImage(t.wallpaperImage ?? null),
      liveWallpaper: normalizeLiveWallpaper(t.liveWallpaper),
      server: ensureServerTargets({ ...TWEAK_DEFAULTS.server, ...t.server }),
    }));
  }, []);
  const syncedTweaks = useMemo(() => {
    const { wallpaperStyle: _computed, ...rest } = tweaks;
    return rest;
  }, [tweaks]);
  usePrefsSync({ section: "tweaks", value: syncedTweaks, apply: applyServerTweaks });

  const setTweaks = useCallback(
    (patch: Partial<Tweaks>) => setState((t) => withWallpaperStyle({ ...t, ...patch })),
    [],
  );
  const setServer = useCallback(
    (patch: Partial<ServerConfig>) =>
      setState((t) => withWallpaperStyle({ ...t, server: ensureServerTargets({ ...t.server, ...patch }) })),
    [],
  );
  const setWallpaperImage = useCallback(
    (wallpaperImage: ImageValue | null) =>
      setState((t) => withWallpaperStyle({ ...t, wallpaperImage })),
    [],
  );

  // Memoized ctx (setters are stable) — consumers only re-render on tweaks.
  const ctx = useMemo(
    () => ({ tweaks, setTweaks, setServer, setWallpaperImage }),
    [tweaks, setTweaks, setServer, setWallpaperImage],
  );
  return <AppearanceContext.Provider value={ctx}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): Ctx {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error("useAppearance must be used within AppearanceProvider");
  return ctx;
}
