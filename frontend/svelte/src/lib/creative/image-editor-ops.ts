import {
  CROP_ASPECTS, type CropAspect, type CropRect, type DrawStroke, type EditorDocument,
  type EditorLayer, type Point, type ShapeLayer,
} from "./image-editor-types.ts";
import { clampNumber, cloneDocument, createId } from "./image-editor-doc-utils.ts";

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
