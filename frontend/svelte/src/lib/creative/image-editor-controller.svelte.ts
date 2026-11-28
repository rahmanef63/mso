import { classifyMediaKind, resolveRawMediaUrl } from "../media/media-api.ts";
import { exportDocumentDataUrl, saveExportToVps, triggerImageDownload } from "./image-editor-export.ts";
import {
  addDrawingLayer, insertShapeLayer, insertTextLayer, moveLayerBy, patchAdjustment, removeLayer,
} from "./image-editor-layer-ops.ts";
import {
  appendStrokeToDocument, applyCropToDocument, applyFilterPreset, buildAspectCropRect,
  cloneDocument, createBlankDocument, createImageDocument, duplicateLayer, pushHistory,
  redoHistory, reorderLayer, rotateTransformRight, undoHistory,
  type CropAspect, type DrawStroke, type EditorDocument, type EditorTool, type ExportFormat,
  type ShapeLayer, type StudioAdjustments,
} from "./image-editor-state.ts";
import type { ImageEditorSession } from "./image-editor-session.svelte.ts";
import { handleEditorKey } from "./image-editor-keys.ts";
function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image failed to decode."));
    img.src = url;
  });
}

export function createImageEditorActions(s: ImageEditorSession) {
  function commit(next: EditorDocument) {
    s.preEdit = null; // a discrete action discards a half-open slider edit, else undo restores it
    s.history = pushHistory(s.history, s.doc);
    s.doc = next;
  }

  function beginEdit() {
    if (!s.preEdit) s.preEdit = cloneDocument(s.doc);
  }

  function endEdit() {
    if (!s.preEdit) return;
    s.history = pushHistory(s.history, s.preEdit);
    s.preEdit = null;
  }

  async function openPath(rawPath: string) {
    const trimmed = rawPath.trim();
    if (!trimmed) { s.setNotice("error", "Enter an image file path to open."); return; }
    if (classifyMediaKind(trimmed) !== "image") { s.setNotice("error", "That path is not a supported image file."); return; }
    let url = "";
    try { url = resolveRawMediaUrl(trimmed); } catch { s.setNotice("error", "Could not resolve that host path."); return; }
    s.setNotice("pending", "Loading image from host...");
    try {
      const img = await loadHtmlImage(url);
      s.imageMap = new Map(s.imageMap).set(url, img);
      const next = createImageDocument(url, img.naturalWidth, img.naturalHeight, fileName(trimmed));
      commit(next);
      s.pathInput = trimmed;
      s.selectedLayerId = next.layers[0]?.id ?? null;
      s.cropRect = buildAspectCropRect(next.width, next.height, s.cropAspect);
      s.setNotice("ok", `Opened ${fileName(trimmed)} (${next.width}x${next.height}).`);
    } catch {
      s.setNotice("error", "Could not load image from host path.");
    }
  }

  return {
    openPath,
    newBlank(width: number, height: number) {
      const next = createBlankDocument(width, height);
      commit(next);
      s.selectedLayerId = next.layers[0]?.id ?? null;
      s.cropRect = buildAspectCropRect(next.width, next.height, s.cropAspect);
      s.setNotice("ok", `Created blank canvas ${next.width}x${next.height}.`);
    },

    undo() {
      const res = undoHistory(s.history, s.doc);
      s.history = res.history;
      s.doc = res.doc;
      s.preEdit = null;
    },

    redo() {
      const res = redoHistory(s.history, s.doc);
      s.history = res.history;
      s.doc = res.doc;
      s.preEdit = null;
    },

    rotateRight() { commit({ ...s.doc, transform: rotateTransformRight(s.doc.transform) }); },
    flipH() { commit({ ...s.doc, transform: { ...s.doc.transform, flipH: !s.doc.transform.flipH } }); },
    flipV() { commit({ ...s.doc, transform: { ...s.doc.transform, flipV: !s.doc.transform.flipV } }); },

    selectTool(tool: EditorTool) {
      s.activeTool = tool;
      if (tool === "crop") s.cropRect = buildAspectCropRect(s.doc.width, s.doc.height, s.cropAspect);
    },

    changeCropAspect(aspect: CropAspect) {
      s.cropAspect = aspect;
      s.cropRect = buildAspectCropRect(s.doc.width, s.doc.height, aspect);
    },

    applyCrop() {
      commit(applyCropToDocument(s.doc, s.cropRect));
      s.activeTool = "select";
      s.cropRect = buildAspectCropRect(s.doc.width, s.doc.height, s.cropAspect);
      s.setNotice("ok", "Crop applied to every layer.");
    },

    cancelCrop() {
      s.activeTool = "select";
      s.cropRect = buildAspectCropRect(s.doc.width, s.doc.height, s.cropAspect);
    },

    commitStroke(stroke: DrawStroke) {
      const res = appendStrokeToDocument(s.doc, s.selectedLayerId, stroke);
      commit(res.doc);
      s.selectedLayerId = res.layerId;
    },

    commitShape(shape: ShapeLayer) {
      const res = insertShapeLayer(s.doc, shape);
      commit(res.doc);
      s.selectedLayerId = res.layerId;
    },

    placeTextAt(pt: { x: number; y: number }) {
      const res = insertTextLayer(s.doc, pt, {
        text: s.toolOptions.textContent,
        fontSize: s.toolOptions.textFontSize,
        fontWeight: s.toolOptions.textFontWeight,
        color: s.toolOptions.textColor,
      });
      commit(res.doc);
      s.selectedLayerId = res.layerId;
    },

    placeTextCenter() {
      this.placeTextAt({ x: s.doc.width / 2 - 80, y: s.doc.height / 2 - 24 });
    },

    beginMove(id: string) { beginEdit(); s.selectedLayerId = id; },
    commitMove(moved = true) { if (moved) endEdit(); else s.preEdit = null; },
    moveLayer(id: string, dx: number, dy: number) { s.doc = moveLayerBy(s.doc, id, dx, dy); },

    patchAdj(key: keyof StudioAdjustments, value: number) {
      beginEdit();
      s.doc = { ...patchAdjustment(s.doc, key, value), activeFilter: "custom" };
    },

    commitAdj() { endEdit(); },

    resetAdjustments() {
      commit(applyFilterPreset(s.doc, "original"));
      s.setNotice("ok", "Reset all adjustments.");
    },

    applyPreset(id: string) { commit(applyFilterPreset(s.doc, id)); },

    toggleVisibility(id: string) {
      commit({ ...s.doc, layers: s.doc.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)) });
    },

    changeOpacity(id: string, opacity: number) {
      beginEdit();
      s.doc = { ...s.doc, layers: s.doc.layers.map((l) => (l.id === id ? { ...l, opacity } : l)) };
    },

    moveUp(id: string) { commit({ ...s.doc, layers: reorderLayer(s.doc.layers, id, 1) }); },
    moveDown(id: string) { commit({ ...s.doc, layers: reorderLayer(s.doc.layers, id, -1) }); },

    duplicate(id: string) {
      const res = duplicateLayer(s.doc.layers, id);
      if (!res.newId) return;
      commit({ ...s.doc, layers: res.layers });
      s.selectedLayerId = res.newId;
    },

    deleteLayer(id: string) {
      commit(removeLayer(s.doc, id));
      if (s.selectedLayerId === id) s.selectedLayerId = s.doc.layers[0]?.id ?? null;
    },

    addLayer() {
      const res = addDrawingLayer(s.doc);
      commit(res.doc);
      s.selectedLayerId = res.layerId;
    },

    downloadExport(format: ExportFormat, quality: number) {
      try {
        triggerImageDownload(exportDocumentDataUrl(s.doc, s.imageMap, format, quality), format);
        s.setNotice("ok", `Downloaded ${format.toUpperCase()} image.`);
      } catch {
        s.setNotice("error", "Canvas export failed in this browser.");
      }
    },

    async saveVps(path: string, format: ExportFormat, quality: number) {
      s.savingVps = true;
      try {
        await saveExportToVps(path, exportDocumentDataUrl(s.doc, s.imageMap, format, quality), new AbortController().signal);
        s.setNotice("ok", `Saved export to ${path.trim()}.`);
        s.exportOpen = false;
      } catch (err) {
        s.setNotice("error", err instanceof Error ? err.message : "Saving to the VPS failed.");
      } finally {
        s.savingVps = false;
      }
    },

    handleKey(event: KeyboardEvent) {
      handleEditorKey(event, this);
    },
  };
}

export type ImageEditorActions = ReturnType<typeof createImageEditorActions>;
