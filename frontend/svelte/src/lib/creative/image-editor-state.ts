import {
  CROP_ASPECTS,
  FILTER_PRESETS,
  type CropAspect,
  type CropRect,
  type DocTransform,
  type DrawStroke,
  type EditorDocument,
  type EditorLayer,
  type HistoryStack,
  type Point,
  type StudioAdjustments,
} from "./image-editor-types.ts";

export * from "./image-editor-types.ts";

let uidCounter = 0;

export function createId(prefix: string): string {
  uidCounter += 1;
  return `${prefix}-${uidCounter}`;
}

export function clampNumber(value: number, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (!Number.isFinite(value)) return lo;
  return Math.min(hi, Math.max(lo, value));
}

export function defaultStudioAdjustments(): StudioAdjustments {
  return {
    brightness: 100,
    contrast: 100,
    saturation: 100,
    exposure: 0,
    hueRotate: 0,
    sepia: 0,
    grayscale: 0,
    blur: 0,
    vignette: 0,
  };
}

export function createBlankDocument(width = 1080, height = 1080, background = "#ffffff"): EditorDocument {
  const safeW = Math.round(clampNumber(width, 64, 4096));
  const safeH = Math.round(clampNumber(height, 64, 4096));
  return {
    width: safeW,
    height: safeH,
    background,
    adjustments: defaultStudioAdjustments(),
    activeFilter: "original",
    transform: { rotateDeg: 0, flipH: false, flipV: false },
    layers: [{ id: createId("draw"), name: "Drawing 1", kind: "drawing", visible: true, opacity: 1, strokes: [] }],
  };
}

export function createImageDocument(src: string, width: number, height: number, name = "Base Image"): EditorDocument {
  const safeW = Math.round(clampNumber(width, 64, 4096));
  const safeH = Math.round(clampNumber(height, 64, 4096));
  return {
    width: safeW,
    height: safeH,
    background: "transparent",
    adjustments: defaultStudioAdjustments(),
    activeFilter: "original",
    transform: { rotateDeg: 0, flipH: false, flipV: false },
    layers: [
      { id: createId("img"), name, kind: "image", visible: true, opacity: 1, src, x: 0, y: 0, width: safeW, height: safeH },
      { id: createId("draw"), name: "Drawing 1", kind: "drawing", visible: true, opacity: 1, strokes: [] },
    ],
  };
}

export function cloneDocument(doc: EditorDocument): EditorDocument {
  return structuredClone(doc);
}

export function buildStudioFilter(adj: StudioAdjustments): string {
  const exposureFactor = Math.pow(2, clampNumber(adj.exposure, -100, 100) / 100);
  const brightness = Math.round(clampNumber(adj.brightness, 0, 200) * exposureFactor);
  const contrast = Math.round(clampNumber(adj.contrast, 0, 200));
  const saturate = Math.round(clampNumber(adj.saturation, 0, 200));
  const hue = Math.round(clampNumber(adj.hueRotate, -180, 180));
  const sepia = Math.round(clampNumber(adj.sepia, 0, 100));
  const gray = Math.round(clampNumber(adj.grayscale, 0, 100));
  const blur = Math.round(clampNumber(adj.blur, 0, 20) * 10) / 10;
  const parts = [`brightness(${brightness}%)`, `contrast(${contrast}%)`, `saturate(${saturate}%)`];
  if (hue !== 0) parts.push(`hue-rotate(${hue}deg)`);
  if (sepia > 0) parts.push(`sepia(${sepia}%)`);
  if (gray > 0) parts.push(`grayscale(${gray}%)`);
  if (blur > 0) parts.push(`blur(${blur}px)`);
  return parts.join(" ");
}

export function applyFilterPreset(doc: EditorDocument, presetId: string): EditorDocument {
  const preset = FILTER_PRESETS.find((p) => p.id === presetId);
  if (!preset) return doc;
  return { ...doc, activeFilter: preset.id, adjustments: { ...defaultStudioAdjustments(), ...preset.adjustments } };
}

export function rotateTransformRight(t: DocTransform): DocTransform {
  return { ...t, rotateDeg: (((Math.round(t.rotateDeg) + 90) % 360) + 360) % 360 };
}

export function createHistory(limit = 50): HistoryStack {
  return { past: [], future: [], limit: Math.max(1, Math.round(limit)) };
}

export function pushHistory(history: HistoryStack, snapshot: EditorDocument): HistoryStack {
  const nextPast = [...history.past, cloneDocument(snapshot)].slice(-history.limit);
  return { ...history, past: nextPast, future: [] };
}

export function undoHistory(
  history: HistoryStack,
  current: EditorDocument,
): { history: HistoryStack; doc: EditorDocument } {
  if (history.past.length === 0) return { history, doc: current };
  const previous = history.past[history.past.length - 1]!;
  const nextPast = history.past.slice(0, -1);
  const nextFuture = [cloneDocument(current), ...history.future].slice(0, history.limit);
  return { history: { ...history, past: nextPast, future: nextFuture }, doc: cloneDocument(previous) };
}

