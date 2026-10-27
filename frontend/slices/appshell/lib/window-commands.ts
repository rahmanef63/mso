"use client";

import { registerCommands } from "./commands";
import { shellStore, patch } from "./store-state";
import { snapWindow } from "./store";
import { toast } from "./toast";
import type { SnapZone, WinId } from "./types";

// Window-management commands — pin (always-on-top) + tiling presets, exposed
// through the dynamic command registry so every shell's palette gets them.
// Loaded for side effects from the desktop surface (same as shell modules).

/** Toggle always-on-top. Pinned windows render above the regular stack. */
export function togglePin(id: WinId): void {
  const win = shellStore.getWindow(id);
  if (!win) return;
  patch(id, { pinned: !win.pinned });
}

/** Tiling presets — halves, thirds, quadrants (consumers may extend). */
export const TILE_PRESETS: { zone: SnapZone; label: string }[] = [
  { zone: "left", label: "Tile left half" },
  { zone: "right", label: "Tile right half" },
  { zone: "l23", label: "Tile left two-thirds" },
  { zone: "r13", label: "Tile right third" },
  { zone: "l13", label: "Tile left third" },
  { zone: "r23", label: "Tile right two-thirds" },
  { zone: "tl", label: "Tile top-left quarter" },
  { zone: "tr", label: "Tile top-right quarter" },
  { zone: "bl", label: "Tile bottom-left quarter" },
  { zone: "br", label: "Tile bottom-right quarter" },
];

function focusedWin() {
  const id = shellStore.getFocused();
  return id ? shellStore.getWindow(id) : undefined;
}

registerCommands("window", [
  {
    id: "window:pin",
    label: "Pin window on top",
    hint: "Window",
    keywords: "always on top pip float unpin",
    run: () => {
      const win = focusedWin();
      if (!win) {
        toast("No focused window");
        return;
      }
      togglePin(win.id);
      toast(
        shellStore.getWindow(win.id)?.pinned
          ? `Pinned "${win.title}" on top`
          : `Unpinned "${win.title}"`,
      );
    },
  },
  ...TILE_PRESETS.map(({ zone, label }) => ({
    id: `window:tile:${zone}`,
    label,
    hint: "Window",
    keywords: "snap arrange tiling",
    run: () => {
      const win = focusedWin();
      if (!win) {
        toast("No focused window");
        return;
      }
      snapWindow(win.id, zone);
      toast(`${label}: ${win.title}`);
    },
  })),
]);
