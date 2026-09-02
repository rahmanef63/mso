import type { CSSProperties } from "react";
import type { ImageValue } from "@/lib/contracts/image";
import type { LiveWallpaper, Wallpaper } from "./wallpapers";

export type Theme = "light" | "dark";
// Wallpaper keys + the .wp-* classes are the wallpapers.ts registry (SSOT).
export type { LiveWallpaper, Wallpaper } from "./wallpapers";
export type Device = "auto" | "desktop" | "phone";
export type ServerMode = "mock" | "live";
export type ServerTargetKind = "mock" | "local" | "ssh";

export type MockServerTarget = {
  id: string;
  kind: "mock";
  label: string;
};

export type LocalServerTarget = {
  id: string;
  kind: "local";
  label: string;
  /** Same-origin URL for the running MSO service; empty means current origin. */
  url: string;
};

export type SshServerTarget = {
  id: string;
  kind: "ssh";
  label: string;
  /** Tailscale MagicDNS name or tailnet IP. No passwords/private keys are stored here. */
  host: string;
  user: string;
  port: number;
};

export type ServerTarget = MockServerTarget | LocalServerTarget | SshServerTarget;

/** Accessibility text-scale steps (root font-size multiplier). */
export const FONT_SCALES = [0.875, 1, 1.125, 1.25] as const;

export type Appearance = {
  theme: Theme;
  /** tweakcn preset name (lib/appearance/presets) — null = stock os-rr palette.
   *  The preset is the SINGLE source of color, accent, radius AND typeface
   *  (its cssVars.theme fonts are injected + webfont-loaded; there is no
   *  separate font-family setting). */
  preset: string | null;
  wallpaper: Wallpaper;
  wallpaperImage: ImageValue | null;
  wallpaperStyle?: CSSProperties;
  /** Live/interactive wallpaper (TSX component id or sandboxed HTML). Wins over
   *  both the custom image and the preset when set. */
  liveWallpaper: LiveWallpaper | null;
  reduceGlass: boolean;
  device: Device;
  /** Root font-size multiplier (a11y) — one of FONT_SCALES. (Size only — the
   *  font FAMILY comes from the theme preset.) */
  fontScale: number;
  /** Stronger borders + secondary text (a11y). */
  highContrast: boolean;
};

// No token field: the HTTP adapter authenticates with the signed session
// cookie (same-origin); a bearer token in localStorage would be a leak vector.
export type ServerConfig = {
  /** Legacy effective mode kept for adapters/control-center: mock or same-origin live. */
  mode: ServerMode;
  /** Legacy live URL field; empty means current origin. */
  url: string;
  /** Active Settings tab/target. SSH targets are config-only until a backend bridge is enabled. */
  activeTargetId?: string;
  /** Saved targets. Contains only public connection metadata — never passwords or private keys. */
  targets?: ServerTarget[];
};

export type Tweaks = Appearance & { server: ServerConfig };

export const TWEAK_DEFAULTS: Tweaks = {
  theme: "light",
  preset: null,
  wallpaper: "auto",
  wallpaperImage: null,
  liveWallpaper: null,
  reduceGlass: false,
  device: "auto",
  fontScale: 1,
  highContrast: false,
  server: {
    // A fresh visitor lands on MOCK: the shell is public (no sign-in wall) and
    // browses safe in-browser data. The owner signs in (Settings → Server) to
    // unlock live host access; that selects the "vps" target + flips mode. Live
    // is also force-gated on an authenticated session in lib/os-api, so a stored
    // "live" from a since-signed-out owner still resolves to mock (no 401 spray).
    mode: "mock",
    url: "",
    activeTargetId: "mock",
    targets: [
      { id: "mock", kind: "mock", label: "Mock" },
      { id: "vps", kind: "local", label: "This VPS", url: "" },
      { id: "laptop", kind: "ssh", label: "Laptop", host: "", user: "", port: 22 },
    ],
  },
};
