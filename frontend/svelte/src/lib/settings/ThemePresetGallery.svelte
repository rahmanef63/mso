<script lang="ts">
  import {
    groupThemePresets,
    themePresetSwatches,
    THEME_PRESETS,
  } from "./theme-presets.ts";

  let {
    activePreset = null,
    disabled = false,
    onSelect,
  }: {
    activePreset?: string | null;
    disabled?: boolean;
    onSelect: (presetName: string | null) => void;
  } = $props();

  let filterText = $state("");
  let groups = $derived(groupThemePresets(filterText));
</script>

<div class="preset-gallery" data-theme-presets-count={THEME_PRESETS.length}>
  <div class="preset-toolbar">
    <div class="field preset-search">
      <label class="sr-only" for="settings-preset-search">Filter theme presets</label>
      <input
        id="settings-preset-search"
        type="search"
        bind:value={filterText}
        placeholder="Filter {THEME_PRESETS.length} presets..."
      />
    </div>
    <button
      type="button"
      disabled={disabled || !activePreset}
      onclick={() => onSelect(null)}
    >
      Reset to Stock
    </button>
  </div>

  {#if groups.length === 0}
    <p class="preset-empty">No presets match "{filterText}".</p>
  {:else}
    <div class="preset-groups">
      {#each groups as group (group.id)}
        <div class="preset-group">
          <p class="preset-group-label">{group.label}</p>
          <div class="preset-grid">
            {#each group.items as preset (preset.name)}
              {@const selected = activePreset === preset.name}
              <button
                type="button"
                class="preset-chip"
                class:active={selected}
                aria-pressed={selected}
                {disabled}
                data-preset-name={preset.name}
                onclick={() => onSelect(preset.name)}
              >
                <span class="swatch-row" aria-hidden="true">
                  {#each themePresetSwatches(preset) as color, idx (idx)}
                    <span class="swatch-dot" style:background={color}></span>
                  {/each}
                </span>
                <span class="preset-title">{preset.title}</span>
              </button>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .preset-gallery { display: grid; gap: 0.75rem; min-width: 0; }
  .preset-toolbar { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .preset-search { flex: 1 1 11rem; min-width: 0; }
  .preset-search input { width: 100%; }
  .preset-empty { margin: 0; font-size: 0.875rem; color: var(--muted); }
  .preset-groups { display: grid; gap: 0.875rem; }
  .preset-group { display: grid; gap: 0.45rem; }
  .preset-group-label {
    margin: 0;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .preset-grid {
    display: grid;
    gap: 0.5rem;
    grid-template-columns: repeat(auto-fill, minmax(min(10.5rem, 100%), 1fr));
  }
  .preset-chip {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.4rem;
    min-height: 3.25rem;
    padding: 0.5rem 0.625rem;
    border: 1px solid var(--border);
    border-radius: 0.625rem;
    background: var(--surface);
    color: var(--text);
    text-align: left;
  }
  .preset-chip.active {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, var(--panel-solid));
  }
  .swatch-row { display: inline-flex; align-items: center; gap: 0.25rem; }
  .swatch-dot {
    width: 0.875rem;
    height: 0.875rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    flex-shrink: 0;
  }
  .preset-title { font-size: 0.8125rem; font-weight: 600; color: var(--text); overflow-wrap: anywhere; }
</style>
