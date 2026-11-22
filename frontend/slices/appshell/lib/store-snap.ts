import type { WinId, SnapZone } from "./types";
import { M, patch, emit } from "./store-state";
import { GAP, workArea, snapRect, clampRect, setChromeInsets } from "./store-geometry";

// Snap + chrome-inset actions, split from store.ts (≤200 LOC discipline).
// Consumers keep importing from ../lib/store — it re-exports everything here.

/** Set the active shell's chrome insets AND re-tile every snapped/maximized
 *  window into the new work area. Without the re-tile, a window maximized
 *  under the Windows taskbar keeps that frozen height after switching to
 *  macOS (and vice versa). Free-floating windows are clamped back on-screen. */
export function applyChromeInsets(i: { top?: number; bottom?: number }) {
  setChromeInsets(i);
  retileSnapped();
}

// Re-tile snapped/maximized windows AND clamp free-floating ones into the
// current work area. Run on chrome-inset changes (shell switch) and on viewport
// resize/rotate so no window is ever left offscreen or under the bottom chrome.
export function retileSnapped() {
  if (typeof window === "undefined") return;
  const { vw, top, bottom } = workArea();
  const windows = { ...M.state.windows };
  let changed = false;
  for (const id of M.state.order) {
    const win = windows[id];
    if (!win) continue;
    const preferredRect = win.preferredRect ?? win.prevRect ?? { x: win.x, y: win.y, w: win.w, h: win.h };
    const rect = win.maximized ? { x: GAP, y: top, w: vw - GAP * 2, h: bottom - top }
      : win.snapZone ? snapRect(win.snapZone) : clampRect(preferredRect);
    if (!win.preferredRect || Object.entries(rect).some(([key, value]) => win[key as keyof typeof rect] !== value)) {
      windows[id] = { ...win, ...rect, preferredRect };
      changed = true;
    }
  }
  if (changed) {
    M.state = { ...M.state, windows };
    emit();
  }
}

export function snapWindow(id: WinId, zone: SnapZone) {
  const win = M.state.windows[id];
  if (!win) return;
  patch(id, {
    ...snapRect(zone),
    maximized: false,
    snapZone: zone,
    prevRect: win.preferredRect ?? win.prevRect ?? { x: win.x, y: win.y, w: win.w, h: win.h },
    preferredRect: win.preferredRect ?? win.prevRect ?? { x: win.x, y: win.y, w: win.w, h: win.h },
  });
  // Snap-Assist pulse: a transient one-shot for half-snaps (left/right) so a
  // shell can offer the other windows for the complementary zone. Pure UI
  // signal — no window state, so the single store stays the source of truth.
  if (zone === "left" || zone === "right") {
    snapListeners.forEach((cb) => cb({ id, zone }));
  }
}

type SnapPulse = { id: WinId; zone: SnapZone };
type SnapListener = (e: SnapPulse) => void;
const snapListeners = new Set<SnapListener>();
/** Subscribe to half-snap pulses (Windows Snap-Assist). Returns an unsubscribe. */
export function onSnap(cb: SnapListener): () => void {
  snapListeners.add(cb);
  return () => {
    snapListeners.delete(cb);
  };
}
