"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type Konva from "konva";
import type { Doc, Layer, Pan, Tool } from "./types";
import { blankDoc } from "./model";
import { useLayerMutators } from "./layer-mutators";
import { useDocOps } from "./doc-ops";
import { useHistory } from "./history";
import { useProjectIO } from "./project";
import { useMaskOps } from "./mask";
import type { Brush, Ctx } from "./store-types";
import { assertImageCanvasBounds, validateImageEditorDoc } from "./project-validation";

export type { Brush, Pan } from "./store-types";

const DEFAULT_FG = "#111827";
const DEFAULT_BG = "#ffffff";

const EditorContext = createContext<Ctx | null>(null);

export function EditorProvider({ initialDoc, children }: { initialDoc?: Doc; children: ReactNode }) {
  const [doc, setDocState] = useState<Doc>(() => validateImageEditorDoc(initialDoc ?? blankDoc(), { allowBlobImages: true }));
  // Selection + mask-edit live in ONE state so their invariant (mask-editing is
  // scoped to the selected layer) is enforced atomically in the setters instead
  // of an effect-driven reset (react-hooks/set-state-in-effect).
  const [sel, setSel] = useState<{ id: string | null; mask: string | null }>(() => ({
    id: doc.layers.at(-1)?.id ?? null,
    mask: null,
  }));
  const selectedId = sel.id;
  const maskEditId = sel.mask;
  const setSelectedId = useCallback(
    (v: string | null | ((s: string | null) => string | null)) =>
      setSel((s) => {
        const id = typeof v === "function" ? v(s.id) : v;
        // Switching layers exits mask-edit — the brush can never silently keep
        // painting a different layer's mask (the "my strokes vanish" bug).
        return { id, mask: s.mask && s.mask !== id ? null : s.mask };
      }),
    [],
  );
  const setMaskEditId = useCallback(
    (v: string | null | ((m: string | null) => string | null)) =>
      setSel((s) => ({ ...s, mask: typeof v === "function" ? v(s.mask) : v })),
    [],
  );
  const [tool, setTool] = useState<Tool>("move");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 });
  const [brush, setBrushState] = useState<Brush>({ size: 28, color: DEFAULT_FG, opacity: 1, hardness: 0.8 });
  const [fg, setFgState] = useState(DEFAULT_FG);
  const [bg, setBgState] = useState(DEFAULT_BG);
  const [recentColors, setRecent] = useState<string[]>([]);

  const setFg = useCallback((c: string) => {
    setFgState(c);
    setBrushState((s) => ({ ...s, color: c }));
    setRecent((r) => [c, ...r.filter((x) => x !== c)].slice(0, 12));
  }, []);
  const swapColors = useCallback(() => {
    setFgState((f) => { setBrushState((s) => ({ ...s, color: bg })); setBgState(f); return bg; });
  }, [bg]);
  const resetColors = useCallback(() => { setFgState(DEFAULT_FG); setBgState(DEFAULT_BG); setBrushState((s) => ({ ...s, color: DEFAULT_FG })); }, []);

  // Entering mask-edit selects that layer (atomic with the selection state).
  const setMaskEdit = useCallback(
    (id: string | null) => setSel((s) => ({ id: id ?? s.id, mask: id })),
    [],
  );
  const canvases = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const stageRef = useRef<Konva.Stage | null>(null);
  // The editor's root DOM node — the keyboard hooks gate on it so Delete/Space/
  // tool keys only act when focus is inside THIS editor, never a sibling window.
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Restore a paint layer's pixels from a PNG snapshot (undo/redo of strokes).
  const applyPaint = useCallback((id: string, dataUrl: string) => {
    const c = canvases.current.get(id);
    if (!c) return;
    const img = new window.Image();
    img.onload = () => {
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      stageRef.current?.draw();
    };
    img.src = dataUrl;
  }, []);

  const history = useHistory({ doc: setDocState, paint: applyPaint });
  const { push, undo, redo, rev, canUndo, canRedo } = history;

  // Apply a doc change, pushing a {before,after} step unless transient (track:false).
  const setDoc = useCallback((next: Doc | ((d: Doc) => Doc), track = true) => {
    setDocState((prev) => {
      const n = typeof next === "function" ? next(prev) : next;
      const safe = validateImageEditorDoc(n, { allowBlobImages: true });
      if (track) push({ type: "doc", before: prev, after: safe });
      return safe;
    });
  }, [push]);

  const mapLayer = useCallback(
    (id: string, fn: (l: Layer) => Layer, track = true) =>
      setDoc((d) => ({ ...d, layers: d.layers.map((l) => (l.id === id ? fn(l) : l)) }), track),
    [setDoc],
  );
  const { update, patchStyle, patchShadow, patchGlow, patchStroke, patchAdj } = useLayerMutators(mapLayer);
  const { addLayer, removeLayer, duplicateLayer, reorder, raise, lower, setDocSize, applyCrop } = useDocOps(setDoc, canvases, setSelectedId);
  const recordPaint = useCallback((id: string, before: string, after: string) => push({ type: "paint", id, before, after }), [push]);

  const canvasFor = useCallback((id: string, w: number, h: number) => {
    assertImageCanvasBounds(w, h);
    let c = canvases.current.get(id);
    if (!c) {
      c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      canvases.current.set(id, c);
    }
    return c;
  }, []);

  // Where the doc sits on the stage right now (pan = its top-left in stage px,
  // zoom = on-screen scale) — the exporter normalizes this back to doc px.
  const docView = useCallback(
    () => ({ x: pan.x, y: pan.y, width: doc.width, height: doc.height, zoom }),
    [pan.x, pan.y, doc.width, doc.height, zoom],
  );

  const { exportProject, loadProject } = useProjectIO({ doc, canvases, canvasFor, setDoc: setDocState, setSelected: setSelectedId, stageRef });
  const { addMask, removeMask } = useMaskOps({ canvasFor, canvases, update, docSize: () => ({ w: doc.width, h: doc.height }), setMaskEdit: setMaskEditId });

  const value = useMemo<Ctx>(() => ({
    doc, selectedId, selected: doc.layers.find((l) => l.id === selectedId) ?? null,
    tool, zoom, pan, brush, fg, bg, recentColors, canUndo, canRedo, version: rev, maskEditId, stageRef, rootRef, canvasFor, docView,
    select: setSelectedId, setTool, setZoom, setPan, setMaskEdit,
    setBrush: (b) => setBrushState((s) => ({ ...s, ...b })),
    setFg, setBg: setBgState, swapColors, resetColors,
    setDocSize, update, patchStyle, patchShadow, patchGlow, patchStroke, patchAdj,
    addLayer, removeLayer, duplicateLayer, reorder, raise, lower, applyCrop, addMask, removeMask,
    recordPaint, exportProject, loadProject, undo, redo,
  }), [doc, selectedId, setSelectedId, tool, zoom, pan, brush, fg, bg, recentColors, canUndo, canRedo, rev, maskEditId, canvasFor, docView, setFg, swapColors, resetColors, setMaskEdit, setDocSize, update, patchStyle, patchShadow, patchGlow, patchStroke, patchAdj, addLayer, removeLayer, duplicateLayer, reorder, raise, lower, applyCrop, addMask, removeMask, recordPaint, exportProject, loadProject, undo, redo]);

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

export function useEditor(): Ctx {
  const c = useContext(EditorContext);
  if (!c) throw new Error("useEditor must be used within <EditorProvider>");
  return c;
}
