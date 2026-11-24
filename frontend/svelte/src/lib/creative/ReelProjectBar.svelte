<script lang="ts">
  import {
    ASPECT_PRESETS,
    FPS_OPTIONS,
    type AspectRatioId,
    type ReelFps,
  } from "./reel-model.ts";

  type Props = {
    title: string;
    aspect: AspectRatioId;
    fps: ReelFps;
    canUndo: boolean;
    canRedo: boolean;
    onTitleChange: (title: string) => void;
    onAspectChange: (aspect: AspectRatioId) => void;
    onFpsChange: (fps: ReelFps) => void;
    onUndo: () => void;
    onRedo: () => void;
    onExportSnapshot: () => void;
    onExportJson: () => void;
  };

  let {
    title,
    aspect,
    fps,
    canUndo,
    canRedo,
    onTitleChange,
    onAspectChange,
    onFpsChange,
    onUndo,
    onRedo,
    onExportSnapshot,
    onExportJson,
  }: Props = $props();
</script>

<header class="project-bar">
  <div class="title-group">
    <h2 id="reel-editor-title" class="sr-only">Reel Editor</h2>
    <input
      type="text"
      class="title-input"
      aria-label="Project title"
      value={title}
      oninput={(e) => onTitleChange(e.currentTarget.value)}
    />
    <div class="ratio-group" role="group" aria-label="Aspect ratio">
      {#each ASPECT_PRESETS as preset (preset.id)}
        <button
          type="button"
          class:active-pill={aspect === preset.id}
          aria-pressed={aspect === preset.id}
          onclick={() => onAspectChange(preset.id)}
        >{preset.id}</button>
      {/each}
    </div>
    <label class="fps-wrap">
      <span class="sr-only">Frames per second</span>
      <select
        aria-label="FPS"
        value={fps}
        onchange={(e) => onFpsChange(Number(e.currentTarget.value) as ReelFps)}
      >
        {#each FPS_OPTIONS as rate (rate)}
          <option value={rate}>{rate} fps</option>
        {/each}
      </select>
    </label>
  </div>

  <div class="bar-actions">
    <button type="button" disabled={!canUndo} onclick={onUndo}>Undo</button>
    <button type="button" disabled={!canRedo} onclick={onRedo}>Redo</button>
    <button type="button" onclick={onExportSnapshot}>Snapshot PNG</button>
    <button type="button" class="primary" onclick={onExportJson}>Export JSON</button>
  </div>
</header>

<style>
  .project-bar { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
  .title-group, .bar-actions, .ratio-group { display: flex; align-items: center; gap: 0.375rem; flex-wrap: wrap; min-width: 0; }
  .title-input { width: min(14rem, 100%); font-weight: 600; }
  .active-pill { background: var(--accent); color: var(--accent-text); border-color: var(--accent); font-weight: 600; }
  .fps-wrap select { min-width: 5.5rem; }
</style>
