<script lang="ts">
  import {
    clampNumber,
    FILTER_PRESETS,
    type StudioAdjustments,
  } from "./image-editor-state.ts";

  type AdjSliderDef = {
    key: keyof StudioAdjustments;
    label: string;
    min: number;
    max: number;
    step: number;
    unit: string;
  };

  let {
    mode,
    adjustments,
    activeFilter,
    onPatchAdjustment,
    onCommitAdjustment,
    onResetAdjustments,
    onApplyPreset,
  }: {
    mode: "adjustments" | "filters";
    adjustments: StudioAdjustments;
    activeFilter: string;
    onPatchAdjustment: (key: keyof StudioAdjustments, value: number) => void;
    onCommitAdjustment: () => void;
    onResetAdjustments: () => void;
    onApplyPreset: (presetId: string) => void;
  } = $props();

  const SLIDERS: readonly AdjSliderDef[] = [
    { key: "brightness", label: "Brightness", min: 0, max: 200, step: 1, unit: "%" },
    { key: "contrast", label: "Contrast", min: 0, max: 200, step: 1, unit: "%" },
    { key: "saturation", label: "Saturation", min: 0, max: 200, step: 1, unit: "%" },
    { key: "exposure", label: "Exposure", min: -100, max: 100, step: 1, unit: "" },
    { key: "hueRotate", label: "Hue Rotate", min: -180, max: 180, step: 1, unit: " deg" },
    { key: "sepia", label: "Sepia", min: 0, max: 100, step: 1, unit: "%" },
    { key: "grayscale", label: "Grayscale", min: 0, max: 100, step: 1, unit: "%" },
    { key: "blur", label: "Blur", min: 0, max: 20, step: 0.5, unit: "px" },
    { key: "vignette", label: "Vignette", min: 0, max: 100, step: 1, unit: "%" },
  ];
</script>

{#if mode === "adjustments"}
  <div class="adj-panel">
    <div class="panel-head">
      <h3>Tone & Color</h3>
      <button type="button" class="mini-btn" onclick={onResetAdjustments}>Reset All</button>
    </div>

    <div class="slider-list">
      {#each SLIDERS as s (s.key)}
        <div class="slider-row">
          <div class="slider-meta">
            <label for="adj-{s.key}">{s.label}</label>
            <span class="val">{adjustments[s.key]}{s.unit}</span>
          </div>
          <input
            id="adj-{s.key}"
            type="range"
            min={s.min}
            max={s.max}
            step={s.step}
            value={adjustments[s.key]}
            oninput={(e) => onPatchAdjustment(s.key, clampNumber(Number(e.currentTarget.value), s.min, s.max))}
            onchange={onCommitAdjustment}
          />
        </div>
      {/each}
    </div>
  </div>
{:else}
  <div class="filters-panel">
    <div class="panel-head">
      <h3>Filter Presets</h3>
      <span class="active-tag">{activeFilter}</span>
    </div>

    <div class="preset-grid">
      {#each FILTER_PRESETS as preset (preset.id)}
        <button
          type="button"
          class="preset-card"
          class:primary={activeFilter === preset.id}
          aria-pressed={activeFilter === preset.id}
          onclick={() => onApplyPreset(preset.id)}
        >
          <span class="preset-name">{preset.label}</span>
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .adj-panel, .filters-panel { display: grid; gap: 0.65rem; }
  .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
  .mini-btn { min-height: 1.8rem; padding: 0.2rem 0.55rem; font-size: 0.75rem; }
  .active-tag { font-size: 0.75rem; color: var(--muted); text-transform: capitalize; }
  .slider-list { display: grid; gap: 0.55rem; }
  .slider-row { display: grid; gap: 0.2rem; }
  .slider-meta { display: flex; justify-content: space-between; align-items: center; font-size: 0.8125rem; }
  .slider-meta label { font-weight: 500; color: var(--text); }
  .val { font-size: 0.75rem; font-family: var(--font-mono); color: var(--muted); font-variant-numeric: tabular-nums; }
  .slider-row input[type="range"] { width: 100%; min-height: 1.5rem; padding: 0; border: 0; background: transparent; accent-color: var(--accent); }
  .preset-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.45rem; }
  .preset-card { min-height: 2.5rem; padding: 0.45rem 0.5rem; font-size: 0.8125rem; text-align: center; }
  .preset-name { font-weight: 600; }
</style>
