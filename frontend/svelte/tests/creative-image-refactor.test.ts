import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  appendStrokeToDocument,
  applyCropToDocument,
  applyFilterPreset,
  buildAspectCropRect,
  buildStudioFilter,
  CANVAS_PRESETS,
  clampCropRect,
  createBlankDocument,
  createHistory,
  createImageDocument,
  defaultStudioAdjustments,
  defaultToolOptions,
  duplicateLayer,
  FILTER_PRESETS,
  hitTestLayer,
  pushHistory,
  redoHistory,
  reorderLayer,
  rotateTransformRight,
  undoHistory,
} from "../src/lib/creative/image-editor-state.ts";
import { effectiveCanvasSize, stagePointToDocPoint } from "../src/lib/creative/image-editor-render.ts";
import { exportFormatExtension, exportFormatMime, saveExportToVps } from "../src/lib/creative/image-editor-export.ts";

test("createBlankDocument, CANVAS_PRESETS, and defaultToolOptions provide bounded starter state", () => {
  assert.equal(CANVAS_PRESETS.length, 3);
  const sq = createBlankDocument(1080, 1080);
  assert.equal(sq.width, 1080);
  assert.equal(sq.height, 1080);
  assert.equal(sq.layers.length, 1);
  assert.equal(sq.layers[0]?.kind, "drawing");

  const clamped = createBlankDocument(10, 99999);
  assert.equal(clamped.width, 64);
  assert.equal(clamped.height, 4096);

  const opts = defaultToolOptions();
  assert.equal(opts.shapeKind, "rect");
  assert.equal(opts.brushOpacity, 100);
});

test("createImageDocument initializes base image layer underneath drawing layer", () => {
  const doc = createImageDocument("/api/v1/fs/raw?path=%2Fphoto.png", 1600, 900, "photo.png");
  assert.equal(doc.width, 1600);
  assert.equal(doc.height, 900);
  assert.equal(doc.layers.length, 2);
  assert.equal(doc.layers[0]?.kind, "image");
  assert.equal(doc.layers[1]?.kind, "drawing");
});

test("buildStudioFilter builds full 9-adjustment CSS filter string and FILTER_PRESETS apply cleanly", () => {
  const neutral = defaultStudioAdjustments();
  assert.equal(buildStudioFilter(neutral), "brightness(100%) contrast(100%) saturate(100%)");

  const styled = buildStudioFilter({
    ...neutral,
    brightness: 110,
    contrast: 120,
    saturation: 90,
    exposure: 50,
    hueRotate: -15,
    sepia: 25,
    grayscale: 10,
    blur: 2.5,
    vignette: 40,
  });
  assert.match(styled, /brightness\(156%\)/);
  assert.match(styled, /contrast\(120%\)/);
  assert.match(styled, /saturate\(90%\)/);
  assert.match(styled, /hue-rotate\(-15deg\)/);
  assert.match(styled, /sepia\(25%\)/);
  assert.match(styled, /grayscale\(10%\)/);
  assert.match(styled, /blur\(2\.5px\)/);

  assert.equal(FILTER_PRESETS.length, 8);
  const doc = createBlankDocument(800, 600);
  const noir = applyFilterPreset(doc, "noir");
  assert.equal(noir.activeFilter, "noir");
  assert.equal(noir.adjustments.grayscale, 100);
  assert.equal(noir.adjustments.vignette, 35);
});

test("undo and redo history stack restores snapshots, branches on new edit, and respects limit", () => {
  let doc = createBlankDocument(800, 600);
  let hist = createHistory(3);

  hist = pushHistory(hist, doc);
  doc = applyFilterPreset(doc, "vivid");
  hist = pushHistory(hist, doc);
  doc = applyFilterPreset(doc, "noir");

  assert.equal(hist.past.length, 2);
  const step1 = undoHistory(hist, doc);
  assert.equal(step1.doc.activeFilter, "vivid");
  assert.equal(step1.history.future.length, 1);

  const step2 = undoHistory(step1.history, step1.doc);
  assert.equal(step2.doc.activeFilter, "original");
  assert.equal(step2.history.past.length, 0);

  const redone = redoHistory(step2.history, step2.doc);
  assert.equal(redone.doc.activeFilter, "vivid");

  let capped = pushHistory(redone.history, redone.doc);
  assert.equal(capped.future.length, 0);
  capped = pushHistory(capped, doc);
  capped = pushHistory(capped, doc);
  capped = pushHistory(capped, doc);
  assert.equal(capped.past.length, 3);
});

