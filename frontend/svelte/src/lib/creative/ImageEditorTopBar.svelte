<script lang="ts">
  import {
    CANVAS_PRESETS,
    clampNumber,
    type ZoomMode,
  } from "./image-editor-state.ts";

  let {
    pathInput = $bindable(""),
    docWidth,
    docHeight,
    rotateDeg,
    canUndo,
    canRedo,
    zoomMode,
    inspectorOpen,
    onLoadPath,
    onNewBlank,
    onUndo,
    onRedo,
    onZoomChange,
    onOpenExport,
    onToggleInspector,
  }: {
    pathInput: string;
    docWidth: number;
    docHeight: number;
    rotateDeg: number;
    canUndo: boolean;
    canRedo: boolean;
    zoomMode: ZoomMode;
    inspectorOpen: boolean;
    onLoadPath: (path: string) => void;
    onNewBlank: (width: number, height: number) => void;
    onUndo: () => void;
    onRedo: () => void;
    onZoomChange: (mode: ZoomMode) => void;
    onOpenExport: () => void;
    onToggleInspector: () => void;
  } = $props();

  let blankMenuOpen = $state(false);
  let customWidth = $state(1280);
  let customHeight = $state(720);

  function submitPath(event: SubmitEvent) {
    event.preventDefault();
    onLoadPath(pathInput);
  }

  function applyPreset(w: number, h: number) {
    onNewBlank(w, h);
    blankMenuOpen = false;
  }

  function applyCustom(event: SubmitEvent) {
    event.preventDefault();
    const w = Math.round(clampNumber(Number(customWidth), 64, 4096));
    const h = Math.round(clampNumber(Number(customHeight), 64, 4096));
    onNewBlank(w, h);
    blankMenuOpen = false;
  }

  const ZOOM_OPTIONS: readonly { mode: ZoomMode; label: string }[] = [
    { mode: "fit", label: "Fit" },
    { mode: "50", label: "50%" },
    { mode: "100", label: "100%" },
    { mode: "200", label: "200%" },
  ];
</script>

<div class="top-bar">
  <div class="top-row">
    <div class="title-group">
      <h2 id="image-editor-title">Image Editor</h2>
      <span class="role-badge">{docWidth}x{docHeight}</span>
      <span class="role-badge">{rotateDeg} deg</span>
    </div>

    <form class="path-form" onsubmit={submitPath}>
      <label class="sr-only" for="img-editor-path">Host image path</label>
      <input
        id="img-editor-path"
        type="text"
        bind:value={pathInput}
        placeholder="/path/to/photo.png"
        autocomplete="off"
      />
      <button type="submit" class="compact-btn">Open</button>
    </form>

    <div class="action-cluster">
      <button
        type="button"
        class="compact-btn"
        aria-expanded={blankMenuOpen}
        onclick={() => { blankMenuOpen = !blankMenuOpen; }}
      >
        New Canvas
      </button>

      <div class="seg-group" role="group" aria-label="History controls">
        <button type="button" class="compact-btn" disabled={!canUndo} onclick={onUndo} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button type="button" class="compact-btn" disabled={!canRedo} onclick={onRedo} title="Redo (Ctrl+Shift+Z)">
          Redo
        </button>
      </div>

      <div class="seg-group" role="group" aria-label="Zoom controls">
        {#each ZOOM_OPTIONS as opt (opt.mode)}
          <button
            type="button"
            class="compact-btn"
            class:primary={zoomMode === opt.mode}
            aria-pressed={zoomMode === opt.mode}
            onclick={() => onZoomChange(opt.mode)}
          >
            {opt.label}
          </button>
        {/each}
      </div>

      <button type="button" class="compact-btn primary" onclick={onOpenExport}>Export</button>
      <button
        type="button"
        class="compact-btn inspector-toggle"
        aria-pressed={inspectorOpen}
        onclick={onToggleInspector}
      >
        {inspectorOpen ? "Hide Panel" : "Inspector"}
      </button>
    </div>
  </div>

  {#if blankMenuOpen}
    <div class="blank-panel" role="region" aria-label="New blank canvas presets">
      <div class="preset-row">
        <span class="mini-label">Presets</span>
        {#each CANVAS_PRESETS as preset (preset.id)}
          <button type="button" class="compact-btn" onclick={() => applyPreset(preset.width, preset.height)}>
            {preset.label}
          </button>
        {/each}
      </div>
      <form class="custom-row" onsubmit={applyCustom}>
        <label class="mini-field">
          <span>W</span>
          <input type="number" min="64" max="4096" bind:value={customWidth} />
        </label>
        <label class="mini-field">
          <span>H</span>
          <input type="number" min="64" max="4096" bind:value={customHeight} />
        </label>
        <button type="submit" class="compact-btn primary">Create Custom</button>
      </form>
    </div>
  {/if}
</div>

<style>
  .top-bar { display: grid; gap: 0.5rem; padding-bottom: 0.625rem; border-bottom: 1px solid var(--border); }
  .top-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; justify-content: space-between; }
  .title-group { display: flex; align-items: center; gap: 0.375rem; flex-wrap: wrap; }
  .path-form { display: flex; align-items: center; gap: 0.375rem; flex: 1 1 13rem; max-width: 24rem; min-width: 10rem; }
  .path-form input { flex: 1 1 auto; min-width: 0; min-height: 2rem; padding: 0.25rem 0.5rem; font-size: 0.8125rem; font-family: var(--font-mono); }
  .action-cluster { display: flex; align-items: center; gap: 0.375rem; flex-wrap: wrap; }
  .seg-group { display: inline-flex; gap: 0.2rem; align-items: center; }
  .compact-btn { min-height: 2rem; padding: 0.25rem 0.55rem; font-size: 0.8125rem; border-radius: 0.4rem; }
  .inspector-toggle { display: none; }
  .blank-panel {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.625rem;
    padding: 0.5rem 0.625rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--surface);
  }
  .preset-row, .custom-row { display: flex; align-items: center; gap: 0.375rem; flex-wrap: wrap; }
  .mini-label { font-size: 0.75rem; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .mini-field { display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.75rem; color: var(--muted); }
  .mini-field input { width: 5.25rem; min-height: 2rem; padding: 0.2rem 0.4rem; font-size: 0.8125rem; }
  @media (max-width: 960px) {
    .inspector-toggle { display: inline-flex; }
  }
</style>
