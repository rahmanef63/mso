import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The authoritative UI module list: the real directories under frontend/svelte/src/lib.
 */
export const SLICES_ROOT = join(process.cwd(), "frontend", "svelte", "src", "lib");

/** Directory names under frontend/svelte/src/lib, sorted. Empty when the root is missing. */
export function knownSliceDirectories(root: string = SLICES_ROOT): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}
