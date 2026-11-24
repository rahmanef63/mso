export type WinId = string;
export type WindowRect = { x: number; y: number; w: number; h: number };
export type SnapZone = "left" | "right" | "top" | "bottom" | "tl" | "tr" | "bl" | "br" | "full";
export type DesktopBounds = { width: number; height: number; top?: number; bottom?: number };
export type WindowState = {
  id: WinId; app: string; title: string; x: number; y: number; w: number; h: number; z: number;
  minimized: boolean; maximized: boolean; pinned?: boolean; prevRect?: WindowRect; payload?: unknown;
};
export type ShellLayoutState = { windows: Record<WinId, WindowState>; order: WinId[]; focused: WinId | null };
export type AppSlugMap = Record<string, string>;

const RESERVED_PREFIXES = ["/api", "/_next", "/mcp", "/oauth", "/.well-known", "/a2a"];
const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MIN_W = 240, MIN_H = 180;
const SNAP_GAP = 8;
const emptyLayout = (): ShellLayoutState => ({ windows: {}, order: [], focused: null });
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
function readRect(v: unknown): WindowRect | null {
  if (!isRecord(v)) return null;
  const { x, y, w, h } = v;
  return [x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n)) && (w as number) > 0 && (h as number) > 0
    ? { x: x as number, y: y as number, w: w as number, h: h as number } : null;
}
const topZ = (s: ShellLayoutState) => s.order.reduce((m, id) => Math.max(m, s.windows[id]?.z ?? 0), 0);
function nextVisibleFocus(windows: Record<WinId, WindowState>, order: WinId[]): WinId | null {
  let best: WinId | null = null;
  for (const id of order) { const win = windows[id]; if (win && !win.minimized && (best === null || win.z >= windows[best].z)) best = id; }
  return best;
}
function cloneState(input?: ShellLayoutState): ShellLayoutState {
  if (!input) return emptyLayout();
  const windows: Record<WinId, WindowState> = {};
  const order: WinId[] = [];
  for (const id of input.order) {
    const win = input.windows[id];
    if (!win || BLOCKED_KEYS.has(id) || Object.hasOwn(windows, id)) continue;
    windows[id] = { ...win, ...(win.prevRect ? { prevRect: { ...win.prevRect } } : {}) };
    order.push(id);
  }
  const focused = input.focused && Object.hasOwn(windows, input.focused) && !windows[input.focused].minimized
    ? input.focused : nextVisibleFocus(windows, order);
  return { windows, order, focused };
}
const initialSeq = (s: ShellLayoutState) =>
  s.order.reduce((m, id) => { const hit = /^w(\d+)$/.exec(id); return hit ? Math.max(m, Number(hit[1])) : m; }, 0);

function resolveWorkArea(bounds: DesktopBounds) {
  const width = Number.isFinite(bounds.width) && bounds.width > 0 ? bounds.width : 1280;
  const height = Number.isFinite(bounds.height) && bounds.height > 0 ? bounds.height : 720;
  const topInset = Number.isFinite(bounds.top) && (bounds.top ?? 0) > 0 ? (bounds.top as number) : 0;
  const bottomInset = Number.isFinite(bounds.bottom) && (bounds.bottom ?? 0) > 0 ? (bounds.bottom as number) : 0;
  const x0 = SNAP_GAP;
  const y0 = Math.round(topInset + SNAP_GAP);
  const availW = Math.max(MIN_W, Math.round(width - SNAP_GAP * 2));
  const availH = Math.max(MIN_H, Math.round(height - topInset - bottomInset - SNAP_GAP * 2));
  return { x0, y0, availW, availH };
}

