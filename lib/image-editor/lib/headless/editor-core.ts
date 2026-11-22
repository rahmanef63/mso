import type {
  Adjustments,
  Doc,
  DropShadow,
  Layer,
  LayerStyle,
  OuterGlow,
  Stroke,
  Tool,
} from "../types";
import { createLayer } from "../model";
import { assertImageCanvasBounds, validateImageEditorDoc } from "../project-validation";

// A React-free editor context that implements the exact subset of the store
// surface the command registry calls (see commands/*.commands.ts). It mirrors
// the pure doc→doc logic of lib/{doc-ops,layer-mutators} WITHOUT hooks, DOM, or
// Konva — so the same commands the in-browser AI uses can run server-side
// (headless render/export route + the /os-image-editor CLI).
//
// Out of scope (no DOM): paint pixels (brush strokes), so applyCrop just
// resizes + shifts layers (no canvas re-bake) and masks are a flag only.

export type HeadlessCtx = {
  doc: Doc;
  selectedId: string | null;
  tool: Tool;
  brush: { size: number; color: string; opacity: number; hardness: number };
  fg: string;
  bg: string;
  canUndo: boolean;
  canRedo: boolean;
} & Record<string, unknown>;

export function createHeadlessEditor(initial: Doc): HeadlessCtx {
  let doc = validateImageEditorDoc(initial);
  let selectedId: string | null = doc.layers.at(-1)?.id ?? null;
  let tool: Tool = "move";
  let brush = { size: 28, color: "#111827", opacity: 1, hardness: 0.8 };
  let fg = "#111827";
  let bg = "#ffffff";
  const past: Doc[] = [];
  const future: Doc[] = [];

  const setDoc = (next: Doc | ((d: Doc) => Doc), track = true) => {
    const n = typeof next === "function" ? (next as (d: Doc) => Doc)(doc) : next;
    if (track) {
      past.push(doc);
      future.length = 0;
    }
    doc = validateImageEditorDoc(n);
  };
  const mapLayer = (id: string, fn: (l: Layer) => Layer) =>
    setDoc((d) => ({ ...d, layers: d.layers.map((l) => (l.id === id ? fn(l) : l)) }));
  const move = (id: string, dir: 1 | -1) =>
    setDoc((d) => {
      const i = d.layers.findIndex((l) => l.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.layers.length) return d;
      const ls = [...d.layers];
      [ls[i], ls[j]] = [ls[j], ls[i]];
      return { ...d, layers: ls };
    });

  return {
    get doc() { return doc; },
    get selectedId() { return selectedId; },
    get selected() { return doc.layers.find((l) => l.id === selectedId) ?? null; },
    get tool() { return tool; },
    get brush() { return brush; },
    get fg() { return fg; },
    get bg() { return bg; },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },

    select: (id: string | null) => { selectedId = id; },
    setTool: (t: Tool) => { tool = t; },
    setBrush: (b: Partial<typeof brush>) => { brush = { ...brush, ...b }; },
    setFg: (c: string) => { fg = c; brush = { ...brush, color: c }; },
    setBg: (c: string) => { bg = c; },
    swapColors: () => { const f = fg; fg = bg; bg = f; brush = { ...brush, color: fg }; },
    resetColors: () => { fg = "#111827"; bg = "#ffffff"; brush = { ...brush, color: fg }; },

    addLayer: (layer: Layer, opts?: { select?: boolean }) => {
      setDoc((d) => ({ ...d, layers: [...d.layers, layer] }));
      if (opts?.select !== false) selectedId = layer.id;
    },
    removeLayer: (id: string) => {
      setDoc((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== id) }));
      if (selectedId === id) selectedId = null;
    },
    duplicateLayer: (id: string) =>
      setDoc((d) => {
        const i = d.layers.findIndex((l) => l.id === id);
        if (i < 0) return d;
        const src = d.layers[i];
        const copy = createLayer(src.kind, { ...src, name: `${src.name} copy`, t: { ...src.t, x: src.t.x + 24, y: src.t.y + 24 } });
        return { ...d, layers: [...d.layers.slice(0, i + 1), copy, ...d.layers.slice(i + 1)] };
      }),
    reorder: (from: number, to: number) =>
      setDoc((d) => {
        const ls = [...d.layers];
        const [m] = ls.splice(from, 1);
        ls.splice(to, 0, m);
        return { ...d, layers: ls };
      }),
    raise: (id: string) => move(id, 1),
    lower: (id: string) => move(id, -1),
    setDocSize: (w: number, h: number) => {
      assertImageCanvasBounds(w, h);
      setDoc((d) => ({ ...d, width: w, height: h }));
    },
    applyCrop: (x: number, y: number, w: number, h: number) => {
      if (![x, y].every(Number.isFinite)) throw new Error("crop origin must be finite");
      assertImageCanvasBounds(Math.round(w), Math.round(h));
      setDoc((d) => ({
        ...d,
        width: Math.round(w),
        height: Math.round(h),
        layers: d.layers.map((l) => ({ ...l, t: { ...l.t, x: l.t.x - x, y: l.t.y - y } })),
      }));
    },

    update: (id: string, patch: Partial<Layer>) => mapLayer(id, (l) => ({ ...l, ...patch })),
    patchStyle: (id: string, p: Partial<LayerStyle>) => mapLayer(id, (l) => ({ ...l, style: { ...l.style, ...p } })),
    patchShadow: (id: string, p: Partial<DropShadow>) => mapLayer(id, (l) => ({ ...l, style: { ...l.style, shadow: { ...l.style.shadow, ...p } } })),
    patchGlow: (id: string, p: Partial<OuterGlow>) => mapLayer(id, (l) => ({ ...l, style: { ...l.style, glow: { ...l.style.glow, ...p } } })),
    patchStroke: (id: string, p: Partial<Stroke>) => mapLayer(id, (l) => ({ ...l, style: { ...l.style, stroke: { ...l.style.stroke, ...p } } })),
    patchAdj: (id: string, p: Partial<Adjustments>) => mapLayer(id, (l) => ({ ...l, adj: { ...l.adj, ...p } })),

    addMask: (id: string) => mapLayer(id, (l) => ({ ...l, mask: true })),
    removeMask: (id: string) => mapLayer(id, (l) => ({ ...l, mask: false })),
    recordPaint: () => {},

    undo: () => { if (past.length) { future.push(doc); doc = past.pop()!; } },
    redo: () => { if (future.length) { past.push(doc); doc = future.pop()!; } },
  };
}
