import type { PresetItem, PresetRegistry, PresetGroup } from "./types";

let cache: PresetRegistry | null = null;
let pending: Promise<PresetRegistry> | null = null;

/** Lazy-load the bundled tweakcn registry (~240KB JSON code-splits into its
 *  own chunk — fetched only when the Theme section mounts or a preset boots).
 *  The registry content mirrors jnsahaj/tweakcn (Apache-2.0); see
 *  docs/references/tweakcn.md. MSO ships no tweakcn code. */
export async function loadPresetRegistry(): Promise<PresetRegistry> {
  if (cache) return cache;
  if (pending) return pending;
  pending = import("./registry-data.json").then((mod) => {
    const data = (mod.default ?? mod) as PresetRegistry;
    cache = {
      ...data,
      items: data.items.filter((i) => i.cssVars?.light && i.cssVars?.dark),
    };
    return cache;
  });
  return pending;
}

export function findPreset(
  registry: PresetRegistry,
  name: string,
): PresetItem | undefined {
  return registry.items.find((i) => i.name === name);
}

/** Five representative colors for a picker chip. */
export function presetSwatches(preset: PresetItem): string[] {
  const v = preset.cssVars?.light ?? preset.cssVars?.dark ?? {};
  return [
    v.background ?? "oklch(1 0 0)",
    v.foreground ?? "oklch(0 0 0)",
    v.primary ?? "oklch(0.5 0.1 259)",
    v.accent ?? "oklch(0.5 0.1 200)",
    v.destructive ?? "oklch(0.6 0.2 25)",
  ];
}

/** Gimmicky presets hidden from the picker (registry data kept). */
const HIDDEN: ReadonlySet<string> = new Set([
  "neo-brutalism", "doom-64", "retro-arcade", "cyberpunk",
  "bubblegum", "candyland", "pastel-dreams",
]);

const GROUPS: ReadonlyArray<{ id: string; label: string; presets: string[] }> = [
  { id: "refined", label: "Refined", presets: [
    "modern-minimal", "vercel", "claude", "supabase",
    "mono", "graphite", "clean-slate", "amber-minimal",
  ] },
  { id: "bold", label: "Bold", presets: [
    "t3-chat", "bold-tech", "twitter", "tangerine", "quantum-rose",
  ] },
  { id: "warm", label: "Warm", presets: [
    "mocha-mousse", "solar-dusk", "caffeine", "vintage-paper", "sunset-horizon",
  ] },
  { id: "artistic", label: "Artistic", presets: [
    "claymorphism", "kodama-grove", "nature", "northern-lights",
  ] },
  { id: "moody", label: "Dark & Moody", presets: [
    "cosmic-night", "perpetuity", "catppuccin", "elegant-luxury",
    "ocean-breeze", "midnight-bloom", "starry-night",
  ] },
];

export function groupPresets(all: PresetItem[]): PresetGroup[] {
  const visible = all.filter((p) => !HIDDEN.has(p.name));
  const byName = new Map(visible.map((p) => [p.name, p]));
  const seen = new Set<string>();
  const grouped = GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    items: g.presets
      .map((n) => byName.get(n))
      .filter((x): x is PresetItem => {
        if (!x) return false;
        seen.add(x.name);
        return true;
      }),
  })).filter((g) => g.items.length > 0);
  const rest = visible.filter((p) => !seen.has(p.name));
  if (rest.length) grouped.push({ id: "other", label: "More", items: rest });
  return grouped;
}