export function computeSnapRect(
  zone: SnapZone,
  bounds: { width: number; height: number; top?: number; bottom?: number },
): WindowRect {
  const { x0, y0, availW, availH } = resolveWorkArea(bounds);
  const halfW = Math.max(MIN_W, Math.floor((availW - SNAP_GAP) / 2));
  const rightW = Math.max(MIN_W, availW - halfW - SNAP_GAP);
  const rightX = x0 + halfW + SNAP_GAP;
  const halfH = Math.max(MIN_H, Math.floor((availH - SNAP_GAP) / 2));
  const bottomH = Math.max(MIN_H, availH - halfH - SNAP_GAP);
  const bottomY = y0 + halfH + SNAP_GAP;

  switch (zone) {
    case "left":
      return { x: x0, y: y0, w: halfW, h: availH };
    case "right":
      return { x: rightX, y: y0, w: rightW, h: availH };
    case "top":
      return { x: x0, y: y0, w: availW, h: halfH };
    case "bottom":
      return { x: x0, y: bottomY, w: availW, h: bottomH };
    case "tl":
      return { x: x0, y: y0, w: halfW, h: halfH };
    case "tr":
      return { x: rightX, y: y0, w: rightW, h: halfH };
    case "bl":
      return { x: x0, y: bottomY, w: halfW, h: bottomH };
    case "br":
      return { x: rightX, y: bottomY, w: rightW, h: bottomH };
    case "full":
      return { x: x0, y: y0, w: availW, h: availH };
  }
}

