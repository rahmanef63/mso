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
export { clampNumber, cloneDocument, createId } from "./image-editor-doc-utils.ts";
import { clampNumber, cloneDocument, createId } from "./image-editor-doc-utils.ts";

let uidCounter = 0;



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
export * from "./image-editor-ops.ts";
