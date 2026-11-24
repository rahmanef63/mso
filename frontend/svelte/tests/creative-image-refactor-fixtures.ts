// Fixtures for creative-image-refactor.test.ts. Kept beside the test so the
// test file stays inside the repository's 220-line physical line ratchet.
import { createImageDocument, defaultStudioAdjustments } from "../src/lib/creative/image-editor-state.ts";
import type { EditorDocument, ShapeLayer, TextLayer } from "../src/lib/creative/image-editor-types.ts";

export const textLayer: TextLayer = {
  id: "txt-1",
  name: "Title",
  kind: "text",
  visible: true,
  opacity: 1,
  text: "Hello",
  x: 100,
  y: 120,
  fontSize: 40,
  fontWeight: "700",
  color: "#ffffff",
};

export const shapeLayer: ShapeLayer = {
  id: "shp-1",
  name: "Box",
  kind: "shape",
  visible: true,
  opacity: 1,
  shapeKind: "rect",
  x: 300,
  y: 300,
  width: 150,
  height: 100,
  strokeColor: "#000000",
  fillColor: "#3b82f6",
  filled: true,
  strokeWidth: 4,
};

export const styledAdjustments = {
  ...defaultStudioAdjustments(),
  brightness: 110,
  contrast: 120,
  saturation: 90,
  exposure: 50,
  hueRotate: -15,
  sepia: 25,
  grayscale: 10,
  blur: 2.5,
  vignette: 40,
};

export const imageEditorFiles = [
  "ImageEditorApp.svelte",
  "ImageEditorTopBar.svelte",
  "ImageEditorToolbar.svelte",
  "ImageEditorStage.svelte",
  "ImageEditorCropOverlay.svelte",
  "ImageEditorInspector.svelte",
  "ImageEditorAdjustments.svelte",
  "ImageEditorLayers.svelte",
  "ImageEditorExportModal.svelte",
  "image-editor-types.ts",
  "image-editor-state.ts",
  "image-editor-render.ts",
  "image-editor-export.ts",
];

export function cropFixtureDoc(): EditorDocument {
  const base = createImageDocument("img.png", 1000, 800);
  return {
    ...base,
    layers: [
      base.layers[0]!,
      {
        id: "d1",
        name: "Draw",
        kind: "drawing",
        visible: true,
        opacity: 1,
        strokes: [{ id: "s1", mode: "brush", color: "#f00", size: 4, opacity: 1, points: [{ x: 250, y: 200 }] }],
      },
      {
        id: "t1",
        name: "Caption",
        kind: "text",
        visible: true,
        opacity: 1,
        text: "Hi",
        x: 300,
        y: 250,
        fontSize: 32,
        fontWeight: "700",
        color: "#fff",
      },
    ],
  };
}