export function createWindowStore(initial?: ShellLayoutState) {
  let state = cloneState(initial);
  let seq = initialSeq(state);
  const listeners = new Set<(next: ShellLayoutState) => void>();
  const guards = new Map<WinId, () => boolean>();
  const emit = () => { for (const fn of listeners) fn(state); };
  const patch = (id: WinId, delta: Partial<WindowState>, focused = state.focused) => {
    const cur = state.windows[id];
    if (!cur) return;
    state = { ...state, windows: { ...state.windows, [id]: { ...cur, ...delta } }, focused };
    emit();
  };

  function openWindow(app: string, title: string, size?: { w: number; h: number }, payload?: unknown, opts?: { multi?: boolean }): WinId {
    if (!opts?.multi) {
      const existing = state.order.find((id) => state.windows[id]?.app === app);
      if (existing) {
        patch(existing, { minimized: false, z: topZ(state) + 1, payload: payload !== undefined ? payload : state.windows[existing].payload }, existing);
        return existing;
      }
    }
    let id = `w${++seq}`;
    while (Object.hasOwn(state.windows, id)) id = `w${++seq}`;
    const slot = state.order.length % 6;
    const win: WindowState = {
      id, app, title, x: 48 + slot * 28, y: 48 + slot * 28,
      w: Math.max(MIN_W, size?.w ?? 720), h: Math.max(MIN_H, size?.h ?? 460),
      z: topZ(state) + 1, minimized: false, maximized: false,
      ...(payload !== undefined ? { payload } : {}),
    };
    state = { windows: { ...state.windows, [id]: win }, order: [...state.order, id], focused: id };
    emit();
    return id;
  }

  function closeWindow(id: WinId): boolean {
    if (!Object.hasOwn(state.windows, id)) return false;
    const guard = guards.get(id);
    if (guard && !guard()) return false;
    guards.delete(id);
    const windows = { ...state.windows };
    delete windows[id];
    const order = state.order.filter((entry) => entry !== id);
    state = { windows, order, focused: state.focused === id ? nextVisibleFocus(windows, order) : state.focused };
    emit();
    return true;
  }

  function togglePin(id: WinId) {
    const cur = state.windows[id];
    if (!cur) return;
    patch(id, { pinned: !cur.pinned });
  }

  function snapWindow(id: WinId, zone: SnapZone, bounds: DesktopBounds) {
    const cur = state.windows[id];
    if (!cur) return;
    const rect = computeSnapRect(zone, bounds);
    const prevRect = cur.prevRect ?? { x: cur.x, y: cur.y, w: cur.w, h: cur.h };
    patch(
      id,
      { ...rect, minimized: false, maximized: zone === "full", prevRect, z: topZ(state) + 1 },
      id,
    );
  }

  function cascadeWindows(bounds: DesktopBounds) {
    const visible = state.order.filter((id) => state.windows[id] && !state.windows[id].minimized);
    if (visible.length === 0) return;
    const { x0, y0, availW, availH } = resolveWorkArea(bounds);
    const step = 32;
    const w = Math.max(MIN_W, Math.min(Math.round(availW * 0.68), availW));
    const h = Math.max(MIN_H, Math.min(Math.round(availH * 0.72), availH));
    const maxOffset = Math.max(0, Math.min(availW - w, availH - h));
    const maxSlots = Math.max(1, Math.floor(maxOffset / step) + 1);
    const baseZ = topZ(state);
    const windows = { ...state.windows };
    visible.forEach((id, index) => {
      const slot = index % maxSlots;
      const cur = windows[id];
      windows[id] = {
        ...cur,
        x: x0 + slot * step,
        y: y0 + slot * step,
        w,
        h,
        maximized: false,
        prevRect: undefined,
        z: baseZ + index + 1,
      };
    });
    state = { ...state, windows, focused: visible[visible.length - 1] };
    emit();
  }

  function tileWindows(bounds: DesktopBounds) {
    const visible = state.order.filter((id) => state.windows[id] && !state.windows[id].minimized);
    const count = visible.length;
    if (count === 0) return;
    const { x0, y0, availW, availH } = resolveWorkArea(bounds);
    const windows = { ...state.windows };

    if (count === 1) {
      const id = visible[0];
      windows[id] = {
        ...windows[id],
        x: x0,
        y: y0,
        w: availW,
        h: availH,
        maximized: false,
        prevRect: undefined,
      };
    } else {
      const cols = Math.ceil(Math.sqrt(count));
      const rows = Math.ceil(count / cols);
      const cellH = Math.max(MIN_H, Math.floor((availH - SNAP_GAP * (rows - 1)) / rows));
      let idx = 0;
      for (let r = 0; r < rows; r += 1) {
        const remaining = count - idx;
        const rowCols = r === rows - 1 ? remaining : cols;
        const cellW = Math.max(MIN_W, Math.floor((availW - SNAP_GAP * (rowCols - 1)) / rowCols));
        const y = y0 + r * (cellH + SNAP_GAP);
        const h = r === rows - 1 ? Math.max(MIN_H, availH - (y - y0)) : cellH;
        for (let c = 0; c < rowCols; c += 1) {
          const id = visible[idx++];
          const x = x0 + c * (cellW + SNAP_GAP);
          const w = c === rowCols - 1 ? Math.max(MIN_W, availW - (x - x0)) : cellW;
          windows[id] = {
            ...windows[id],
            x,
            y,
            w,
            h,
            maximized: false,
            prevRect: undefined,
          };
        }
      }
    }

    state = { ...state, windows };
    emit();
  }

  function minimizeAll() {
    let changed = state.focused !== null;
    const windows = { ...state.windows };
    for (const id of state.order) {
      const cur = windows[id];
      if (cur && !cur.minimized) {
        windows[id] = { ...cur, minimized: true };
        changed = true;
      }
    }
    if (!changed) return;
    state = { ...state, windows, focused: null };
    emit();
  }

  return {
    subscribe(listener: (next: ShellLayoutState) => void) {
      listeners.add(listener); listener(state);
      return () => { listeners.delete(listener); };
    },
    getState: () => state, openWindow, closeWindow,
    setCloseGuard: (id: WinId, guard: (() => boolean) | null) => { if (guard) guards.set(id, guard); else guards.delete(id); },
    focusWindow: (id: WinId) => { if (Object.hasOwn(state.windows, id) && state.focused !== id) patch(id, { z: topZ(state) + 1 }, id); },
    focusApp(app: string, payload?: unknown): boolean {
      const ids = state.order.filter((id) => state.windows[id]?.app === app);
      if (ids.length === 0) return false;
      const top = ids.reduce((a, b) => (state.windows[a].z >= state.windows[b].z ? a : b));
      patch(top, { minimized: false, z: topZ(state) + 1, payload: payload !== undefined ? payload : state.windows[top].payload }, top);
      return true;
    },
    setWindowPayload(id: WinId, payload: unknown) {
      const cur = state.windows[id];
      if (!cur || cur.payload === payload) return;
      patch(id, { payload });
    },
    minimizeWindow(id: WinId) {
      const cur = state.windows[id];
      if (!cur || cur.minimized) return;
      const windows = { ...state.windows, [id]: { ...cur, minimized: true } };
      state = { ...state, windows, focused: state.focused === id ? nextVisibleFocus(windows, state.order) : state.focused };
      emit();
    },
    restoreWindow: (id: WinId) => { if (Object.hasOwn(state.windows, id)) patch(id, { minimized: false, z: topZ(state) + 1 }, id); },
    toggleMaximize(id: WinId) {
      const cur = state.windows[id];
      if (!cur) return;
      if (cur.maximized) {
        patch(id, { ...(cur.prevRect ?? { x: cur.x, y: cur.y, w: cur.w, h: cur.h }), maximized: false, prevRect: undefined, z: topZ(state) + 1 }, id);
        return;
      }
      patch(id, { prevRect: { x: cur.x, y: cur.y, w: cur.w, h: cur.h }, maximized: true, minimized: false, z: topZ(state) + 1 }, id);
    },
    moveWindow: (id: WinId, x: number, y: number) => {
      if (Object.hasOwn(state.windows, id) && Number.isFinite(x) && Number.isFinite(y)) patch(id, { x, y });
    },
    resizeWindow: (id: WinId, w: number, h: number) => {
      if (Object.hasOwn(state.windows, id) && Number.isFinite(w) && Number.isFinite(h)) patch(id, { w: Math.max(MIN_W, w), h: Math.max(MIN_H, h) });
    },
    togglePin,
    snapWindow,
    cascadeWindows,
    tileWindows,
    minimizeAll,
  };
}

