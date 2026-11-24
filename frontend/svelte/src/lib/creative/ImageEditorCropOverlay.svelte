<script lang="ts">
  import {
    clampCropRect,
    CROP_ASPECTS,
    type CropAspect,
    type CropRect,
  } from "./image-editor-state.ts";

  type CropHandle = "move" | "nw" | "ne" | "sw" | "se";

  let {
    docWidth,
    docHeight,
    displayScale,
    cropAspect,
    cropRect = $bindable<CropRect>(),
    onApply,
    onCancel,
  }: {
    docWidth: number;
    docHeight: number;
    displayScale: number;
    cropAspect: CropAspect;
    cropRect: CropRect;
    onApply: () => void;
    onCancel: () => void;
  } = $props();

  let cropDrag = $state<{ handle: CropHandle; startX: number; startY: number; startRect: CropRect } | null>(null);

  function startCropDrag(handle: CropHandle, event: PointerEvent) {
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    cropDrag = { handle, startX: event.clientX, startY: event.clientY, startRect: { ...cropRect } };
  }

  function moveCropDrag(event: PointerEvent) {
    if (!cropDrag) return;
    const dx = (event.clientX - cropDrag.startX) / displayScale;
    const dy = (event.clientY - cropDrag.startY) / displayScale;
    let { x, y, width, height } = cropDrag.startRect;
    const ratio = CROP_ASPECTS.find((a) => a.id === cropAspect)?.ratio ?? null;

    if (cropDrag.handle === "move") {
      x += dx;
      y += dy;
    } else {
      if (cropDrag.handle === "nw" || cropDrag.handle === "sw") { x += dx; width -= dx; }
      if (cropDrag.handle === "ne" || cropDrag.handle === "se") { width += dx; }
      if (cropDrag.handle === "nw" || cropDrag.handle === "ne") { y += dy; height -= dy; }
      if (cropDrag.handle === "sw" || cropDrag.handle === "se") { height += dy; }
      if (ratio !== null) height = width / ratio;
    }
    cropRect = clampCropRect({ x, y, width, height }, docWidth, docHeight);
  }
</script>

<div
  class="crop-layer"
  role="application"
  aria-label="Crop selection overlay"
  onpointermove={moveCropDrag}
  onpointerup={() => { cropDrag = null; }}
>
  <div
    class="crop-box"
    role="group"
    aria-label="Crop region"
    style="left: {cropRect.x * displayScale}px; top: {cropRect.y * displayScale}px; width: {cropRect.width * displayScale}px; height: {cropRect.height * displayScale}px;"
    onpointerdown={(e) => startCropDrag("move", e)}
  >
    <button type="button" class="handle nw" aria-label="Resize top left" onpointerdown={(e) => startCropDrag("nw", e)}></button>
    <button type="button" class="handle ne" aria-label="Resize top right" onpointerdown={(e) => startCropDrag("ne", e)}></button>
    <button type="button" class="handle sw" aria-label="Resize bottom left" onpointerdown={(e) => startCropDrag("sw", e)}></button>
    <button type="button" class="handle se" aria-label="Resize bottom right" onpointerdown={(e) => startCropDrag("se", e)}></button>
  </div>
  <div class="crop-hud">
    <span>{Math.round(cropRect.width)}x{Math.round(cropRect.height)}</span>
    <button type="button" class="hud-btn primary" onclick={onApply}>Apply</button>
    <button type="button" class="hud-btn" onclick={onCancel}>Cancel</button>
  </div>
</div>

<style>
  .crop-layer { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.32); }
  .crop-box {
    position: absolute; border: 2px dashed var(--accent); background: rgba(59, 130, 246, 0.08);
    cursor: move; box-sizing: border-box;
  }
  .handle {
    position: absolute; width: 0.85rem; height: 0.85rem; min-height: 0; padding: 0; border-radius: 0.15rem;
    background: var(--accent); border: 1.5px solid var(--accent-text);
  }
  .nw { left: -0.425rem; top: -0.425rem; cursor: nwse-resize; }
  .ne { right: -0.425rem; top: -0.425rem; cursor: nesw-resize; }
  .sw { left: -0.425rem; bottom: -0.425rem; cursor: nesw-resize; }
  .se { right: -0.425rem; bottom: -0.425rem; cursor: nwse-resize; }
  .crop-hud {
    position: absolute; top: 0.5rem; left: 50%; transform: translateX(-50%);
    display: flex; align-items: center; gap: 0.375rem; padding: 0.25rem 0.5rem;
    border-radius: 0.45rem; border: 1px solid var(--border); background: var(--panel-solid);
    font-size: 0.75rem; font-variant-numeric: tabular-nums; box-shadow: var(--shadow-pop);
  }
  .hud-btn { min-height: 1.65rem; padding: 0.15rem 0.45rem; font-size: 0.75rem; }
</style>
