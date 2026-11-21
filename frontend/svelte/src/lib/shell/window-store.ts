export type WinId = string;
export type WindowRect = { x: number; y: number; w: number; h: number };
export type WindowState = {
  id: WinId; app: string; title: string; x: number; y: number; w: number; h: number; z: number;
  minimized: boolean; maximized: boolean; prevRect?: WindowRect; payload?: unknown;
};
export type ShellLayoutState = { windows: Record<WinId, WindowState>; order: WinId[]; focused: WinId | null };
export type AppSlugMap = Record<string, string>;

const RESERVED_PREFIXES = ["/api", "/_next", "/mcp", "/oauth", "/.well-known", "/a2a"];
const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MIN_W = 240, MIN_H = 180;
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
    const { id, app, title, z, minimized, maximized, prevRect, payload } = entry;
    if (typeof id !== "string" || !id || BLOCKED_KEYS.has(id) || Object.hasOwn(windows, id)) continue;
    if (typeof app !== "string" || !app || typeof title !== "string") continue;
    if (typeof z !== "number" || !Number.isFinite(z) || typeof minimized !== "boolean" || typeof maximized !== "boolean") continue;
    const prev = prevRect === undefined ? undefined : readRect(prevRect);
    if (prevRect !== undefined && !prev) continue;
    windows[id] = { id, app, title, ...rect, z, minimized, maximized, ...(prev ? { prevRect: prev } : {}), ...(payload !== undefined ? { payload } : {}) };
    order.push(id);
  }
  const focused = typeof parsed.focused === "string" && Object.hasOwn(windows, parsed.focused) && !windows[parsed.focused].minimized
    ? parsed.focused : nextVisibleFocus(windows, order);
  return { windows, order, focused };
}
