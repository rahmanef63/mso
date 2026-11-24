export type {
  ThemePreset, ThemePresetGroup, ThemePresetGroupId, ThemePresetPalette,
} from "./theme-preset-types.ts";
import type { ThemePreset, ThemePresetGroup, ThemePresetGroupId, ThemePresetPalette } from "./theme-preset-types.ts";

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

import { THEME_PRESETS as PRESETS } from "./theme-preset-data.ts";
export { THEME_PRESETS } from "./theme-preset-data.ts";

export const THEME_PRESETS_COUNT = PRESETS.length;


const PRESET_BY_NAME = new Map<string, ThemePreset>(PRESETS.map((p) => [p.name, p]));

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
    ? PRESETS.filter((p) => p.title.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
    : PRESETS;
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