function extractPathPayload(payload: unknown): string | null {
  if (typeof payload === "string" && payload.trim()) return payload;
  return isRecord(payload) && typeof payload.path === "string" && payload.path.trim() ? payload.path : null;
}

export function stateToUrl(state: ShellLayoutState, slugs: AppSlugMap): string {
  const win = state.focused ? state.windows[state.focused] : undefined;
  if (!win || win.minimized) return "/";
  const slug = encodeURIComponent(slugs[win.app] ?? win.app);
  const rawPath = extractPathPayload(win.payload);
  if (!rawPath) return `/${slug}`;
  const encoded = rawPath.replace(/^\/+/, "").split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return encoded ? `/${slug}/${encoded}` : `/${slug}`;
}

export function urlToApp(pathname: string, slugs: AppSlugMap): { app: string; path?: string } | null {
  const clean = pathname.split(/[?#]/, 1)[0] ?? "";
  if (RESERVED_PREFIXES.some((p) => clean === p || clean.startsWith(`${p}/`))) return null;
  const segments = clean.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  let slug: string;
  try { slug = decodeURIComponent(segments[0]); } catch { return null; }
  const app = Object.keys(slugs).find((key) => slugs[key] === slug);
  if (!app) return null;
  if (segments.length === 1) return { app };
  const decoded: string[] = [];
  for (const part of segments.slice(1)) { try { decoded.push(decodeURIComponent(part)); } catch { return null; } }
  return { app, path: decoded[0] === "~" ? decoded.join("/") : `/${decoded.join("/")}` };
}

export function serializeLayout(state: ShellLayoutState): string {
  return JSON.stringify({ version: 1, focused: state.focused, windows: state.order.map((id) => state.windows[id]).filter(Boolean) });
}

export function hydrateLayout(raw: string): ShellLayoutState {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return emptyLayout(); }
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.windows)) return emptyLayout();
  const windows: Record<WinId, WindowState> = {};
  const order: WinId[] = [];
  for (const entry of parsed.windows) {
    const rect = readRect(entry);
    if (!isRecord(entry) || !rect) continue;
    const { id, app, title, z, minimized, maximized, pinned, prevRect, payload } = entry;
    if (typeof id !== "string" || !id || BLOCKED_KEYS.has(id) || Object.hasOwn(windows, id)) continue;
    if (typeof app !== "string" || !app || typeof title !== "string") continue;
    if (typeof z !== "number" || !Number.isFinite(z) || typeof minimized !== "boolean" || typeof maximized !== "boolean") continue;
    const prev = prevRect === undefined ? undefined : readRect(prevRect);
    if (prevRect !== undefined && !prev) continue;
    windows[id] = {
      id, app, title, ...rect, z, minimized, maximized,
      ...(typeof pinned === "boolean" ? { pinned } : {}),
      ...(prev ? { prevRect: prev } : {}),
      ...(payload !== undefined ? { payload } : {}),
    };
    order.push(id);
  }
  const focused = typeof parsed.focused === "string" && Object.hasOwn(windows, parsed.focused) && !windows[parsed.focused].minimized
    ? parsed.focused : nextVisibleFocus(windows, order);
  return { windows, order, focused };
}
