/** Curated `@phosphor-icons/react` import surface for the picker.
 *
 *  Why named imports: `import * as Ph from "@phosphor-icons/react"`
 *  defeats tree-shaking and pulls all ~3000 icons. Named imports keep
 *  only the curated subset.
 *
 *  Split across `-a` (A-L) and `-b` (M-Z) to honour the 200 LOC file
 *  cap. KEEP IN SYNC with `phosphor-catalog.ts`. */

import type { Icon } from "@phosphor-icons/react";
import { PHOSPHOR_ICONS_A, FallbackPhosphorIcon } from "./phosphor-icons-a";
import { PHOSPHOR_ICONS_B } from "./phosphor-icons-b";

export const PHOSPHOR_ICONS: Readonly<Record<string, Icon>> = {
  ...PHOSPHOR_ICONS_A,
  ...PHOSPHOR_ICONS_B,
};

export type PhosphorIconName = keyof typeof PHOSPHOR_ICONS;

export { FallbackPhosphorIcon };

export function resolvePhosphorIcon(name: string): Icon | null {
  return PHOSPHOR_ICONS[name] ?? null;
}
