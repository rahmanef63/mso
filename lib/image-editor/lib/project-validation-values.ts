import type {
  Adjustments,
  BlendMode,
  DropShadow,
  LayerStyle,
  OuterGlow,
  Stroke,
  Transform,
} from "./types";

export const IMAGE_EDITOR_LIMITS = {
  maxCanvasDimension: 4096,
  maxCanvasPixels: 16_777_216,
  maxLayerDimension: 32_768,
  maxCoordinateMagnitude: 1_000_000,
  maxScaleMagnitude: 100,
  maxLayers: 128,
  maxProjectBytes: 32 * 1024 * 1024,
  maxEmbeddedAssetBytes: 24 * 1024 * 1024,
  maxSingleAssetBytes: 16 * 1024 * 1024,
  maxPickedImageBytes: 16 * 1024 * 1024,
  maxTextBytes: 256 * 1024,
  maxStringBytes: 8 * 1024,
} as const;

export type ValidationOptions = { allowBlobImages?: boolean };

const BLENDS = new Set<BlendMode>([
  "normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge",
  "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue",
  "saturation", "color", "luminosity",
]);
const RASTER_DATA_URL = /^data:image\/(?:png|jpe?g|webp|gif|avif);base64,/i;

export function isRasterDataUrl(value: string): boolean {
  return RASTER_DATA_URL.test(value);
}

export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

export function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean`);
  return value;
}

export function stringValue(value: unknown, label: string, maxBytes = IMAGE_EDITOR_LIMITS.maxStringBytes): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  if (utf8Bytes(value) > maxBytes) throw new Error(`${label} exceeds its byte limit`);
  if (value.includes("\0")) throw new Error(`${label} contains a null byte`);
  return value;
}

export function finite(value: unknown, label: string, min = -Infinity, max = Infinity): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be finite and between ${min} and ${max}`);
  }
  return value;
}

function finiteInteger(value: unknown, label: string, min: number, max: number): number {
  const number = finite(value, label, min, max);
  if (!Number.isSafeInteger(number)) throw new Error(`${label} must be a safe integer`);
  return number;
}

export function assertImageCanvasBounds(width: unknown, height: unknown): asserts width is number {
  const w = finiteInteger(width, "canvas width", 1, IMAGE_EDITOR_LIMITS.maxCanvasDimension);
  const h = finiteInteger(height, "canvas height", 1, IMAGE_EDITOR_LIMITS.maxCanvasDimension);
  if (w * h > IMAGE_EDITOR_LIMITS.maxCanvasPixels) throw new Error("canvas exceeds the pixel budget");
}

export function safeCanvasSize(width: unknown, height: unknown): { width: number; height: number } {
  assertImageCanvasBounds(width, height);
  return { width: width as number, height: height as number };
}

export function transform(value: unknown, label: string): Transform {
  const o = record(value, label);
  return {
    x: finite(o.x, `${label}.x`, -IMAGE_EDITOR_LIMITS.maxCoordinateMagnitude, IMAGE_EDITOR_LIMITS.maxCoordinateMagnitude),
    y: finite(o.y, `${label}.y`, -IMAGE_EDITOR_LIMITS.maxCoordinateMagnitude, IMAGE_EDITOR_LIMITS.maxCoordinateMagnitude),
    width: finite(o.width, `${label}.width`, 0, IMAGE_EDITOR_LIMITS.maxLayerDimension),
    height: finite(o.height, `${label}.height`, 0, IMAGE_EDITOR_LIMITS.maxLayerDimension),
    rotation: finite(o.rotation, `${label}.rotation`, -IMAGE_EDITOR_LIMITS.maxCoordinateMagnitude, IMAGE_EDITOR_LIMITS.maxCoordinateMagnitude),
    scaleX: finite(o.scaleX, `${label}.scaleX`, -IMAGE_EDITOR_LIMITS.maxScaleMagnitude, IMAGE_EDITOR_LIMITS.maxScaleMagnitude),
    scaleY: finite(o.scaleY, `${label}.scaleY`, -IMAGE_EDITOR_LIMITS.maxScaleMagnitude, IMAGE_EDITOR_LIMITS.maxScaleMagnitude),
  };
}

