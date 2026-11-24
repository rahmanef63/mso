import { REFINED_PRESETS } from "./theme-preset-refined.ts";
import { BOLD_PRESETS } from "./theme-preset-bold.ts";
import { WARM_PRESETS } from "./theme-preset-warm.ts";
import { ARTISTIC_PRESETS } from "./theme-preset-artistic.ts";
import { MOODY_PRESETS } from "./theme-preset-moody.ts";

import type { ThemePreset } from "./theme-preset-types.ts";

// Preset catalogue is data only. Split per group so each file stays inside the
// repo architecture ratchet; order here is the rendered order in the gallery.
export const THEME_PRESETS: readonly ThemePreset[] = [
  ...REFINED_PRESETS, ...BOLD_PRESETS, ...WARM_PRESETS, ...ARTISTIC_PRESETS, ...MOODY_PRESETS,
];
