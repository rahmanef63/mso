<script lang="ts">
  import {
    CROP_ASPECTS,
    type CropAspect,
    type EditorTool,
    type ShapeKind,
    type ToolOptions,
  } from "./image-editor-state.ts";

  let {
    activeTool,
    flipH,
    flipV,
    cropAspect,
    toolOptions = $bindable<ToolOptions>(),
    onSelectTool,
    onRotate,
    onFlipH,
    onFlipV,
    onCropAspectChange,
    onApplyCrop,
    onCancelCrop,
    onAddText,
  }: {
    activeTool: EditorTool;
    flipH: boolean;
    flipV: boolean;
    cropAspect: CropAspect;
    toolOptions: ToolOptions;
    onSelectTool: (tool: EditorTool) => void;
    onRotate: () => void;
    onFlipH: () => void;
    onFlipV: () => void;
    onCropAspectChange: (aspect: CropAspect) => void;
    onApplyCrop: () => void;
    onCancelCrop: () => void;
    onAddText: () => void;
  } = $props();

  const TOOLS: readonly { id: EditorTool; label: string; key: string }[] = [
    { id: "select", label: "Select", key: "V" },
    { id: "crop", label: "Crop", key: "C" },
    { id: "brush", label: "Brush", key: "B" },
    { id: "eraser", label: "Eraser", key: "E" },
    { id: "text", label: "Text", key: "T" },
    { id: "shape", label: "Shape", key: "S" },
  ];

  const SHAPES: readonly { id: ShapeKind; label: string }[] = [
    { id: "rect", label: "Rect" },
    { id: "circle", label: "Circle" },
    { id: "line", label: "Line" },
    { id: "arrow", label: "Arrow" },
  ];
</script>

