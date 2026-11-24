<script lang="ts">
  import ImageEditorCropOverlay from "./ImageEditorCropOverlay.svelte";
  import {
    effectiveCanvasSize,
    renderDocumentToCanvas,
    stagePointToDocPoint,
  } from "./image-editor-render.ts";
  import {
    createId,
    hitTestLayer,
    type CropAspect,
    type CropRect,
    type DrawStroke,
    type EditorDocument,
    type EditorTool,
    type Point,
    type ShapeLayer,
    type ToolOptions,
    type ZoomMode,
  } from "./image-editor-state.ts";

  let {
    doc,
    imageMap,
    activeTool,
    selectedLayerId,
    zoomMode,
    cropRect = $bindable<CropRect>(),
    cropAspect,
    toolOptions,
    onSelectLayer,
    onCommitStroke,
    onMoveLayer,
    onCommitMove,
    onCommitShape,
    onPlaceTextAt,
    onApplyCrop,
    onCancelCrop,
  }: {
    doc: EditorDocument;
    imageMap: ReadonlyMap<string, HTMLImageElement>;
    activeTool: EditorTool;
    selectedLayerId: string | null;
    zoomMode: ZoomMode;
    cropRect: CropRect;
    cropAspect: CropAspect;
    toolOptions: ToolOptions;
    onSelectLayer: (id: string | null) => void;
    onCommitStroke: (stroke: DrawStroke) => void;
    onMoveLayer: (id: string, dx: number, dy: number) => void;
    onCommitMove: () => void;
    onCommitShape: (shape: ShapeLayer) => void;
    onPlaceTextAt: (pt: Point) => void;
    onApplyCrop: () => void;
    onCancelCrop: () => void;
  } = $props();

  let viewportEl = $state<HTMLDivElement | null>(null);
  let canvasEl = $state<HTMLCanvasElement | null>(null);
  let viewportW = $state(640);
  let viewportH = $state(480);

  let activeStroke = $state<DrawStroke | null>(null);
  let activeShape = $state<ShapeLayer | null>(null);
  let dragLayer = $state<{ id: string; lastPt: Point; moved: boolean } | null>(null);
  let shapeOrigin = $state<Point | null>(null);

  $effect(() => {
    const el = viewportEl;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) {
        viewportW = rect.width;
        viewportH = rect.height;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  });

  let effSize = $derived(effectiveCanvasSize(doc));
  let displayScale = $derived.by(() => {
    if (zoomMode === "50") return 0.5;
    if (zoomMode === "100") return 1;
    if (zoomMode === "200") return 2;
    const availW = Math.max(120, viewportW - 32);
    const availH = Math.max(120, viewportH - 32);
    return Math.min(1, availW / effSize.width, availH / effSize.height);
  });

  let displayW = $derived(Math.max(1, Math.round(effSize.width * displayScale)));
  let displayH = $derived(Math.max(1, Math.round(effSize.height * displayScale)));

  $effect(() => {
    if (!canvasEl) return;
    const drawLayerId = doc.layers.find((l) => l.id === selectedLayerId && l.kind === "drawing")?.id
      ?? [...doc.layers].reverse().find((l) => l.kind === "drawing")?.id
      ?? "";
    renderDocumentToCanvas(canvasEl, doc, {
      imageMap,
      selectedLayerId,
      showSelection: activeTool === "select",
      previewStroke: activeStroke ? { layerId: drawLayerId, stroke: activeStroke } : null,
      previewShape: activeShape,
    });
  });

  function pointerToDoc(event: PointerEvent): Point {
    const rect = canvasEl?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    const sx = ((event.clientX - rect.left) / rect.width) * effSize.width;
    const sy = ((event.clientY - rect.top) / rect.height) * effSize.height;
    return stagePointToDocPoint({ x: sx, y: sy }, doc.width, doc.height, doc.transform);
  }

  function handleCanvasDown(event: PointerEvent) {
    if (activeTool === "crop") return;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    const pt = pointerToDoc(event);

    if (activeTool === "select") {
      const hit = hitTestLayer(doc, pt);
      onSelectLayer(hit ? hit.id : null);
      if (hit) dragLayer = { id: hit.id, lastPt: pt, moved: false };
    } else if (activeTool === "brush" || activeTool === "eraser") {
      activeStroke = {
        id: createId("stroke"),
        mode: activeTool,
        color: toolOptions.brushColor,
        size: toolOptions.brushSize,
        opacity: toolOptions.brushOpacity / 100,
        points: [pt],
      };
    } else if (activeTool === "shape") {
      shapeOrigin = pt;
      activeShape = {
        id: createId("shape"),
        name: `Shape (${toolOptions.shapeKind})`,
        kind: "shape",
        visible: true,
        opacity: 1,
        shapeKind: toolOptions.shapeKind,
        x: pt.x,
        y: pt.y,
        width: 1,
        height: 1,
        strokeColor: toolOptions.shapeStrokeColor,
        fillColor: toolOptions.shapeFillColor,
        filled: toolOptions.shapeFilled,
        strokeWidth: toolOptions.shapeStrokeWidth,
      };
    } else if (activeTool === "text") {
      onPlaceTextAt(pt);
    }
  }

  function handleCanvasMove(event: PointerEvent) {
    const pt = pointerToDoc(event);
    if (dragLayer) {
      const dx = pt.x - dragLayer.lastPt.x;
      const dy = pt.y - dragLayer.lastPt.y;
      if (dx !== 0 || dy !== 0) {
        dragLayer = { id: dragLayer.id, lastPt: pt, moved: true };
        onMoveLayer(dragLayer.id, dx, dy);
      }
    } else if (activeStroke) {
      activeStroke = { ...activeStroke, points: [...activeStroke.points, pt] };
    } else if (activeShape && shapeOrigin) {
      activeShape = { ...activeShape, width: pt.x - shapeOrigin.x, height: pt.y - shapeOrigin.y };
    }
  }

  function handleCanvasUp() {
    if (dragLayer) {
      if (dragLayer.moved) onCommitMove();
      dragLayer = null;
    }
    if (activeStroke) {
      onCommitStroke(activeStroke);
      activeStroke = null;
    }
    if (activeShape) {
      if (Math.abs(activeShape.width) >= 4 || Math.abs(activeShape.height) >= 4) {
        onCommitShape(activeShape);
      }
      activeShape = null;
      shapeOrigin = null;
    }
  }
