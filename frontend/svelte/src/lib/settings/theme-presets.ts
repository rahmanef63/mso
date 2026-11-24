export type ThemePresetGroupId = "refined" | "bold" | "warm" | "artistic" | "moody";

export type ThemePresetPalette = {
  bg: string;
  fg: string;
  card: string;
  primary: string;
  primaryFg: string;
  accent: string;
  muted: string;
  border: string;
  destructive: string;
};

export type ThemePreset = {
  name: string;
  title: string;
  group: ThemePresetGroupId;
  light: ThemePresetPalette;
  dark: ThemePresetPalette;
  radius: string;
};

export type ThemePresetGroup = {
  id: ThemePresetGroupId;
  label: string;
  items: readonly ThemePreset[];
};

export const PRESET_STYLE_ID = "os-theme-preset";

export const HIDDEN_PRESET_NAMES: ReadonlySet<string> = new Set([
  "neo-brutalism",
  "doom-64",
  "retro-arcade",
  "cyberpunk",
  "bubblegum",
  "candyland",
  "pastel-dreams",
]);

const GROUP_LABELS: ReadonlyArray<{ id: ThemePresetGroupId; label: string }> = [
  { id: "refined", label: "Refined" },
  { id: "bold", label: "Bold" },
  { id: "warm", label: "Warm" },
  { id: "artistic", label: "Artistic" },
  { id: "moody", label: "Dark & Moody" },
];

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    name: "modern-minimal",
    title: "Modern Minimal",
    group: "refined",
    radius: "0.375rem",
    light: {
      bg: "oklch(1.00 0 0)",
      fg: "oklch(0.32 0 0)",
      card: "oklch(1.00 0 0)",
      primary: "oklch(0.56 0.19 259.81)",
      primaryFg: "oklch(1.00 0 0)",
      accent: "oklch(0.95 0.03 236.82)",
      muted: "oklch(0.55 0.02 264.36)",
      border: "oklch(0.93 0.01 264.53)",
      destructive: "oklch(0.59 0.21 25.33)",
    },
    dark: {
      bg: "oklch(0.20 0 0)",
      fg: "oklch(0.92 0 0)",
      card: "oklch(0.27 0 0)",
      primary: "oklch(0.56 0.19 259.81)",
      primaryFg: "oklch(1.00 0 0)",
      accent: "oklch(0.38 0.14 265.52)",
      muted: "oklch(0.72 0 0)",
      border: "oklch(0.37 0 0)",
      destructive: "oklch(0.59 0.21 25.33)",
    },
  },
  {
    name: "vercel",
    title: "Midnight System",
    group: "refined",
    radius: "0.5rem",
    light: {
      bg: "oklch(0.99 0 0)",
      fg: "oklch(0 0 0)",
      card: "oklch(1 0 0)",
      primary: "oklch(0 0 0)",
      primaryFg: "oklch(1 0 0)",
      accent: "oklch(0.94 0 0)",
      muted: "oklch(0.44 0 0)",
      border: "oklch(0.92 0 0)",
      destructive: "oklch(0.58 0.19 23.03)",
    },
    dark: {
      bg: "oklch(0 0 0)",
      fg: "oklch(1 0 0)",
      card: "oklch(0.14 0 0)",
      primary: "oklch(1 0 0)",
      primaryFg: "oklch(0 0 0)",
      accent: "oklch(0.32 0 0)",
      muted: "oklch(0.72 0 0)",
      border: "oklch(0.26 0 0)",
      destructive: "oklch(0.69 0.20 23.91)",
    },
  },
  {
    name: "claude",
    title: "Claude",
    group: "refined",
    radius: "0.5rem",
    light: {
      bg: "oklch(0.98 0.01 95.10)",
      fg: "oklch(0.34 0.03 95.72)",
      card: "oklch(0.98 0.01 95.10)",
      primary: "oklch(0.57 0.14 39.04)",
      primaryFg: "oklch(1.00 0 0)",
      accent: "oklch(0.92 0.01 92.99)",
      muted: "oklch(0.55 0.01 97.42)",
      border: "oklch(0.88 0.01 97.36)",
      destructive: "oklch(0.19 0.00 106.59)",
    },
    dark: {
      bg: "oklch(0.27 0.00 106.64)",
      fg: "oklch(0.81 0.01 93.01)",
      card: "oklch(0.27 0.00 106.64)",
      primary: "oklch(0.57 0.13 38.76)",
      primaryFg: "oklch(1.00 0 0)",
      accent: "oklch(0.21 0.01 95.42)",
      muted: "oklch(0.77 0.02 99.07)",
      border: "oklch(0.36 0.01 106.89)",
      destructive: "oklch(0.59 0.21 25.33)",
    },
  },
  {
    name: "supabase",
    title: "Supabase",
    group: "refined",
    radius: "0.5rem",
    light: {
      bg: "oklch(0.99 0 0)",
      fg: "oklch(0.20 0 0)",
      card: "oklch(0.99 0 0)",
      primary: "oklch(0.83 0.13 160.91)",
      primaryFg: "oklch(0.26 0.01 166.46)",
      accent: "oklch(0.95 0 0)",
      muted: "oklch(0.24 0 0)",
      border: "oklch(0.90 0 0)",
      destructive: "oklch(0.55 0.19 32.73)",
    },
    dark: {
      bg: "oklch(0.18 0 0)",
      fg: "oklch(0.93 0.01 255.51)",
      card: "oklch(0.20 0 0)",
      primary: "oklch(0.44 0.10 156.76)",
      primaryFg: "oklch(0.92 0.01 167.16)",
      accent: "oklch(0.31 0 0)",
      muted: "oklch(0.71 0 0)",
      border: "oklch(0.28 0 0)",
      destructive: "oklch(0.31 0.09 29.79)",
    },
  },
  {
    name: "mono",
    title: "Mono",
    group: "refined",
    radius: "0rem",
    light: {
      bg: "oklch(1.00 0 0)",
      fg: "oklch(0.14 0 0)",
      card: "oklch(1.00 0 0)",
      primary: "oklch(0.56 0 0)",
      primaryFg: "oklch(0.99 0 0)",
      accent: "oklch(0.97 0 0)",
      muted: "oklch(0.55 0 0)",
      border: "oklch(0.92 0 0)",
      destructive: "oklch(0.56 0.24 28.48)",
    },
    dark: {
      bg: "oklch(0.14 0 0)",
      fg: "oklch(0.99 0 0)",
      card: "oklch(0.21 0 0)",
      primary: "oklch(0.56 0 0)",
      primaryFg: "oklch(0.99 0 0)",
      accent: "oklch(0.37 0 0)",
      muted: "oklch(0.71 0 0)",
      border: "oklch(0.34 0 0)",
      destructive: "oklch(0.70 0.19 22.23)",
    },
  },
  {
    name: "graphite",
    title: "Graphite",
    group: "refined",
    radius: "0.35rem",
    light: {
      bg: "oklch(0.96 0 0)",
      fg: "oklch(0.32 0 0)",
      card: "oklch(0.97 0 0)",
      primary: "oklch(0.49 0 0)",
      primaryFg: "oklch(1.00 0 0)",
      accent: "oklch(0.81 0 0)",
      muted: "oklch(0.51 0 0)",
      border: "oklch(0.86 0 0)",
      destructive: "oklch(0.56 0.19 25.86)",
    },
    dark: {
      bg: "oklch(0.22 0 0)",
      fg: "oklch(0.89 0 0)",
      card: "oklch(0.24 0 0)",
      primary: "oklch(0.71 0 0)",
      primaryFg: "oklch(0.22 0 0)",
      accent: "oklch(0.37 0 0)",
      muted: "oklch(0.61 0 0)",
      border: "oklch(0.33 0 0)",
      destructive: "oklch(0.57 0.15 22.17)",
    },
  },
  {
    name: "clean-slate",
    title: "Clean Slate",
    group: "refined",
    radius: "0.5rem",
    light: {
      bg: "oklch(0.98 0.00 247.86)",
      fg: "oklch(0.28 0.04 260.03)",
      card: "oklch(1.00 0 0)",
      primary: "oklch(0.57 0.20 277.12)",
      primaryFg: "oklch(1.00 0 0)",
      accent: "oklch(0.93 0.03 272.79)",
      muted: "oklch(0.55 0.02 264.36)",
      border: "oklch(0.87 0.01 258.34)",
      destructive: "oklch(0.59 0.21 25.33)",
    },
    dark: {
      bg: "oklch(0.21 0.04 265.75)",
      fg: "oklch(0.93 0.01 255.51)",
      card: "oklch(0.28 0.04 260.03)",
      primary: "oklch(0.68 0.16 276.93)",
      primaryFg: "oklch(0.21 0.04 265.75)",
      accent: "oklch(0.37 0.03 259.73)",
      muted: "oklch(0.71 0.02 261.32)",
      border: "oklch(0.45 0.03 256.80)",
      destructive: "oklch(0.64 0.21 25.33)",
    },
  },
  {
    name: "amber-minimal",
    title: "Amber Minimal",
    group: "refined",
    radius: "0.375rem",
    light: {
      bg: "oklch(1.00 0 0)",
      fg: "oklch(0.27 0 0)",
      card: "oklch(1.00 0 0)",
      primary: "oklch(0.77 0.16 70.08)",
      primaryFg: "oklch(0 0 0)",
      accent: "oklch(0.99 0.02 95.28)",
      muted: "oklch(0.55 0.02 264.36)",
      border: "oklch(0.93 0.01 264.53)",
      destructive: "oklch(0.59 0.21 25.33)",
    },
    dark: {
      bg: "oklch(0.20 0 0)",
      fg: "oklch(0.92 0 0)",
      card: "oklch(0.27 0 0)",
      primary: "oklch(0.77 0.16 70.08)",
      primaryFg: "oklch(0 0 0)",
      accent: "oklch(0.47 0.12 46.20)",
      muted: "oklch(0.72 0 0)",
      border: "oklch(0.37 0 0)",
      destructive: "oklch(0.59 0.21 25.33)",
    },
  },
  {
    name: "t3-chat",
    title: "T3 Chat",
    group: "bold",
    radius: "0.5rem",
    light: {
      bg: "oklch(0.98 0.01 325.64)",
      fg: "oklch(0.33 0.12 325.04)",
      card: "oklch(0.98 0.01 325.64)",
      primary: "oklch(0.53 0.14 355.20)",
      primaryFg: "oklch(1.00 0 0)",
      accent: "oklch(0.87 0.07 334.90)",
      muted: "oklch(0.49 0.12 324.45)",
      border: "oklch(0.86 0.08 328.91)",
      destructive: "oklch(0.52 0.14 20.83)",
    },
    dark: {
      bg: "oklch(0.24 0.02 307.53)",
      fg: "oklch(0.84 0.04 309.54)",
      card: "oklch(0.28 0.02 307.54)",
      primary: "oklch(0.46 0.19 4.10)",
      primaryFg: "oklch(0.86 0.06 346.37)",
      accent: "oklch(0.36 0.05 308.49)",
      muted: "oklch(0.79 0.04 307.10)",
      border: "oklch(0.33 0.02 343.45)",
      destructive: "oklch(0.23 0.05 12.61)",
    },
  },
  {
    name: "bold-tech",
    title: "Bold Tech",
    group: "bold",
    radius: "0.625rem",
    light: {
      bg: "oklch(1.00 0 0)",
      fg: "oklch(0.36 0.14 278.70)",
      card: "oklch(1.00 0 0)",
      primary: "oklch(0.58 0.22 292.72)",
      primaryFg: "oklch(1.00 0 0)",
      accent: "oklch(0.93 0.03 255.59)",
      muted: "oklch(0.54 0.25 293.01)",
      border: "oklch(0.93 0.03 272.79)",
      destructive: "oklch(0.59 0.21 25.33)",
    },
    dark: {
      bg: "oklch(0.21 0.04 265.75)",
      fg: "oklch(0.93 0.03 272.79)",
      card: "oklch(0.26 0.09 281.29)",
      primary: "oklch(0.58 0.22 292.72)",
      primaryFg: "oklch(1.00 0 0)",
      accent: "oklch(0.46 0.21 277.02)",
      muted: "oklch(0.81 0.10 293.57)",
      border: "oklch(0.28 0.14 291.09)",
      destructive: "oklch(0.59 0.21 25.33)",
    },
  },
  {
    name: "twitter",
    title: "Twitter",
    group: "bold",
    radius: "1.3rem",
    light: {
      bg: "oklch(1.00 0 0)",
      fg: "oklch(0.19 0.01 248.51)",
      card: "oklch(0.98 0.00 197.14)",
      primary: "oklch(0.56 0.16 245.00)",
      primaryFg: "oklch(1.00 0 0)",
      accent: "oklch(0.94 0.02 250.85)",
      muted: "oklch(0.19 0.01 248.51)",
      border: "oklch(0.93 0.01 231.66)",
      destructive: "oklch(0.59 0.24 25.77)",
    },
    dark: {
      bg: "oklch(0 0 0)",
      fg: "oklch(0.93 0.00 228.79)",
      card: "oklch(0.21 0.01 274.53)",
      primary: "oklch(0.56 0.16 245.01)",
      primaryFg: "oklch(1.00 0 0)",
      accent: "oklch(0.19 0.03 242.55)",
      muted: "oklch(0.56 0.01 247.97)",
      border: "oklch(0.27 0.00 248.00)",
      destructive: "oklch(0.59 0.24 25.77)",
    },
  },
  {
    name: "tangerine",
    title: "Tangerine",
    group: "bold",
    radius: "0.75rem",
    light: {
      bg: "oklch(0.94 0.00 236.50)",
      fg: "oklch(0.32 0 0)",
      card: "oklch(1.00 0 0)",
      primary: "oklch(0.58 0.17 36.44)",
      primaryFg: "oklch(1.00 0 0)",
      accent: "oklch(0.91 0.02 243.82)",
      muted: "oklch(0.52 0.02 264.36)",
      border: "oklch(0.90 0.01 247.88)",
      destructive: "oklch(0.59 0.21 25.33)",
    },
    dark: {
      bg: "oklch(0.26 0.03 262.67)",
      fg: "oklch(0.92 0 0)",
      card: "oklch(0.31 0.03 268.64)",
      primary: "oklch(0.58 0.17 36.44)",
      primaryFg: "oklch(1.00 0 0)",
      accent: "oklch(0.34 0.06 267.59)",
      muted: "oklch(0.72 0 0)",
      border: "oklch(0.38 0.03 269.73)",
      destructive: "oklch(0.59 0.21 25.33)",
    },
  },
  {
    name: "quantum-rose",
    title: "Quantum Rose",
    group: "bold",
    radius: "0.5rem",
    light: {
      bg: "oklch(0.97 0.02 343.93)",
      fg: "oklch(0.44 0.17 352.38)",
      card: "oklch(0.98 0.01 339.33)",
      primary: "oklch(0.59 0.24 0.13)",
      primaryFg: "oklch(1.00 0 0)",
      accent: "oklch(0.88 0.08 344.88)",
      muted: "oklch(0.56 0.17 352.05)",
      border: "oklch(0.89 0.07 344.39)",
      destructive: "oklch(0.58 0.19 6.34)",
    },
    dark: {
      bg: "oklch(0.18 0.05 313.72)",
      fg: "oklch(0.86 0.13 326.64)",
      card: "oklch(0.24 0.07 313.23)",
      primary: "oklch(0.75 0.23 332.02)",
      primaryFg: "oklch(0.16 0.05 327.57)",
      accent: "oklch(0.36 0.12 325.77)",
      muted: "oklch(0.71 0.16 327.11)",
      border: "oklch(0.33 0.12 313.54)",
      destructive: "oklch(0.57 0.24 7.17)",
    },
  },
  {
    name: "mocha-mousse",
    title: "Mocha Mousse",
    group: "warm",
    radius: "0.5rem",
    light: {
      bg: "oklch(0.95 0.01 102.46)",
      fg: "oklch(0.41 0.03 40.36)",
      card: "oklch(0.95 0.01 102.46)",
      primary: "oklch(0.56 0.06 44.36)",
      primaryFg: "oklch(1.00 0 0)",
      accent: "oklch(0.85 0.04 49.09)",
      muted: "oklch(0.53 0.05 37.21)",
      border: "oklch(0.75 0.04 80.55)",
      destructive: "oklch(0.22 0.01 52.96)",
    },
    dark: {
      bg: "oklch(0.27 0.01 48.18)",
      fg: "oklch(0.95 0.01 102.46)",
      card: "oklch(0.33 0.02 50.89)",
      primary: "oklch(0.73 0.05 52.33)",
      primaryFg: "oklch(0.27 0.01 48.18)",
      accent: "oklch(0.75 0.04 80.55)",
      muted: "oklch(0.76 0.04 50.86)",
      border: "oklch(0.41 0.03 40.36)",
      destructive: "oklch(0.69 0.14 21.46)",
    },
  },
  {
    name: "solar-dusk",
    title: "Solar Dusk",
    group: "warm",
    radius: "0.3rem",
    light: {
      bg: "oklch(0.99 0.01 84.57)",
      fg: "oklch(0.37 0.03 49.61)",
      card: "oklch(0.97 0.01 78.28)",
      primary: "oklch(0.56 0.15 49.00)",
      primaryFg: "oklch(1.00 0 0)",
      accent: "oklch(0.90 0.05 74.99)",
      muted: "oklch(0.55 0.01 58.07)",
      border: "oklch(0.89 0.04 89.70)",
      destructive: "oklch(0.44 0.16 26.90)",
    },
    dark: {
      bg: "oklch(0.22 0.01 56.04)",
      fg: "oklch(0.97 0.00 106.42)",
      card: "oklch(0.27 0.01 34.30)",
      primary: "oklch(0.57 0.19 47.60)",
      primaryFg: "oklch(1.00 0 0)",
      accent: "oklch(0.36 0.05 229.32)",
      muted: "oklch(0.72 0.01 56.26)",
      border: "oklch(0.37 0.01 67.56)",
      destructive: "oklch(0.58 0.22 27.33)",
    },
  },
  {
    name: "caffeine",
    title: "Caffeine",
    group: "warm",
    radius: "0.5rem",
    light: {
      bg: "oklch(0.98 0 0)",
      fg: "oklch(0.24 0 0)",
      card: "oklch(0.99 0 0)",
      primary: "oklch(0.43 0.04 41.99)",
      primaryFg: "oklch(1.00 0 0)",
      accent: "oklch(0.93 0 0)",
      muted: "oklch(0.50 0 0)",
      border: "oklch(0.88 0 0)",
      destructive: "oklch(0.58 0.19 33.34)",
    },
    dark: {
      bg: "oklch(0.18 0 0)",
      fg: "oklch(0.95 0 0)",
      card: "oklch(0.21 0 0)",
      primary: "oklch(0.92 0.05 66.17)",
      primaryFg: "oklch(0.20 0.02 200.20)",
      accent: "oklch(0.29 0 0)",
      muted: "oklch(0.77 0 0)",
      border: "oklch(0.24 0.01 91.75)",
      destructive: "oklch(0.58 0.19 33.34)",
    },
  },
  {
    name: "vintage-paper",
    title: "Vintage Paper",
    group: "warm",
    radius: "0.25rem",
    light: {
      bg: "oklch(0.96 0.02 90.24)",
      fg: "oklch(0.38 0.02 64.34)",
      card: "oklch(0.99 0.01 87.47)",
      primary: "oklch(0.56 0.08 65.54)",
      primaryFg: "oklch(1.00 0 0)",
      accent: "oklch(0.83 0.04 88.81)",
      muted: "oklch(0.54 0.04 71.17)",
      border: "oklch(0.86 0.03 84.59)",
      destructive: "oklch(0.55 0.14 32.91)",
    },
    dark: {
      bg: "oklch(0.27 0.01 57.65)",
      fg: "oklch(0.92 0.02 83.06)",
      card: "oklch(0.32 0.02 59.06)",
      primary: "oklch(0.73 0.06 66.70)",
      primaryFg: "oklch(0.27 0.01 57.65)",
      accent: "oklch(0.42 0.03 56.34)",
      muted: "oklch(0.80 0.02 82.11)",
      border: "oklch(0.38 0.02 57.13)",
      destructive: "oklch(0.55 0.14 32.91)",
    },
  },
  {
    name: "sunset-horizon",
    title: "Sunset Horizon",
    group: "warm",
    radius: "0.625rem",
    light: {
      bg: "oklch(0.99 0.01 56.32)",
      fg: "oklch(0.34 0.01 2.77)",
      card: "oklch(1.00 0 0)",
      primary: "oklch(0.57 0.16 34.71)",
      primaryFg: "oklch(1.00 0 0)",
      accent: "oklch(0.83 0.11 58.00)",
      muted: "oklch(0.55 0.01 58.07)",
      border: "oklch(0.93 0.04 38.69)",
      destructive: "oklch(0.59 0.21 22.24)",
    },
    dark: {
      bg: "oklch(0.26 0.02 352.40)",
      fg: "oklch(0.94 0.01 51.32)",
      card: "oklch(0.32 0.02 341.45)",
      primary: "oklch(0.57 0.16 34.71)",
      primaryFg: "oklch(1.00 0 0)",
      accent: "oklch(0.83 0.11 58.00)",
      muted: "oklch(0.84 0.02 52.63)",
      border: "oklch(0.36 0.02 342.27)",
      destructive: "oklch(0.59 0.21 22.24)",
    },
  },
  {
    name: "claymorphism",
    title: "Claymorphism",
    group: "artistic",
    radius: "1.25rem",
    light: {
      bg: "oklch(0.92 0.00 48.72)",
      fg: "oklch(0.28 0.04 260.03)",
      card: "oklch(0.97 0.00 106.42)",
      primary: "oklch(0.57 0.20 277.12)",
      primaryFg: "oklch(1.00 0 0)",
      accent: "oklch(0.94 0.03 321.94)",
      muted: "oklch(0.51 0.02 264.36)",
      border: "oklch(0.87 0.00 56.37)",
      destructive: "oklch(0.59 0.21 25.33)",
    },
    dark: {
      bg: "oklch(0.22 0.01 67.44)",
      fg: "oklch(0.93 0.01 255.51)",
      card: "oklch(0.28 0.01 59.34)",
      primary: "oklch(0.68 0.16 276.93)",
      primaryFg: "oklch(0.22 0.01 67.44)",
      accent: "oklch(0.39 0.01 59.47)",
      muted: "oklch(0.71 0.02 261.32)",
      border: "oklch(0.34 0.01 59.42)",
      destructive: "oklch(0.64 0.21 25.33)",
    },
  },
  {
    name: "kodama-grove",
    title: "Kodama Grove",
    group: "artistic",
    radius: "0.425rem",
    light: {
      bg: "oklch(0.88 0.05 91.79)",
      fg: "oklch(0.43 0.03 59.22)",
      card: "oklch(0.89 0.04 87.57)",
      primary: "oklch(0.55 0.11 118.91)",
      primaryFg: "oklch(0.99 0.01 88.64)",
      accent: "oklch(0.84 0.07 90.33)",
      muted: "oklch(0.48 0.03 60.93)",
      border: "oklch(0.69 0.04 59.84)",
      destructive: "oklch(0.56 0.10 29.98)",
    },
    dark: {
      bg: "oklch(0.33 0.02 88.07)",
      fg: "oklch(0.92 0.02 82.12)",
      card: "oklch(0.36 0.02 82.33)",
      primary: "oklch(0.68 0.06 132.45)",
      primaryFg: "oklch(0.27 0.01 61.02)",
      accent: "oklch(0.65 0.07 90.76)",
      muted: "oklch(0.71 0.02 73.62)",
      border: "oklch(0.44 0.02 84.55)",
      destructive: "oklch(0.53 0.08 31.30)",
    },
  },
  {
    name: "nature",
    title: "Nature",
    group: "artistic",
    radius: "0.5rem",
    light: {
      bg: "oklch(0.97 0.01 80.72)",
      fg: "oklch(0.30 0.04 30.20)",
      card: "oklch(0.97 0.01 80.72)",
      primary: "oklch(0.52 0.13 144.17)",
      primaryFg: "oklch(1.00 0 0)",
      accent: "oklch(0.90 0.05 146.04)",
      muted: "oklch(0.45 0.05 39.21)",
      border: "oklch(0.88 0.02 74.64)",
      destructive: "oklch(0.54 0.19 26.72)",
    },
    dark: {
      bg: "oklch(0.27 0.03 150.77)",
      fg: "oklch(0.94 0.01 72.66)",
      card: "oklch(0.33 0.03 146.99)",
      primary: "oklch(0.67 0.16 144.21)",
      primaryFg: "oklch(0.22 0.05 145.73)",
      accent: "oklch(0.58 0.14 144.18)",
      muted: "oklch(0.86 0.02 76.10)",
      border: "oklch(0.39 0.03 142.99)",
      destructive: "oklch(0.54 0.19 26.72)",
    },
  },
  {
    name: "northern-lights",
    title: "Northern Lights",
    group: "artistic",
    radius: "0.5rem",
    light: {
      bg: "oklch(0.98 0.00 286.38)",
      fg: "oklch(0.32 0 0)",
      card: "oklch(1.00 0 0)",
      primary: "oklch(0.55 0.15 150.31)",
      primaryFg: "oklch(1.00 0 0)",
      accent: "oklch(0.83 0.11 211.96)",
      muted: "oklch(0.54 0 0)",
      border: "oklch(0.87 0 0)",
      destructive: "oklch(0.59 0.21 25.33)",
    },
    dark: {
      bg: "oklch(0.23 0.01 264.29)",
      fg: "oklch(0.92 0 0)",
      card: "oklch(0.32 0.01 223.67)",
      primary: "oklch(0.55 0.15 150.31)",
      primaryFg: "oklch(1.00 0 0)",
      accent: "oklch(0.67 0.14 261.34)",
      muted: "oklch(0.72 0 0)",
      border: "oklch(0.39 0 0)",
      destructive: "oklch(0.59 0.21 25.33)",
    },
  },
  {
    name: "cosmic-night",
    title: "Cosmic Night",
    group: "moody",
    radius: "0.5rem",
    light: {
      bg: "oklch(0.97 0.01 286.15)",
      fg: "oklch(0.30 0.06 282.42)",
      card: "oklch(1.00 0 0)",
      primary: "oklch(0.54 0.18 288.03)",
      primaryFg: "oklch(1.00 0 0)",
      accent: "oklch(0.92 0.04 262.14)",
      muted: "oklch(0.54 0.05 284.74)",
      border: "oklch(0.91 0.02 285.96)",
      destructive: "oklch(0.59 0.21 14.99)",
    },
    dark: {
      bg: "oklch(0.17 0.02 283.80)",
      fg: "oklch(0.92 0.03 285.88)",
      card: "oklch(0.23 0.04 282.93)",
      primary: "oklch(0.72 0.16 290.40)",
      primaryFg: "oklch(0.17 0.02 283.80)",
      accent: "oklch(0.34 0.08 280.97)",
      muted: "oklch(0.72 0.05 285.17)",
      border: "oklch(0.33 0.06 282.58)",
      destructive: "oklch(0.59 0.21 14.99)",
    },
  },
  {
    name: "perpetuity",
    title: "Perpetuity",
    group: "moody",
    radius: "0.125rem",
    light: {
      bg: "oklch(0.95 0.01 197.01)",
      fg: "oklch(0.38 0.06 212.66)",
      card: "oklch(0.97 0.01 197.07)",
      primary: "oklch(0.55 0.09 203.28)",
      primaryFg: "oklch(1.00 0 0)",
      accent: "oklch(0.90 0.03 201.89)",
      muted: "oklch(0.52 0.06 201.57)",
      border: "oklch(0.89 0.02 204.41)",
      destructive: "oklch(0.57 0.19 25.54)",
    },
    dark: {
      bg: "oklch(0.21 0.02 224.45)",
      fg: "oklch(0.85 0.13 195.04)",
      card: "oklch(0.23 0.03 216.07)",
      primary: "oklch(0.85 0.13 195.04)",
      primaryFg: "oklch(0.21 0.02 224.45)",
      accent: "oklch(0.38 0.06 216.50)",
      muted: "oklch(0.66 0.10 195.05)",
      border: "oklch(0.38 0.06 216.50)",
      destructive: "oklch(0.56 0.21 25.81)",
    },
  },
  {
    name: "catppuccin",
    title: "Catppuccin",
    group: "moody",
    radius: "0.35rem",
    light: {
      bg: "oklch(0.96 0.01 264.53)",
      fg: "oklch(0.44 0.04 279.33)",
      card: "oklch(1.00 0 0)",
      primary: "oklch(0.55 0.25 297.02)",
      primaryFg: "oklch(1.00 0 0)",
      accent: "oklch(0.68 0.14 235.38)",
      muted: "oklch(0.53 0.03 279.08)",
      border: "oklch(0.81 0.02 271.20)",
      destructive: "oklch(0.55 0.22 19.81)",
    },
    dark: {
      bg: "oklch(0.22 0.03 284.06)",
      fg: "oklch(0.88 0.04 272.28)",
      card: "oklch(0.24 0.03 283.91)",
      primary: "oklch(0.79 0.12 304.77)",
      primaryFg: "oklch(0.24 0.03 283.91)",
      accent: "oklch(0.85 0.08 210.25)",
      muted: "oklch(0.75 0.04 273.93)",
      border: "oklch(0.32 0.03 281.98)",
      destructive: "oklch(0.76 0.13 2.76)",
    },
  },
  {
    name: "elegant-luxury",
    title: "Elegant Luxury",
    group: "moody",
    radius: "0.375rem",
    light: {
      bg: "oklch(0.98 0.00 56.38)",
      fg: "oklch(0.22 0 0)",
      card: "oklch(0.98 0.00 56.38)",
      primary: "oklch(0.47 0.15 24.94)",
      primaryFg: "oklch(1.00 0 0)",
      accent: "oklch(0.96 0.06 95.62)",
      muted: "oklch(0.44 0.01 73.64)",
      border: "oklch(0.94 0.03 80.99)",
      destructive: "oklch(0.44 0.16 26.90)",
    },
    dark: {
      bg: "oklch(0.22 0.01 56.04)",
      fg: "oklch(0.97 0.00 106.42)",
      card: "oklch(0.27 0.01 34.30)",
      primary: "oklch(0.51 0.19 27.52)",
      primaryFg: "oklch(0.98 0.00 56.38)",
      accent: "oklch(0.56 0.15 49.00)",
      muted: "oklch(0.87 0.00 56.37)",
      border: "oklch(0.37 0.01 67.56)",
      destructive: "oklch(0.59 0.21 25.33)",
    },
  },
  {
    name: "ocean-breeze",
    title: "Ocean Breeze",
    group: "moody",
    radius: "0.5rem",
    light: {
      bg: "oklch(0.98 0.01 244.25)",
      fg: "oklch(0.37 0.03 259.73)",
      card: "oklch(1.00 0 0)",
      primary: "oklch(0.53 0.19 149.58)",
      primaryFg: "oklch(1.00 0 0)",
      accent: "oklch(0.95 0.05 163.05)",
      muted: "oklch(0.55 0.02 264.36)",
      border: "oklch(0.93 0.01 264.53)",
      destructive: "oklch(0.59 0.21 25.33)",
    },
    dark: {
      bg: "oklch(0.21 0.04 265.75)",
      fg: "oklch(0.87 0.01 258.34)",
      card: "oklch(0.28 0.04 260.03)",
      primary: "oklch(0.77 0.15 163.22)",
      primaryFg: "oklch(0.21 0.04 265.75)",
      accent: "oklch(0.37 0.03 259.73)",
      muted: "oklch(0.61 0.02 264.36)",
      border: "oklch(0.45 0.03 256.80)",
      destructive: "oklch(0.64 0.21 25.33)",
    },
  },
  {
    name: "midnight-bloom",
    title: "Midnight Bloom",
    group: "moody",
    radius: "0.5rem",
    light: {
      bg: "oklch(0.98 0 0)",
      fg: "oklch(0.32 0 0)",
      card: "oklch(1.00 0 0)",
      primary: "oklch(0.57 0.20 283.08)",
      primaryFg: "oklch(1.00 0 0)",
      accent: "oklch(0.65 0.06 117.43)",
      muted: "oklch(0.54 0 0)",
      border: "oklch(0.87 0 0)",
      destructive: "oklch(0.59 0.21 25.33)",
    },
    dark: {
      bg: "oklch(0.23 0.01 264.29)",
      fg: "oklch(0.92 0 0)",
      card: "oklch(0.32 0.01 223.67)",
      primary: "oklch(0.57 0.20 283.08)",
      primaryFg: "oklch(1.00 0 0)",
      accent: "oklch(0.67 0.14 261.34)",
      muted: "oklch(0.72 0 0)",
      border: "oklch(0.39 0 0)",
      destructive: "oklch(0.59 0.21 25.33)",
    },
  },
  {
    name: "starry-night",
    title: "Starry Night",
    group: "moody",
    radius: "0.5rem",
    light: {
      bg: "oklch(0.98 0.00 258.32)",
      fg: "oklch(0.26 0.04 268.07)",
      card: "oklch(0.93 0.01 251.56)",
      primary: "oklch(0.48 0.12 263.38)",
      primaryFg: "oklch(0.99 0.03 98.05)",
      accent: "oklch(0.69 0.07 234.04)",
      muted: "oklch(0.48 0.12 263.38)",
      border: "oklch(0.78 0.02 251.19)",
      destructive: "oklch(0.26 0.04 322.53)",
    },
    dark: {
      bg: "oklch(0.22 0.02 275.84)",
      fg: "oklch(0.94 0.01 266.70)",
      card: "oklch(0.27 0.04 281.30)",
      primary: "oklch(0.48 0.12 263.38)",
      primaryFg: "oklch(0.91 0.14 95.11)",
      accent: "oklch(0.85 0.05 264.78)",
      muted: "oklch(0.62 0.04 262.04)",
      border: "oklch(0.31 0.03 281.77)",
      destructive: "oklch(0.51 0.12 357.11)",
    },
  },
];