<aside class="tool-rail" aria-label="Editor tools">
  <div class="tool-group">
    {#each TOOLS as t (t.id)}
      <button
        type="button"
        class="rail-btn"
        class:primary={activeTool === t.id}
        aria-pressed={activeTool === t.id}
        title="{t.label} ({t.key})"
        onclick={() => onSelectTool(t.id)}
      >
        <span>{t.label}</span>
        <kbd>{t.key}</kbd>
      </button>
    {/each}
  </div>

  <div class="divider" role="separator"></div>

  <div class="tool-group">
    <button type="button" class="rail-btn" onclick={onRotate} title="Rotate 90 deg clockwise">Rotate 90</button>
    <button type="button" class="rail-btn" class:primary={flipH} aria-pressed={flipH} onclick={onFlipH}>Flip H</button>
    <button type="button" class="rail-btn" class:primary={flipV} aria-pressed={flipV} onclick={onFlipV}>Flip V</button>
  </div>
</aside>

<div class="tool-options" role="region" aria-label="Tool options">
  {#if activeTool === "select"}
    <span class="opt-hint">Drag text or shape overlays on the canvas to reposition.</span>
  {:else if activeTool === "crop"}
    <span class="opt-label">Aspect</span>
    {#each CROP_ASPECTS as item (item.id)}
      <button
        type="button"
        class="opt-btn"
        class:primary={cropAspect === item.id}
        aria-pressed={cropAspect === item.id}
        onclick={() => onCropAspectChange(item.id)}
      >
        {item.label}
      </button>
    {/each}
    <button type="button" class="opt-btn primary" onclick={onApplyCrop}>Apply Crop</button>
    <button type="button" class="opt-btn" onclick={onCancelCrop}>Cancel</button>
  {:else if activeTool === "brush" || activeTool === "eraser"}
    {#if activeTool === "brush"}
      <label class="opt-field">
        <span>Color</span>
        <input type="color" bind:value={toolOptions.brushColor} />
      </label>
    {/if}
    <label class="opt-field">
      <span>Size ({toolOptions.brushSize}px)</span>
      <input type="range" min="1" max="80" bind:value={toolOptions.brushSize} />
    </label>
    {#if activeTool === "brush"}
      <label class="opt-field">
        <span>Opacity ({toolOptions.brushOpacity}%)</span>
        <input type="range" min="10" max="100" bind:value={toolOptions.brushOpacity} />
      </label>
    {/if}
  {:else if activeTool === "text"}
    <label class="opt-field">
      <span>Text</span>
      <input type="text" class="text-input" bind:value={toolOptions.textContent} placeholder="Overlay text" />
    </label>
    <label class="opt-field">
      <span>Size ({toolOptions.textFontSize}px)</span>
      <input type="range" min="12" max="144" bind:value={toolOptions.textFontSize} />
    </label>
    <button
      type="button"
      class="opt-btn"
      class:primary={toolOptions.textFontWeight === "700"}
      aria-pressed={toolOptions.textFontWeight === "700"}
      onclick={() => { toolOptions.textFontWeight = toolOptions.textFontWeight === "700" ? "400" : "700"; }}
    >
      Bold
    </button>
    <label class="opt-field">
      <span>Color</span>
      <input type="color" bind:value={toolOptions.textColor} />
    </label>
    <button type="button" class="opt-btn primary" onclick={onAddText}>Add Text</button>
  {:else if activeTool === "shape"}
    <div class="shape-pills">
      {#each SHAPES as s (s.id)}
        <button
          type="button"
          class="opt-btn"
          class:primary={toolOptions.shapeKind === s.id}
          aria-pressed={toolOptions.shapeKind === s.id}
          onclick={() => { toolOptions.shapeKind = s.id; }}
        >
          {s.label}
        </button>
      {/each}
    </div>
    <label class="opt-field">
      <span>Stroke</span>
      <input type="color" bind:value={toolOptions.shapeStrokeColor} />
    </label>
    <label class="opt-field">
      <span>Width ({toolOptions.shapeStrokeWidth}px)</span>
      <input type="range" min="1" max="24" bind:value={toolOptions.shapeStrokeWidth} />
    </label>
    {#if toolOptions.shapeKind === "rect" || toolOptions.shapeKind === "circle"}
      <button
        type="button"
        class="opt-btn"
        class:primary={toolOptions.shapeFilled}
        aria-pressed={toolOptions.shapeFilled}
        onclick={() => { toolOptions.shapeFilled = !toolOptions.shapeFilled; }}
      >
        Fill
      </button>
      {#if toolOptions.shapeFilled}
        <label class="opt-field">
          <span>Fill</span>
          <input type="color" bind:value={toolOptions.shapeFillColor} />
        </label>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .tool-rail {
    grid-area: rail; display: flex; flex-direction: column; gap: 0.375rem; padding: 0.5rem;
    border: 1px solid var(--border); border-radius: 0.5rem; background: var(--surface); align-self: start;
  }
  .tool-group { display: flex; flex-direction: column; gap: 0.3rem; }
  .rail-btn {
    display: flex; align-items: center; justify-content: space-between; gap: 0.375rem;
    min-height: 2.1rem; padding: 0.3rem 0.5rem; font-size: 0.8125rem; text-align: left; white-space: nowrap;
  }
  .rail-btn kbd {
    font-family: var(--font-mono); font-size: 0.6875rem; opacity: 0.72;
    padding: 0.05rem 0.25rem; border: 1px solid currentColor; border-radius: 0.25rem;
  }
  .divider { height: 1px; background: var(--border); margin: 0.15rem 0; }
  .tool-options {
    grid-area: opts; display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem;
    padding: 0.45rem 0.625rem; border: 1px solid var(--border); border-radius: 0.5rem;
    background: var(--surface); min-height: 2.75rem;
  }
  .opt-label, .opt-hint { font-size: 0.8125rem; color: var(--muted); }
  .opt-field { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.8125rem; color: var(--text); }
  .opt-field input[type="range"] { width: 5.5rem; min-height: 1.5rem; padding: 0; border: 0; background: transparent; accent-color: var(--accent); }
  .opt-field input[type="color"] { width: 2rem; min-height: 1.85rem; padding: 0.1rem; cursor: pointer; }
  .text-input { width: 10rem; min-height: 2rem; padding: 0.2rem 0.45rem; font-size: 0.8125rem; }
  .opt-btn { min-height: 1.95rem; padding: 0.2rem 0.55rem; font-size: 0.8125rem; border-radius: 0.375rem; }
  .shape-pills { display: inline-flex; gap: 0.25rem; }
  @media (max-width: 760px) {
    .tool-rail { flex-direction: row; overflow-x: auto; align-items: center; }
    .tool-group { flex-direction: row; }
    .divider { width: 1px; height: 1.5rem; margin: 0 0.15rem; }
    .rail-btn kbd { display: none; }
  }
</style>
