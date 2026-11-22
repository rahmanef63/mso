import type { Doc, Layer, LayerKind, ShapeKind } from "./types";
import {
  IMAGE_EDITOR_LIMITS,
  adjustments,
  bool,
  color,
  finite,
  imageSource,
  isRasterDataUrl,
  optionalFinite,
  optionalString,
  record,
  safeCanvasSize,
  stringValue,
  style,
  transform,
  utf8Bytes,
} from "./project-validation-values";
import type { ValidationOptions } from "./project-validation-values";

export {
  IMAGE_EDITOR_LIMITS,
  assertImageCanvasBounds,
  safeCanvasSize,
} from "./project-validation-values";

export type ValidatedProject = { v: 1; doc: Doc; paint: Record<string, string> };

const LAYER_KINDS = new Set<LayerKind>(["image", "text", "shape", "paint", "adjustment"]);
const SHAPES = new Set<ShapeKind>(["rect", "ellipse", "line"]);
const ALIGNS = new Set(["left", "center", "right"] as const);
const FILL_TYPES = new Set(["solid", "gradient"] as const);

function layer(value: unknown, index: number, options: ValidationOptions): Layer {
  const label = `doc.layers[${index}]`;
  const o = record(value, label);
  const kind = stringValue(o.kind, `${label}.kind`, 32) as LayerKind;
  if (!LAYER_KINDS.has(kind)) throw new Error(`${label}.kind is unsupported`);
  const out: Layer = {
    id: stringValue(o.id, `${label}.id`, 256),
    name: stringValue(o.name, `${label}.name`, 512),
    kind,
    visible: bool(o.visible, `${label}.visible`),
    locked: bool(o.locked, `${label}.locked`),
    opacity: finite(o.opacity, `${label}.opacity`, 0, 1),
    t: transform(o.t, `${label}.t`),
    style: style(o.style, `${label}.style`),
    adj: adjustments(o.adj, `${label}.adj`),
  };
  if (!out.id.trim()) throw new Error(`${label}.id must not be empty`);
  if (o.mask !== undefined) out.mask = bool(o.mask, `${label}.mask`);
  if (o.src !== undefined) out.src = imageSource(o.src, `${label}.src`, options);
  if (o.text !== undefined) out.text = stringValue(o.text, `${label}.text`, IMAGE_EDITOR_LIMITS.maxTextBytes);
  const fontSize = optionalFinite(o, "fontSize", label, 1, IMAGE_EDITOR_LIMITS.maxCanvasDimension);
  if (fontSize !== undefined) out.fontSize = fontSize;
  const fontFamily = optionalString(o, "fontFamily", label, 512); if (fontFamily !== undefined) out.fontFamily = fontFamily;
  const fontStyle = optionalString(o, "fontStyle", label, 128); if (fontStyle !== undefined) out.fontStyle = fontStyle;
  if (o.align !== undefined) {
    const align = stringValue(o.align, `${label}.align`, 16) as "left" | "center" | "right";
    if (!ALIGNS.has(align)) throw new Error(`${label}.align is unsupported`);
    out.align = align;
  }
  const fill = optionalString(o, "fill", label, 256); if (fill !== undefined) out.fill = fill;
  if (o.shape !== undefined) {
    const shape = stringValue(o.shape, `${label}.shape`, 16) as ShapeKind;
    if (!SHAPES.has(shape)) throw new Error(`${label}.shape is unsupported`);
    out.shape = shape;
  }
  const fillColor = optionalString(o, "fillColor", label, 256); if (fillColor !== undefined) out.fillColor = fillColor;
  if (o.fillType !== undefined) {
    const fillType = stringValue(o.fillType, `${label}.fillType`, 16) as "solid" | "gradient";
    if (!FILL_TYPES.has(fillType)) throw new Error(`${label}.fillType is unsupported`);
    out.fillType = fillType;
  }
  if (o.gradient !== undefined) {
    const g = record(o.gradient, `${label}.gradient`);
    out.gradient = {
      from: color(g.from, `${label}.gradient.from`),
      to: color(g.to, `${label}.gradient.to`),
      angle: finite(g.angle, `${label}.gradient.angle`, -360_000, 360_000),
    };
  }
  return out;
}

