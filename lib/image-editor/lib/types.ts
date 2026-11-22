// Core data model for the image editor. Document = ordered layers on a fixed
// canvas. Everything is client-side state (Konva renders it); no backend.
// Layer order: layers[0] is the BOTTOM of the stack, last is the TOP — matches
// Konva's z-order (later children paint on top). The layers PANEL reverses this
// for display (top layer shown first).

export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

// "adjustment" = a content-less layer whose `adj` filters everything BELOW it
// (rendered via filtered-group in the editor-stage accumulator).
export type LayerKind = "image" | "text" | "shape" | "paint" | "adjustment";
export type ShapeKind = "rect" | "ellipse" | "line";

// Photoshop "Blending Options" → mapped onto Konva node props in konva-helpers.
export type DropShadow = {
  enabled: boolean;
  color: string;
  opacity: number; // 0..1
  angle: number; // degrees, 0 = →, 90 = ↓ (light from top)
  distance: number; // px offset along angle
  size: number; // blur radius
};
export type OuterGlow = {
  enabled: boolean;
  color: string;
  opacity: number; // 0..1
  size: number; // blur radius (offset 0 → centered = glow)
};
export type Stroke = {
  enabled: boolean;
  color: string;
  width: number;
};

export type LayerStyle = {
  blend: BlendMode;
  shadow: DropShadow;
  glow: OuterGlow;
  stroke: Stroke;
  /** Clipping mask: show this layer only where the layer BELOW is opaque. */
  clipBelow: boolean;
};

// Per-layer non-destructive adjustments → Konva.Filters in konva-helpers.
export type Adjustments = {
  brightness: number; // -1..1   (Konva Brighten)
  contrast: number; // -100..100 (Konva Contrast)
  saturation: number; // -2..10  (Konva HSL.saturation)
  hue: number; // 0..360         (Konva HSL.hue)
  blur: number; // 0..40         (Konva Blur radius)
  grayscale: boolean;
  invert: boolean;
  sepia: boolean;
};

/** Canvas pan offset (the doc group's top-left position in stage pixels). */
export type Pan = { x: number; y: number };

export type Transform = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number; // degrees
  scaleX: number; // negative = horizontal flip
  scaleY: number; // negative = vertical flip
};

export type Layer = {
  id: string;
  name: string;
  kind: LayerKind;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0..1
  t: Transform;
  style: LayerStyle;
  adj: Adjustments;
  /** Has a layer mask (doc-aligned alpha buffer in the canvas map at maskKey(id)). */
  mask?: boolean;
  // image
  src?: string; // data URL / remote URL
  // paint — pixels live in an offscreen <canvas> kept in the store's canvas map,
  // keyed by the layer id (not serialized into the doc snapshot).
  // text
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontStyle?: string; // "normal" | "bold" | "italic" | "bold italic"
  align?: "left" | "center" | "right";
  fill?: string;
  // shape
  shape?: ShapeKind;
  fillColor?: string;
  fillType?: "solid" | "gradient";
  gradient?: { from: string; to: string; angle: number }; // linear, angle in deg
};

export type Tool =
  | "move"
  | "brush"
  | "eraser"
  | "text"
  | "rect"
  | "ellipse"
  | "eyedropper"
  | "crop"
  | "select"
  | "hand";

export type Doc = {
  width: number;
  height: number;
  bg: string; // canvas background (CSS color or "transparent")
  layers: Layer[];
};

export const BLEND_MODES: BlendMode[] = [
  "normal", "multiply", "screen", "overlay", "darken", "lighten",
  "color-dodge", "color-burn", "hard-light", "soft-light", "difference",
  "exclusion", "hue", "saturation", "color", "luminosity",
];
