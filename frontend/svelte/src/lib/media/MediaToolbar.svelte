<script lang="ts">
  import { ZOOM_STEP } from "./media-format.ts";

  let {
    zoom, rotation, mediaKind, hasSiblings, canReset, inspectorOpen,
    onZoomOut, onZoomIn, onFit, onReset, onRotate, onPrev, onNext, onToggleInspector,
  }: {
    zoom: number;
    rotation: number;
    mediaKind: string;
    hasSiblings: boolean;
    canReset: boolean;
    inspectorOpen: boolean;
    onZoomOut: () => void;
    onZoomIn: () => void;
    onFit: () => void;
    onReset: () => void;
    onRotate: () => void;
    onPrev: () => void;
    onNext: () => void;
    onToggleInspector: () => void;
  } = $props();
</script>

<div class="mv-toolbar" role="toolbar" aria-label="Viewer controls">
  <button type="button" disabled={!canReset} onclick={onZoomOut} aria-label={`Zoom out by ${ZOOM_STEP * 100} percent`}>Zoom out</button>
  <span class="mv-zoom">{Math.round(zoom * 100)}%</span>
  <button type="button" disabled={!canReset} onclick={onZoomIn} aria-label={`Zoom in by ${ZOOM_STEP * 100} percent`}>Zoom in</button>
  <button type="button" disabled={!canReset} onclick={onFit} aria-pressed={zoom === 1}>Fit</button>
  <button type="button" disabled={!canReset && rotation === 0} onclick={onReset}>Reset</button>
  <button type="button" disabled={mediaKind !== "image"} onclick={onRotate} aria-label={`Rotate preview, currently ${rotation} degrees`}>Rotate</button>
  <button type="button" disabled={!hasSiblings} onclick={onPrev}>Previous</button>
  <button type="button" disabled={!hasSiblings} onclick={onNext}>Next</button>
  <button type="button" aria-pressed={inspectorOpen} onclick={onToggleInspector}>Metadata</button>
</div>

<style>
  .mv-toolbar { display: flex; align-items: center; gap: 0.375rem; flex-wrap: wrap; }
  .mv-toolbar button { font-size: 0.8125rem; padding: 0.25rem 0.5rem; }
  .mv-zoom { font-family: var(--font-mono); font-size: 0.75rem; color: var(--muted); min-width: 2.5rem; text-align: center; }
  @media (max-width: 400px) {
    .mv-toolbar button { flex: 1 1 calc(50% - 0.375rem); }
    .mv-zoom { flex: 1 0 100%; text-align: left; }
  }
</style>