export function validateImageEditorDoc(value: unknown, options: ValidationOptions = {}): Doc {
  const o = record(value, "doc");
  const { width, height } = safeCanvasSize(o.width, o.height);
  const layers = o.layers;
  if (!Array.isArray(layers)) throw new Error("doc.layers must be an array");
  if (layers.length > IMAGE_EDITOR_LIMITS.maxLayers) throw new Error("doc exceeds the layer limit");
  const parsed = layers.map((candidate, index) => layer(candidate, index, options));
  const ids = new Set<string>();
  for (const candidate of parsed) {
    if (ids.has(candidate.id)) throw new Error(`duplicate layer id: ${candidate.id}`);
    ids.add(candidate.id);
  }
  return {
    width,
    height,
    bg: stringValue(o.bg, "doc.bg", 256),
    layers: parsed,
  };
}

function embeddedBytes(source: string): number {
  return source.startsWith("data:") ? utf8Bytes(source) : 0;
}

export function validateImageEditorProject(value: unknown): ValidatedProject {
  const candidate = record(value, "project");
  const full = candidate.v === 1 && candidate.doc !== undefined;
  const doc = validateImageEditorDoc(full ? candidate.doc : candidate);
  const paintValue = full ? candidate.paint ?? {} : {};
  const paintRecord = record(paintValue, "project.paint");
  const paintLayerIds = new Set(doc.layers.filter((item) => item.kind === "paint").map((item) => item.id));
  const paint: Record<string, string> = {};
  let assets = doc.layers.reduce((sum, item) => sum + (item.src ? embeddedBytes(item.src) : 0), 0);
  const entries = Object.entries(paintRecord);
  if (entries.length > IMAGE_EDITOR_LIMITS.maxLayers) throw new Error("project.paint exceeds the layer limit");
  for (const [id, raw] of entries) {
    if (!paintLayerIds.has(id)) throw new Error(`project.paint references a non-paint layer: ${id}`);
    const url = imageSource(raw, `project.paint.${id}`, {});
    if (!isRasterDataUrl(url)) throw new Error(`project.paint.${id} must be embedded raster data`);
    assets += embeddedBytes(url);
    if (assets > IMAGE_EDITOR_LIMITS.maxEmbeddedAssetBytes) throw new Error("project embedded assets exceed the byte budget");
    paint[id] = url;
  }
  return { v: 1, doc, paint };
}

export function parseImageEditorProject(text: string): ValidatedProject {
  if (utf8Bytes(text) > IMAGE_EDITOR_LIMITS.maxProjectBytes) throw new Error("project exceeds the byte limit");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("project JSON is malformed"); }
  return validateImageEditorProject(value);
}

export async function readBoundedProjectResponse(response: Response): Promise<string> {
  if (!response.ok) throw new Error(`Failed to load project (${response.status})`);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > IMAGE_EDITOR_LIMITS.maxProjectBytes) throw new Error("project exceeds the byte limit");
  if (!response.body) {
    const text = await response.text();
    if (utf8Bytes(text) > IMAGE_EDITOR_LIMITS.maxProjectBytes) throw new Error("project exceeds the byte limit");
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > IMAGE_EDITOR_LIMITS.maxProjectBytes) {
        await reader.cancel("project exceeds the byte limit").catch(() => {});
        throw new Error("project exceeds the byte limit");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

export async function readBoundedProjectFile(file: File): Promise<string> {
  if (file.size > IMAGE_EDITOR_LIMITS.maxProjectBytes) throw new Error("project exceeds the byte limit");
  const text = await file.text();
  if (utf8Bytes(text) > IMAGE_EDITOR_LIMITS.maxProjectBytes) throw new Error("project exceeds the byte limit");
  return text;
}