test("layer reorder, duplicate, stroke append, and hitTestLayer manage multi-layer overlays", () => {
  const base = createImageDocument("img.png", 1000, 800);
  const strokeRes = appendStrokeToDocument(base, null, {
    id: "st-1",
    mode: "brush",
    color: "#ef4444",
    size: 6,
    opacity: 0.8,
    points: [{ x: 20, y: 20 }, { x: 40, y: 40 }],
  });
  assert.equal(strokeRes.doc.layers[1]?.kind, "drawing");
  if (strokeRes.doc.layers[1]?.kind === "drawing") {
    assert.equal(strokeRes.doc.layers[1].strokes.length, 1);
  }

  const textLayer = {
    id: "txt-1",
    name: "Title",
    kind: "text" as const,
    visible: true,
    opacity: 1,
    text: "Hello",
    x: 100,
    y: 120,
    fontSize: 40,
    fontWeight: "700" as const,
    color: "#ffffff",
  };
  const shapeLayer = {
    id: "shp-1",
    name: "Box",
    kind: "shape" as const,
    visible: true,
    opacity: 1,
    shapeKind: "rect" as const,
    x: 300,
    y: 300,
    width: 150,
    height: 100,
    strokeColor: "#000000",
    fillColor: "#3b82f6",
    filled: true,
    strokeWidth: 4,
  };
  const doc = { ...strokeRes.doc, layers: [...strokeRes.doc.layers, textLayer, shapeLayer] };

  assert.equal(hitTestLayer(doc, { x: 130, y: 140 })?.id, "txt-1");
  assert.equal(hitTestLayer(doc, { x: 350, y: 350 })?.id, "shp-1");
  assert.equal(hitTestLayer(doc, { x: 10, y: 10 }), null);

  const reordered = reorderLayer(doc.layers, "shp-1", -1);
  assert.equal(reordered[2]?.id, "shp-1");
  assert.equal(reordered[3]?.id, "txt-1");

  const duped = duplicateLayer(doc.layers, "txt-1");
  assert.equal(duped.layers.length, 5);
  assert.ok(duped.newId);
  const copy = duped.layers.find((l) => l.id === duped.newId);
  assert.equal(copy?.kind, "text");
  if (copy?.kind === "text") {
    assert.equal(copy.x, 120);
    assert.equal(copy.y, 140);
  }
});

test("crop aspect ratios, clamping, and applyCropToDocument shift coordinates across all layer kinds", () => {
  const sqCrop = buildAspectCropRect(1920, 1080, "1:1");
  assert.deepEqual(sqCrop, { x: 420, y: 0, width: 1080, height: 1080 });

  const clamped = clampCropRect({ x: -20, y: 900, width: 500, height: 500 }, 1000, 1000);
  assert.deepEqual(clamped, { x: 0, y: 500, width: 500, height: 500 });

  const base = createImageDocument("img.png", 1000, 800);
  const doc = {
    ...base,
    layers: [
      base.layers[0]!,
      {
        id: "d1",
        name: "Draw",
        kind: "drawing" as const,
        visible: true,
        opacity: 1,
        strokes: [{ id: "s1", mode: "brush" as const, color: "#f00", size: 4, opacity: 1, points: [{ x: 250, y: 200 }] }],
      },
      {
        id: "t1",
        name: "Caption",
        kind: "text" as const,
        visible: true,
        opacity: 1,
        text: "Hi",
        x: 300,
        y: 250,
        fontSize: 32,
        fontWeight: "700" as const,
        color: "#fff",
      },
    ],
  };

  const cropped = applyCropToDocument(doc, { x: 100, y: 50, width: 500, height: 400 });
  assert.equal(cropped.width, 500);
  assert.equal(cropped.height, 400);
  assert.equal(cropped.layers[0]?.kind === "image" ? cropped.layers[0].x : null, -100);
  assert.equal(cropped.layers[1]?.kind === "drawing" ? cropped.layers[1].strokes[0]?.points[0]?.x : null, 150);
  assert.equal(cropped.layers[2]?.kind === "text" ? cropped.layers[2].y : null, 200);
});

test("transform rotation, inverse stage-to-doc mapping, and VPS export helper work accurately", async () => {
  const doc = createBlankDocument(800, 400);
  const rotated = { ...doc, transform: rotateTransformRight(doc.transform) };
  assert.equal(rotated.transform.rotateDeg, 90);
  assert.deepEqual(effectiveCanvasSize(rotated), { width: 400, height: 800 });

  const center = stagePointToDocPoint({ x: 200, y: 400 }, 800, 400, rotated.transform);
  assert.equal(Math.round(center.x), 400);
  assert.equal(Math.round(center.y), 200);

  assert.equal(exportFormatMime("webp"), "image/webp");
  assert.equal(exportFormatExtension("jpeg"), "jpg");

  let capturedUrl = "";
  let capturedBody = "";
  const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  await saveExportToVps(
    "~/Pictures/out.png.dataurl",
    "data:image/png;base64,AAAA",
    new AbortController().signal,
    mockFetch,
    { surface: "web", apiBaseOrigin: null },
  );
  assert.equal(capturedUrl, "/api/v1/fs/write");
  assert.deepEqual(JSON.parse(capturedBody), {
    path: "~/Pictures/out.png.dataurl",
    content: "data:image/png;base64,AAAA",
  });
});

test("Image Editor Svelte files comply with hard repo gates and modular <250 line budget", () => {
  const creativeDir = path.resolve(import.meta.dirname, "../src/lib/creative");
  const files = [
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
  for (const file of files) {
    const content = readFileSync(path.join(creativeDir, file), "utf8");
    const lines = content.split("\n");
    assert.ok(lines.length < 250, `${file} must stay under 250 lines (got ${lines.length})`);
    assert.equal(content.includes("{@html"), false, `${file} must not use {@html}`);
    assert.equal(/\bwindow\.(confirm|alert|prompt)\s*\(/.test(content), false, `${file} must not call window.confirm/alert/prompt`);
    assert.equal(/\b(localStorage|sessionStorage)\./.test(content), false, `${file} must not use localStorage/sessionStorage`);
    assert.equal(content.includes("\u2014"), false, `${file} must not contain em dashes`);
    assert.equal(lines.some((line) => line.length > 400), false, `${file} must not contain lines > 400 chars`);
  }
  const appSrc = readFileSync(path.join(creativeDir, "ImageEditorApp.svelte"), "utf8");
  assert.ok(appSrc.includes("initialPath"), "ImageEditorApp must preserve initialPath prop");
  assert.ok(appSrc.includes("data-image-loaded"), "ImageEditorApp must preserve data-image-loaded attribute");
});
