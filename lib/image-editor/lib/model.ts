import type {
  Adjustments,
  Doc,
  Layer,
  LayerKind,
  LayerStyle,
  Transform,
} from "./types";
import { assertImageCanvasBounds } from "./project-validation";

// ── Defaults ────────────────────────────────────────────────────────────────
export const ADJ_DEFAULT: Adjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  hue: 0,
  blur: 0,
  grayscale: false,
  invert: false,
  sepia: false,
};

const STYLE_DEFAULT: LayerStyle = {
  blend: "normal",
  shadow: { enabled: false, color: "#000000", opacity: 0.5, angle: 90, distance: 8, size: 10 },
  glow: { enabled: false, color: "#ffd54a", opacity: 0.75, size: 18 },
  stroke: { enabled: false, color: "#ffffff", width: 3 },
  clipBelow: false,
};

let seq = 0;
export const mkId = (p = "L") => `${p}${++seq}${Date.now().toString(36).slice(-3)}`;

const baseTransform = (over: Partial<Transform> = {}): Transform => ({
  x: 0, y: 0, width: 0, height: 0, rotation: 0, scaleX: 1, scaleY: 1, ...over,
});

// Deep-ish clone of the style/adj sub-objects so layers never share references.
const freshStyle = (): LayerStyle => ({
  blend: STYLE_DEFAULT.blend,
  shadow: { ...STYLE_DEFAULT.shadow },
  glow: { ...STYLE_DEFAULT.glow },
  stroke: { ...STYLE_DEFAULT.stroke },
  clipBelow: false,
});
const freshAdj = (): Adjustments => ({ ...ADJ_DEFAULT });

export function createLayer(kind: LayerKind, extra: Partial<Layer> = {}): Layer {
  const seed: Partial<Layer> =
    kind === "text"
      ? { name: "Text", text: "Double-click to edit", fontSize: 64, fontFamily: "Inter, sans-serif", fontStyle: "bold", align: "left", fill: "#ffffff" }
      : kind === "shape"
        ? { name: "Shape", shape: "rect", fillColor: "#3b82f6" }
        : kind === "paint"
          ? { name: "Paint" }
          : kind === "adjustment"
            ? { name: "Adjustment" }
            : { name: "Image" };
  const s = freshStyle();
  return {
    name: kind,
    kind,
    visible: true,
    locked: false,
    opacity: 1,
    ...seed,
    ...extra,
    // id + style/adj/t forced fresh AFTER the spreads so a duplicated layer
    // (which spreads the source) never shares an id or a nested object ref.
    id: mkId(),
    style: extra.style
      ? { ...s, ...extra.style, shadow: { ...s.shadow, ...extra.style.shadow }, glow: { ...s.glow, ...extra.style.glow }, stroke: { ...s.stroke, ...extra.style.stroke } }
      : s,
    adj: extra.adj ? { ...freshAdj(), ...extra.adj } : freshAdj(),
    t: baseTransform({ ...seed.t, ...extra.t }),
  };
}

// A blank document — one empty paint layer so the brush works immediately.
export function blankDoc(width = 1080, height = 1080): Doc {
  assertImageCanvasBounds(width, height);
  return {
    width,
    height,
    bg: "#ffffff",
    layers: [
      createLayer("paint", { name: "Background", t: baseTransform({ width, height }) }),
    ],
  };
}

export const ASPECT_PRESETS = [
  { label: "Square 1:1", w: 1080, h: 1080 },
  { label: "Portrait 4:5", w: 1080, h: 1350 },
  { label: "Story 9:16", w: 1080, h: 1920 },
  { label: "Landscape 16:9", w: 1920, h: 1080 },
  { label: "Wide 1.91:1", w: 1200, h: 628 },
];

export const FONT_FAMILIES = [
  "Inter, sans-serif",
  "Georgia, serif",
  "'Courier New', monospace",
  "Impact, sans-serif",
  "'Comic Sans MS', cursive",
];
