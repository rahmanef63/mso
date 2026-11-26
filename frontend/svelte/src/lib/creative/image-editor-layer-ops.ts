import { clampNumber, createId } from "./image-editor-doc-utils.ts";
import type {
  DrawingLayer,
  EditorDocument,
  EditorLayer,
  Point,
  ShapeLayer,
  StudioAdjustments,
  TextLayer,
} from "./image-editor-types.ts";

export function updateLayer(
  doc: EditorDocument,
  id: string,
  update: (layer: EditorLayer) => EditorLayer,
): EditorDocument {
  return { ...doc, layers: doc.layers.map((layer) => (layer.id === id ? update(layer) : layer)) };
}

export function removeLayer(doc: EditorDocument, id: string): EditorDocument {
  if (doc.layers.length <= 1) return doc;
  return { ...doc, layers: doc.layers.filter((layer) => layer.id !== id) };
}

export function addDrawingLayer(doc: EditorDocument): { doc: EditorDocument; layerId: string } {
  const layerId = createId("draw");
  const layer: DrawingLayer = {
    id: layerId,
    name: `Drawing ${doc.layers.length + 1}`,
    kind: "drawing",
    visible: true,
    opacity: 1,
    strokes: [],
  };
  return { doc: { ...doc, layers: [...doc.layers, layer] }, layerId };
}

export function insertShapeLayer(
  doc: EditorDocument,
  shape: ShapeLayer,
): { doc: EditorDocument; layerId: string } {
  return { doc: { ...doc, layers: [...doc.layers, shape] }, layerId: shape.id };
}

export function insertTextLayer(
  doc: EditorDocument,
  at: Point,
  options: { text: string; fontSize: number; fontWeight: "400" | "700"; color: string },
): { doc: EditorDocument; layerId: string } {
  const layerId = createId("text");
  const layer: TextLayer = {
    id: layerId,
    name: "Text",
    kind: "text",
    visible: true,
    opacity: 1,
    text: options.text.trim() || "Text",
    x: Math.round(at.x),
    y: Math.round(at.y),
    fontSize: Math.round(clampNumber(options.fontSize, 12, 144)),
    fontWeight: options.fontWeight,
    color: options.color,
  };
  return { doc: { ...doc, layers: [...doc.layers, layer] }, layerId };
}

export function moveLayerBy(doc: EditorDocument, id: string, dx: number, dy: number): EditorDocument {
  return updateLayer(doc, id, (layer) => {
    if (layer.kind !== "text" && layer.kind !== "shape") return layer;
    return { ...layer, x: layer.x + dx, y: layer.y + dy };
  });
}

export function patchAdjustment(
  doc: EditorDocument,
  key: keyof StudioAdjustments,
  value: number,
): EditorDocument {
  return { ...doc, adjustments: { ...doc.adjustments, [key]: value } };
}
