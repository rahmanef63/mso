export type EditorTool = "select" | "crop" | "brush" | "eraser" | "text" | "shape";
export type ShapeKind = "rect" | "circle" | "line" | "arrow";
export type CropAspect = "free" | "1:1" | "16:9" | "4:3" | "9:16";
export type InspectorTab = "adjustments" | "filters" | "layers";
export type ZoomMode = "fit" | "50" | "100" | "200";
export type ExportFormat = "png" | "jpeg" | "webp";
export type Point = { x: number; y: number };

export type StudioAdjustments = {
  brightness: number;
  contrast: number;
  saturation: number;
  exposure: number;
  hueRotate: number;
  sepia: number;
  grayscale: number;
  blur: number;
  vignette: number;
};

export type DocTransform = {
  rotateDeg: number;
  flipH: boolean;
  flipV: boolean;
};

export type DrawStroke = {
  id: string;
  mode: "brush" | "eraser";
  color: string;
  size: number;
  opacity: number;
  points: Point[];
};

export type BaseLayer = {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
};

export type ImageLayer = BaseLayer & {
  kind: "image";
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DrawingLayer = BaseLayer & {
  kind: "drawing";
  strokes: DrawStroke[];
};

export type TextLayer = BaseLayer & {
  kind: "text";
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fontWeight: "400" | "700";
  color: string;
};

export type ShapeLayer = BaseLayer & {
  kind: "shape";
  shapeKind: ShapeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor: string;
  fillColor: string;
  filled: boolean;
  strokeWidth: number;
};

export type EditorLayer = ImageLayer | DrawingLayer | TextLayer | ShapeLayer;
export type CropRect = { x: number; y: number; width: number; height: number };

export type ToolOptions = {
  brushColor: string;
  brushSize: number;
  brushOpacity: number;
  textContent: string;
  textFontSize: number;
  textFontWeight: "400" | "700";
  textColor: string;
  shapeKind: ShapeKind;
  shapeStrokeColor: string;
  shapeFillColor: string;
  shapeFilled: boolean;
  shapeStrokeWidth: number;
};

export type EditorDocument = {
  width: number;
  height: number;
  background: string;
  adjustments: StudioAdjustments;
  activeFilter: string;
  transform: DocTransform;
  layers: EditorLayer[];
};

export type HistoryStack = {
  past: EditorDocument[];
  future: EditorDocument[];
  limit: number;
};

export type CanvasPreset = { id: string; label: string; width: number; height: number };
export type FilterPreset = { id: string; label: string; adjustments: Partial<StudioAdjustments> };

export const CANVAS_PRESETS: readonly CanvasPreset[] = [
  { id: "square", label: "1080x1080", width: 1080, height: 1080 },
  { id: "landscape", label: "1920x1080", width: 1920, height: 1080 },
  { id: "portrait", label: "1080x1920", width: 1080, height: 1920 },
];

export const CROP_ASPECTS: readonly { id: CropAspect; label: string; ratio: number | null }[] = [
  { id: "free", label: "Free", ratio: null },
  { id: "1:1", label: "1:1", ratio: 1 },
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "4:3", label: "4:3", ratio: 4 / 3 },
  { id: "9:16", label: "9:16", ratio: 9 / 16 },
];

export const FILTER_PRESETS: readonly FilterPreset[] = [
  { id: "original", label: "Original", adjustments: {} },
  { id: "vivid", label: "Vivid", adjustments: { brightness: 105, contrast: 118, saturation: 138, exposure: 5 } },
  { id: "matte", label: "Matte", adjustments: { brightness: 106, contrast: 86, saturation: 88, exposure: 4, sepia: 8, vignette: 15 } },
  { id: "warm", label: "Warm", adjustments: { brightness: 104, contrast: 105, saturation: 115, hueRotate: -8, sepia: 22, vignette: 12 } },
  { id: "cool", label: "Cool", adjustments: { brightness: 100, contrast: 108, saturation: 95, hueRotate: 14, vignette: 10 } },
  { id: "noir", label: "Noir", adjustments: { brightness: 98, contrast: 135, saturation: 0, grayscale: 100, vignette: 35 } },
  { id: "fade", label: "Fade", adjustments: { brightness: 110, contrast: 82, saturation: 78, sepia: 12, vignette: 8 } },
  { id: "cinematic", label: "Cinematic", adjustments: { brightness: 96, contrast: 122, saturation: 92, exposure: -4, hueRotate: -6, sepia: 14, vignette: 32 } },
];

export function defaultToolOptions(): ToolOptions {
  return {
    brushColor: "#ef4444",
    brushSize: 8,
    brushOpacity: 100,
    textContent: "Headline",
    textFontSize: 48,
    textFontWeight: "700",
    textColor: "#ffffff",
    shapeKind: "rect",
    shapeStrokeColor: "#3b82f6",
    shapeFillColor: "#3b82f6",
    shapeFilled: false,
    shapeStrokeWidth: 4,
  };
}