export function color(value: unknown, label: string): string {
  return stringValue(value, label, 256);
}

function shadow(value: unknown, label: string): DropShadow {
  const o = record(value, label);
  return {
    enabled: bool(o.enabled, `${label}.enabled`),
    color: color(o.color, `${label}.color`),
    opacity: finite(o.opacity, `${label}.opacity`, 0, 1),
    angle: finite(o.angle, `${label}.angle`, -360_000, 360_000),
    distance: finite(o.distance, `${label}.distance`, 0, IMAGE_EDITOR_LIMITS.maxLayerDimension),
    size: finite(o.size, `${label}.size`, 0, IMAGE_EDITOR_LIMITS.maxCanvasDimension),
  };
}

function glow(value: unknown, label: string): OuterGlow {
  const o = record(value, label);
  return {
    enabled: bool(o.enabled, `${label}.enabled`),
    color: color(o.color, `${label}.color`),
    opacity: finite(o.opacity, `${label}.opacity`, 0, 1),
    size: finite(o.size, `${label}.size`, 0, IMAGE_EDITOR_LIMITS.maxCanvasDimension),
  };
}

function stroke(value: unknown, label: string): Stroke {
  const o = record(value, label);
  return {
    enabled: bool(o.enabled, `${label}.enabled`),
    color: color(o.color, `${label}.color`),
    width: finite(o.width, `${label}.width`, 0, IMAGE_EDITOR_LIMITS.maxCanvasDimension),
  };
}

export function style(value: unknown, label: string): LayerStyle {
  const o = record(value, label);
  const blend = stringValue(o.blend, `${label}.blend`, 64) as BlendMode;
  if (!BLENDS.has(blend)) throw new Error(`${label}.blend is unsupported`);
  return {
    blend,
    shadow: shadow(o.shadow, `${label}.shadow`),
    glow: glow(o.glow, `${label}.glow`),
    stroke: stroke(o.stroke, `${label}.stroke`),
    clipBelow: bool(o.clipBelow, `${label}.clipBelow`),
  };
}

export function adjustments(value: unknown, label: string): Adjustments {
  const o = record(value, label);
  return {
    brightness: finite(o.brightness, `${label}.brightness`, -1, 1),
    contrast: finite(o.contrast, `${label}.contrast`, -100, 100),
    saturation: finite(o.saturation, `${label}.saturation`, -2, 10),
    hue: finite(o.hue, `${label}.hue`, -360_000, 360_000),
    blur: finite(o.blur, `${label}.blur`, 0, 40),
    grayscale: bool(o.grayscale, `${label}.grayscale`),
    invert: bool(o.invert, `${label}.invert`),
    sepia: bool(o.sepia, `${label}.sepia`),
  };
}

export function imageSource(value: unknown, label: string, options: ValidationOptions): string {
  const source = stringValue(value, label, IMAGE_EDITOR_LIMITS.maxSingleAssetBytes);
  if (source.startsWith("data:")) {
    if (!RASTER_DATA_URL.test(source)) throw new Error(`${label} must be a base64 raster image`);
    return source;
  }
  if (options.allowBlobImages && source.startsWith("blob:")) return source;
  if (source.startsWith("/") && !source.startsWith("//")) return source;
  let url: URL;
  try { url = new URL(source); } catch { throw new Error(`${label} is not an allowed image URL`); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`${label} uses an unsupported protocol`);
  if (url.username || url.password || url.hash) throw new Error(`${label} must not contain credentials or a fragment`);
  if (utf8Bytes(source) > IMAGE_EDITOR_LIMITS.maxStringBytes) throw new Error(`${label} URL is too long`);
  return source;
}

export function optionalString(o: Record<string, unknown>, key: string, label: string, max = IMAGE_EDITOR_LIMITS.maxStringBytes): string | undefined {
  return o[key] === undefined ? undefined : stringValue(o[key], `${label}.${key}`, max);
}

export function optionalFinite(o: Record<string, unknown>, key: string, label: string, min: number, max: number): number | undefined {
  return o[key] === undefined ? undefined : finite(o[key], `${label}.${key}`, min, max);
}
