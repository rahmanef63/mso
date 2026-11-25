import { APPLE_MOTION } from "./apple-config.ts";

export type AppleA11yFlags = {
  reduceMotion?: boolean;
  reduceTransparency?: boolean;
  increaseContrast?: boolean;
  boldText?: boolean;
};

export type AppleThemeVars = {
  bg: string;
  grouped: string;
  elev: string;
  card: string;
  label: string;
  label2: string;
  label3: string;
  sep: string;
  fill: string;
  fill2: string;
  sidebar: string;
  glassBg: string;
  glassStroke: string;
  glassHi: string;
  shadow: string;
  menubar: string;
  tint: string;
  blur: string;
};

export type AppleWallpaperId = "aurora" | "graphite" | "sunset";
export type AppleWallpaperEntry = { readonly dark: string; readonly light: string };

export const APPLE_ACCENTS = [
  "#0a84ff", "#5e5ce6", "#bf5af2", "#ff375f", "#ff9f0a", "#30d158", "#8e8e93",
] as const;

export const APPLE_WALLPAPERS: Readonly<Record<AppleWallpaperId, AppleWallpaperEntry>> = {
  aurora: {
    dark: [
      "radial-gradient(120% 90% at 12% 8%,#24408f 0%,transparent 55%)",
      "radial-gradient(120% 100% at 88% 16%,#6a2a8c 0%,transparent 50%)",
      "radial-gradient(130% 120% at 60% 108%,#0c5c6e 0%,transparent 55%)",
      "linear-gradient(160deg,#0b0b16,#141024)",
    ].join(","),
    light: [
      "radial-gradient(120% 90% at 12% 8%,#bcdcff 0%,transparent 55%)",
      "radial-gradient(120% 100% at 88% 16%,#ffd6ec 0%,transparent 48%)",
      "radial-gradient(130% 120% at 60% 108%,#c9f3ea 0%,transparent 55%)",
      "linear-gradient(160deg,#eaf1fb,#f4eefb)",
    ].join(","),
  },
  graphite: {
    dark: [
      "radial-gradient(120% 100% at 20% 12%,#2b303c 0%,transparent 60%)",
      "radial-gradient(120% 100% at 85% 90%,#1a2330 0%,transparent 55%)",
      "linear-gradient(160deg,#0e1013,#191c22)",
    ].join(","),
    light: [
      "radial-gradient(120% 100% at 20% 12%,#e1e6ee 0%,transparent 60%)",
      "radial-gradient(120% 100% at 85% 90%,#ccd4e0 0%,transparent 55%)",
      "linear-gradient(160deg,#eef1f5,#e2e6ee)",
    ].join(","),
  },
  sunset: {
    dark: [
      "radial-gradient(120% 90% at 15% 10%,#7a2352 0%,transparent 55%)",
      "radial-gradient(120% 100% at 85% 14%,#b3541f 0%,transparent 50%)",
      "radial-gradient(120% 120% at 60% 110%,#2a1b52 0%,transparent 55%)",
      "linear-gradient(160deg,#160b12,#231018)",
    ].join(","),
    light: [
      "radial-gradient(120% 90% at 15% 10%,#ffd1e0 0%,transparent 55%)",
      "radial-gradient(120% 100% at 85% 14%,#ffe0bf 0%,transparent 50%)",
      "radial-gradient(120% 120% at 60% 110%,#e6d6ff 0%,transparent 55%)",
      "linear-gradient(160deg,#fff2f6,#fbeede)",
    ].join(","),
  },
};

const DARK_BASE = {
  bg: "#1c1c1e", grouped: "#000000", elev: "#2c2c2e", card: "#1c1c1e",
  label: "#ffffff", label2: "rgba(235,235,245,.6)", label3: "rgba(235,235,245,.3)",
  sep: "rgba(255,255,255,.1)", fill: "rgba(120,120,128,.24)", fill2: "rgba(120,120,128,.36)",
  sidebar: "rgba(30,30,33,.62)", glassBg: "rgba(44,44,50,.55)",
  glassStroke: "rgba(255,255,255,.14)", glassHi: "rgba(255,255,255,.2)",
  shadow: "rgba(0,0,0,.55)", menubar: "rgba(0,0,0,.3)",
};

const LIGHT_BASE = {
  bg: "#ffffff", grouped: "#f2f2f7", elev: "#ffffff", card: "#ffffff",
  label: "#1c1c1e", label2: "rgba(60,60,67,.6)", label3: "rgba(60,60,67,.3)",
  sep: "rgba(60,60,67,.16)", fill: "rgba(118,118,128,.12)", fill2: "rgba(118,118,128,.24)",
  sidebar: "rgba(246,246,248,.72)", glassBg: "rgba(252,252,254,.62)",
  glassStroke: "rgba(255,255,255,.7)", glassHi: "rgba(255,255,255,.95)",
  shadow: "rgba(0,0,0,.18)", menubar: "rgba(255,255,255,.42)",
};

export function computeAppleVars(
  dark: boolean,
  a11y: AppleA11yFlags = {},
  accent: string = APPLE_ACCENTS[0],
): AppleThemeVars {
  const vars: AppleThemeVars = { ...(dark ? DARK_BASE : LIGHT_BASE), tint: accent, blur: "26px" };
  if (a11y.reduceTransparency) {
    vars.glassBg = dark ? "#28282c" : "#f4f4f6";
    vars.sidebar = dark ? "#202023" : "#ececef";
    vars.menubar = dark ? "#161618" : "#e9e9ec";
    vars.glassHi = "transparent";
    vars.blur = "0px";
  }
  if (a11y.increaseContrast) {
    vars.label = dark ? "#ffffff" : "#000000";
    vars.label2 = dark ? "rgba(235,235,245,.85)" : "rgba(0,0,0,.72)";
    vars.sep = dark ? "rgba(255,255,255,.34)" : "rgba(0,0,0,.4)";
    vars.glassStroke = dark ? "rgba(255,255,255,.5)" : "rgba(0,0,0,.5)";
  }
  return vars;
}

export function appleThemeCssString(
  vars: AppleThemeVars,
  dur: string = APPLE_MOTION.base,
  durF: string = APPLE_MOTION.fast,
): string {
  const map: Record<string, string> = {
    "--bg": vars.bg, "--grouped": vars.grouped, "--elev": vars.elev, "--card": vars.card,
    "--label": vars.label, "--label2": vars.label2, "--label3": vars.label3, "--sep": vars.sep,
    "--fill": vars.fill, "--fill2": vars.fill2, "--sidebar": vars.sidebar,
    "--glass-bg": vars.glassBg, "--glass-stroke": vars.glassStroke, "--glass-hi": vars.glassHi,
    "--glass-shadow": vars.shadow, "--menubar": vars.menubar, "--blur": vars.blur,
    "--tint": vars.tint, "--dur": dur, "--durF": durF,
  };
  return Object.entries(map).map(([k, val]) => `${k}:${val};`).join("");
}

export function appleWallpaperCss(id: AppleWallpaperId | string, dark: boolean): string {
  const entry = APPLE_WALLPAPERS[id as AppleWallpaperId] ?? APPLE_WALLPAPERS.aurora;
  return dark ? entry.dark : entry.light;
}

export function appleWallpaperFilter(brightness: number, nightShift: boolean): string {
  const clamped = Number.isFinite(brightness) ? Math.max(0, Math.min(100, brightness)) : 74;
  const level = (0.62 + (clamped / 100) * 0.52).toFixed(2);
  let filter = `brightness(${level})`;
  if (nightShift) filter += " sepia(.34) saturate(1.14) hue-rotate(-14deg)";
  return filter;
}
