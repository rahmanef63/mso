import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The authoritative slice list: the real directories under frontend/slices.
 *
 * Deliberately read from disk rather than declared here. A second hard-coded copy of
 * the list is a list that goes stale, and the registry-completeness test exists
 * precisely to catch a slice that appears on disk without a budget entry.
 */
export const SLICES_ROOT = join(process.cwd(), "frontend", "slices");

/** Directory names under frontend/slices, sorted. Empty when the root is missing. */
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
