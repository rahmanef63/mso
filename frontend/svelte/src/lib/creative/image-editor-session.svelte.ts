import type {
  CropAspect, CropRect, EditorDocument, EditorTool, ExportFormat, InspectorTab,
  ToolOptions, ZoomMode,
} from "./image-editor-types.ts";
import {
  createBlankDocument, createHistory, defaultToolOptions, type HistoryStack,
} from "./image-editor-state.ts";

export type EditorNotice = { tone: "ok" | "error" | "pending"; text: string };

// Shared mutable editor state. Runes live here so every UI binding reads one owner.
export class ImageEditorSession {
  doc = $state<EditorDocument>(createBlankDocument(1080, 1080));
  history = $state<HistoryStack>(createHistory(50));
  imageMap = $state<ReadonlyMap<string, HTMLImageElement>>(new Map());
  pathInput = $state("");
  activeTool = $state<EditorTool>("select");
  selectedLayerId = $state<string | null>(null);
  zoomMode = $state<ZoomMode>("fit");
  cropAspect = $state<CropAspect>("free");
  cropRect = $state<CropRect>({ x: 0, y: 0, width: 1080, height: 1080 });
  toolOptions = $state<ToolOptions>(defaultToolOptions());
  inspectorOpen = $state(true);
  inspectorTab = $state<InspectorTab>("adjustments");
  exportOpen = $state(false);
  savingVps = $state(false);
  notice = $state<EditorNotice | null>(null);
  preEdit = $state<EditorDocument | null>(null);

  get canUndo(): boolean { return this.history.past.length > 0; }
  get canRedo(): boolean { return this.history.future.length > 0; }
  get hasImage(): boolean { return this.doc.layers.some((layer) => layer.kind === "image"); }

  setNotice(tone: EditorNotice["tone"], text: string): void {
    this.notice = { tone, text };
  }

  toggleInspector(): void { this.inspectorOpen = !this.inspectorOpen; }
  openExport(): void { this.exportOpen = true; }
  closeExport(): void { this.exportOpen = false; }
  setZoom(mode: ZoomMode): void { this.zoomMode = mode; }
  selectLayer(id: string | null): void { this.selectedLayerId = id; }
  setCropRect(rect: CropRect): void { this.cropRect = rect; }
  setInspectorTab(tab: InspectorTab): void { this.inspectorTab = tab; }
  setToolOptions(options: ToolOptions): void { this.toolOptions = options; }
}

export type { ExportFormat };