const PRESET_BY_NAME = new Map<string, ThemePreset>(THEME_PRESETS.map((p) => [p.name, p]));

export function findThemePreset(name: string | null | undefined): ThemePreset | undefined {
  if (!name || HIDDEN_PRESET_NAMES.has(name)) return undefined;
  return PRESET_BY_NAME.get(name);
}

export function themePresetSwatches(preset: ThemePreset): readonly string[] {
  return [
    preset.light.bg,
    preset.light.fg,
    preset.light.primary,
    preset.light.accent,
    preset.light.destructive,
  ];
}

export function groupThemePresets(query = ""): ThemePresetGroup[] {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? THEME_PRESETS.filter((p) => p.title.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
    : THEME_PRESETS;
  return GROUP_LABELS.map((g) => ({
    id: g.id,
    label: g.label,
    items: filtered.filter((p) => p.group === g.id),
  })).filter((g) => g.items.length > 0);
}

function mix(color: string, pct: number): string {
  return `color-mix(in oklab, ${color} ${pct}%, transparent)`;
}

function modeVars(p: ThemePresetPalette): string[] {
  return [
    `--surface: ${p.bg};`,
    `--panel-solid: ${p.card};`,
    `--panel: ${mix(p.card, 88)};`,
    `--window-bg: ${mix(p.card, 94)};`,
    `--window-head: ${mix(p.card, 82)};`,
    `--glass-card: ${mix(p.card, 82)};`,
    `--text: ${p.fg};`,
    `--muted: ${p.muted};`,
    `--border: ${p.border};`,
    `--accent: ${p.primary};`,
    `--accent-text: ${p.primaryFg};`,
  ];
}

function cssBlock(selector: string, rules: string[]): string {
  return `${selector} {\n  ${rules.join("\n  ")}\n}`;
}

export function buildThemePresetCss(preset: ThemePreset): string {
  const lightRules = modeVars(preset.light);
  const darkRules = modeVars(preset.dark);
  return [
    cssBlock(":root", lightRules),
    cssBlock(":root[data-theme=\"light\"]", lightRules),
    `@media (prefers-color-scheme: dark) {\n${cssBlock(":root:not([data-theme=\"light\"])", darkRules)}\n}`,
    cssBlock(":root[data-theme=\"dark\"]", darkRules),
  ].join("\n\n");
}

export function applyThemePresetToDom(name: string | null | undefined): boolean {
  if (typeof document === "undefined") return false;
  if (!name) {
    clearThemePresetFromDom();
    return false;
  }
  const preset = findThemePreset(name);
  if (!preset) return false;
  let el = document.getElementById(PRESET_STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = PRESET_STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = buildThemePresetCss(preset);
  return true;
}

export function clearThemePresetFromDom(): void {
  if (typeof document === "undefined") return;
  document.getElementById(PRESET_STYLE_ID)?.remove();
}