</script>

<div class="stage-viewport" bind:this={viewportEl} role="region" aria-label="Image canvas stage">
  <div class="canvas-shell" style="width: {displayW}px; height: {displayH}px;">
    <canvas
      bind:this={canvasEl}
      class="editor-canvas tool-{activeTool}"
      style="width: {displayW}px; height: {displayH}px;"
      onpointerdown={handleCanvasDown}
      onpointermove={handleCanvasMove}
      onpointerup={handleCanvasUp}
      onpointercancel={handleCanvasUp}
    ></canvas>

    {#if activeTool === "crop"}
      <ImageEditorCropOverlay
        docWidth={doc.width}
        docHeight={doc.height}
        {displayScale}
        {cropAspect}
        bind:cropRect
        onApply={onApplyCrop}
        onCancel={onCancelCrop}
      />
    {/if}
  </div>
</div>

<style>
  .stage-viewport {
    grid-area: stage; display: grid; place-items: center; overflow: auto;
    min-height: 22rem; padding: 1rem; border: 1px solid var(--border);
    border-radius: 0.5rem; background: var(--surface); position: relative;
  }
  .canvas-shell {
    position: relative; box-shadow: var(--shadow-pop); border: 1px solid var(--border);
    background-image:
      linear-gradient(45deg, color-mix(in srgb, var(--muted) 22%, transparent) 25%, transparent 25%),
      linear-gradient(-45deg, color-mix(in srgb, var(--muted) 22%, transparent) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, color-mix(in srgb, var(--muted) 22%, transparent) 75%),
      linear-gradient(-45deg, transparent 75%, color-mix(in srgb, var(--muted) 22%, transparent) 75%);
    background-size: 16px 16px;
    background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  }
  .editor-canvas { display: block; touch-action: none; }
  .tool-select { cursor: grab; }
  .tool-brush, .tool-eraser, .tool-shape { cursor: crosshair; }
  .tool-text { cursor: text; }
</style>
