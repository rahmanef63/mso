import type { WindowState, WinId } from "./types";
import { M, emit, patch, topZ } from "./store-state";
import { GAP, workArea, spawnRect } from "./store-geometry";
// Store barrel: state in store-state; geometry in store-geometry; snap in
// store-snap; hydrate/serialize in store-persist.

export { shellStore, stackByZ } from "./store-state";
export { snapRect, snapZoneAt, GAP, cycleSnap } from "./store-geometry";
export { applyChromeInsets, retileSnapped, snapWindow, onSnap } from "./store-snap";
export { hydrate, hydrateBoot, serialize } from "./store-persist";

export function openWindow(
  app: string,
  title: string,
  size?: { w: number; h: number },
  payload?: unknown,
  opts?: { multi?: boolean },
): WinId {
  // Singleton apps reuse their one window; `multi` apps (e.g. Files) always get
  // a fresh window so several can be open at once.
  if (!opts?.multi) {
    const existing = M.state.order.find((id) => M.state.windows[id].app === app);
    if (existing) {
      // Re-opening with fresh context (e.g. a different file) updates the payload.
      if (payload !== undefined) patch(existing, { payload });
      focusWindow(existing);
      if (M.state.windows[existing].minimized) restoreWindow(existing);
      return existing;
    }
  }
  const id = `w${++M.seq}`;
  const win: WindowState = {
    id,
    app,
    title,
    ...spawnRect(M.state.order.length, size?.w ?? 720, size?.h ?? 460),
    z: topZ() + 1,
    minimized: false,
    maximized: false,
    payload,
    spaceId: M.state.activeSpace,
  };
  M.state = {
    ...M.state,
    windows: { ...M.state.windows, [id]: win },
    order: [...M.state.order, id],
    focused: id,
    launcherOpen: false,
  };
  emit();
  return id;
}

// Per-window close guards: an app (e.g. the editor with unsaved changes) can veto
// a close. The guard returns false to BLOCK — it then drives its own confirm UI
// and, once resolved, clears itself via setCloseGuard(id, null) and calls
// closeWindow(id) again to actually close.
const closeGuards = new Map<WinId, () => boolean>();
export function setCloseGuard(id: WinId, guard: (() => boolean) | null) {
  if (guard) closeGuards.set(id, guard);
  else closeGuards.delete(id);
}
/** Whether a window has a close guard — the chrome skips its close ANIMATION for
 *  guarded windows so the confirm dialog isn't shown over a faded-out frame. */
export function hasCloseGuard(id: WinId): boolean {
  return closeGuards.has(id);
}

export function closeWindow(id: WinId) {
  if (!M.state.windows[id]) return;
  const guard = closeGuards.get(id);
  if (guard && !guard()) return; // vetoed — the guard handles its own confirm flow
  closeGuards.delete(id);
  const { [id]: _gone, ...rest } = M.state.windows;
  const order = M.state.order.filter((w) => w !== id);
  // Focus falls to the most-recently-focused remaining window (highest z), not
  // the newest-created — matches what the user sees on top after a close.
  const nextFocus = order.reduce<WinId | null>(
    (top, w) => (top === null || (rest[w]?.z ?? 0) >= (rest[top]?.z ?? 0) ? w : top),
    null,
  );
  M.state = {
    ...M.state,
    windows: rest,
    order,
    focused: M.state.focused === id ? nextFocus : M.state.focused,
  };
  emit();
}

export function focusWindow(id: WinId) {
  const win = M.state.windows[id];
  if (!win || M.state.focused === id) return;
  M.state = {
    ...M.state,
    windows: { ...M.state.windows, [id]: { ...win, z: topZ() + 1 } },
    focused: id,
  };
  emit();
}

// Reveal the front-most existing window of an app (restoring if minimized).
// Returns false when none exist — callers then decide whether to open one.
// Lets the URL sync focus an app without spawning a duplicate for `multi` apps.
export function focusApp(app: string, payload?: unknown): boolean {
  const ids = M.state.order.filter((id) => M.state.windows[id]?.app === app);
  if (!ids.length) return false;
  const top = ids.reduce((a, b) => (M.state.windows[a].z >= M.state.windows[b].z ? a : b));
  if (payload !== undefined) patch(top, { payload });
  if (M.state.windows[top].minimized) restoreWindow(top);
  focusWindow(top);
  return true;
}

export function moveWindow(id: WinId, x: number, y: number) {
  patch(id, { x, y, snapZone: undefined }); // free move leaves the snap grid
}
export function resizeWindow(id: WinId, w: number, h: number) {
  patch(id, { w, h, snapZone: undefined });
}
export function minimizeWindow(id: WinId) {
  patch(id, { minimized: true });
}
export function restoreWindow(id: WinId) {
  patch(id, { minimized: false });
  focusWindow(id);
}
export function toggleMaximize(id: WinId) {
  const win = M.state.windows[id];
  if (!win) return;
  if (win.maximized) {
    const r = win.prevRect ?? { x: win.x, y: win.y, w: win.w, h: win.h };
    patch(id, { ...r, maximized: false, prevRect: undefined });
    return;
  }
  const { vw, top, bottom } = workArea();
  patch(id, {
    prevRect: { x: win.x, y: win.y, w: win.w, h: win.h },
    x: GAP,
    y: top,
    w: vw - GAP * 2,
    h: bottom - top,
    maximized: true,
    snapZone: undefined,
  });
}

export function setLauncherOpen(open: boolean) {
  M.state = { ...M.state, launcherOpen: open };
  emit();
}
export function setSpotlightOpen(open: boolean) {
  M.state = { ...M.state, spotlightOpen: open };
  emit();
}
export function toggleSpotlight() {
  setSpotlightOpen(!M.state.spotlightOpen);
}
export function setInspectorOpen(open: boolean) {
  M.state = { ...M.state, inspectorOpen: open };
  emit();
}
export function toggleInspector() {
  setInspectorOpen(!M.state.inspectorOpen);
}
export function setNotificationCenterOpen(open: boolean) {
  M.state = { ...M.state, notificationCenterOpen: open };
  emit();
}
export function toggleNotificationCenter() {
  setNotificationCenterOpen(!M.state.notificationCenterOpen);
}

/** Bulk window ops surfaced as Spotlight commands. */
export function minimizeAll() {
  M.state.order.forEach((id) => minimizeWindow(id));
}
export function closeAll() {
  [...M.state.order].forEach((id) => closeWindow(id));
}