export function redoHistory(
  history: HistoryStack,
  current: EditorDocument,
): { history: HistoryStack; doc: EditorDocument } {
  if (history.future.length === 0) return { history, doc: current };
  const nextDoc = history.future[0]!;
  const nextFuture = history.future.slice(1);
  const nextPast = [...history.past, cloneDocument(current)].slice(-history.limit);
  return { history: { ...history, past: nextPast, future: nextFuture }, doc: cloneDocument(nextDoc) };
}

export function reorderLayer(layers: readonly EditorLayer[], id: string, delta: -1 | 1): EditorLayer[] {
  const idx = layers.findIndex((l) => l.id === id);
  if (idx < 0) return [...layers];
  const target = idx + delta;
  if (target < 0 || target >= layers.length) return [...layers];
  const next = [...layers];
  const [moved] = next.splice(idx, 1);
  if (moved) next.splice(target, 0, moved);
  return next;
}

export function duplicateLayer(layers: readonly EditorLayer[], id: string): { layers: EditorLayer[]; newId: string | null } {
  const idx = layers.findIndex((l) => l.id === id);
  if (idx < 0) return { layers: [...layers], newId: null };
  const clone = structuredClone(layers[idx]!);
  clone.id = createId(clone.kind);
  clone.name = `${clone.name} Copy`;
  if (clone.kind === "text" || clone.kind === "shape") {
    clone.x += 20;
    clone.y += 20;
  }
  const next = [...layers];
  next.splice(idx + 1, 0, clone);
  return { layers: next, newId: clone.id };
}

export function appendStrokeToDocument(
  doc: EditorDocument,
  selectedLayerId: string | null,
  stroke: DrawStroke,
): { doc: EditorDocument; layerId: string } {
  const target = doc.layers.find((l) => l.id === selectedLayerId && l.kind === "drawing")
    ?? [...doc.layers].reverse().find((l) => l.kind === "drawing");
  if (target && target.kind === "drawing") {
    return {
      layerId: target.id,
      doc: {
        ...doc,
        layers: doc.layers.map((l) => (l.id === target.id && l.kind === "drawing" ? { ...l, strokes: [...l.strokes, stroke] } : l)),
      },
    };
  }
  const layerId = createId("draw");
  return {
    layerId,
    doc: {
      ...doc,
      layers: [...doc.layers, { id: layerId, name: `Drawing ${doc.layers.length + 1}`, kind: "drawing", visible: true, opacity: 1, strokes: [stroke] }],
    },
  };
}

export function buildAspectCropRect(docWidth: number, docHeight: number, aspect: CropAspect): CropRect {
  const entry = CROP_ASPECTS.find((a) => a.id === aspect);
  if (!entry || entry.ratio === null) return { x: 0, y: 0, width: docWidth, height: docHeight };
  let w = docWidth;
  let h = w / entry.ratio;
  if (h > docHeight) {
    h = docHeight;
    w = h * entry.ratio;
  }
  const width = Math.max(16, Math.round(w));
  const height = Math.max(16, Math.round(h));
  return { x: Math.round((docWidth - width) / 2), y: Math.round((docHeight - height) / 2), width, height };
}

export function clampCropRect(rect: CropRect, docWidth: number, docHeight: number): CropRect {
  const width = Math.round(clampNumber(rect.width, 16, docWidth));
  const height = Math.round(clampNumber(rect.height, 16, docHeight));
  const x = Math.round(clampNumber(rect.x, 0, Math.max(0, docWidth - width)));
  const y = Math.round(clampNumber(rect.y, 0, Math.max(0, docHeight - height)));
  return { x, y, width, height };
}

export function applyCropToDocument(doc: EditorDocument, rawCrop: CropRect): EditorDocument {
  const crop = clampCropRect(rawCrop, doc.width, doc.height);
  const layers: EditorLayer[] = doc.layers.map((layer) => {
    if (layer.kind === "image" || layer.kind === "text" || layer.kind === "shape") {
      return { ...layer, x: layer.x - crop.x, y: layer.y - crop.y };
    }
    return {
      ...layer,
      strokes: layer.strokes.map((s) => ({
        ...s,
        points: s.points.map((pt) => ({ x: pt.x - crop.x, y: pt.y - crop.y })),
      })),
    };
  });
  return { ...doc, width: crop.width, height: crop.height, layers };
}

export function hitTestLayer(doc: EditorDocument, pt: Point): EditorLayer | null {
  for (let i = doc.layers.length - 1; i >= 0; i -= 1) {
    const layer = doc.layers[i]!;
    if (!layer.visible) continue;
    if (layer.kind === "text") {
      const approxW = Math.max(48, layer.text.length * layer.fontSize * 0.62);
      const approxH = layer.fontSize * 1.25;
      if (pt.x >= layer.x && pt.x <= layer.x + approxW && pt.y >= layer.y && pt.y <= layer.y + approxH) return layer;
    } else if (layer.kind === "shape") {
      const minX = Math.min(layer.x, layer.x + layer.width) - 8;
      const maxX = Math.max(layer.x, layer.x + layer.width) + 8;
      const minY = Math.min(layer.y, layer.y + layer.height) - 8;
      const maxY = Math.max(layer.y, layer.y + layer.height) + 8;
      if (pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY) return layer;
    }
  }
  return null;
}
