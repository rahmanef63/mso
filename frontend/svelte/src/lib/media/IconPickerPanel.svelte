<script lang="ts">
  import { filterIcons, type IconDefinition } from "./media-api.ts";
  import { ICON_CATEGORIES, iconPath, iconSvgMarkup } from "./icon-catalog.ts";

  let { onNotice = () => {} }: { onNotice?: (message: string) => void } = $props();

  let query = $state("");
  let category = $state<string>("all");
  let selectedId = $state<string>("home");
  let size = $state(32);
  let color = $state("#1f6df0");

  let matched = $derived<IconDefinition[]>(
    filterIcons(query).filter((icon) => category === "all" || icon.category === category),
  );
  let selected = $derived<IconDefinition | null>(
    matched.find((icon) => icon.id === selectedId) ?? filterIcons(query)[0] ?? null,
  );

  async function copy(value: string, label: string) {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        onNotice(`Copied ${label}.`);
        return;
      }
    } catch {
      // Clipboard permission can be denied; fall through to the inline notice.
    }
    onNotice(`${label} is available below to copy manually: ${value}`);
  }
</script>

<div class="icon-picker" data-icon-count={matched.length}>
  <div class="picker-toolbar">
    <div class="field picker-search">
      <label for="icon-search">Search icons</label>
      <input id="icon-search" type="search" bind:value={query} placeholder="Name, ID, or category" />
    </div>
    <div class="preview-controls">
      <label class="field size-field">
        <span>Size</span>
        <input type="range" min="16" max="96" step="8" bind:value={size} aria-label="Preview size" />
      </label>
      <label class="field color-field">
        <span>Color</span>
        <input type="color" bind:value={color} aria-label="Preview color" />
      </label>
      <span class="size-readout">{size}px</span>
    </div>
  </div>

  <div class="cat-row" role="tablist" aria-label="Icon categories">
    {#each ICON_CATEGORIES as option (option)}
      <button
        type="button"
        role="tab"
        aria-selected={category === option}
        class:active={category === option}
        onclick={() => { category = option; }}
      >
        {option}
      </button>
    {/each}
  </div>

  {#if selected}
    <div class="icon-preview-card">
      <div class="glyph-box" style={`color:${color};`}>
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
          stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d={iconPath(selected.id)}></path>
        </svg>
      </div>
      <div class="glyph-meta">
        <strong>{selected.label}</strong>
        <code>{selected.id}</code>
        <span class="muted">{selected.category}</span>
      </div>
      <div class="glyph-actions">
        <button type="button" onclick={() => void copy(selected.id, "Icon name")}>Copy Name</button>
        <button type="button" onclick={() => void copy(iconSvgMarkup(selected.id, size, color), "SVG markup")}>Copy SVG</button>
      </div>
    </div>
  {/if}

  {#if matched.length === 0}
    <p class="feedback pending" role="status">No icons match the current search and category.</p>
  {:else}
    <div class="icon-grid" role="group" aria-label="Icon catalog">
      {#each matched as icon (icon.id)}
        <button
          type="button"
          class="icon-tile"
          class:selected={selected?.id === icon.id}
          aria-pressed={selected?.id === icon.id}
          title={`${icon.label} (${icon.id})`}
          onclick={() => { selectedId = icon.id; }}
        >
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"
            stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d={iconPath(icon.id)}></path>
          </svg>
          <span class="tile-label">{icon.label}</span>
          <code class="tile-id">{icon.id}</code>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .icon-picker { display: grid; gap: 0.75rem; min-width: 0; }
  .picker-toolbar { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: flex-end; }
  .picker-search { flex: 1 1 14rem; }
  .preview-controls { display: flex; align-items: center; gap: 0.625rem; flex-wrap: wrap; }
  .size-field, .color-field { display: flex; align-items: center; gap: 0.375rem; font-size: 0.75rem; color: var(--muted); }
  .size-field input { width: 6rem; accent-color: var(--accent); }
  .color-field input { width: 2.25rem; height: 1.75rem; padding: 0; border: 1px solid var(--border); background: none; }
  .size-readout { font-family: var(--font-mono); font-size: 0.75rem; color: var(--muted); }
  .cat-row { display: flex; gap: 0.375rem; overflow-x: auto; padding-bottom: 0.25rem; }
  .cat-row button { font-size: 0.75rem; padding: 0.25rem 0.5rem; white-space: nowrap; text-transform: capitalize; }
  .cat-row button.active { border-color: var(--accent); color: var(--accent); }
  .icon-preview-card {
    display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;
    padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel);
  }
  .glyph-box { display: grid; place-items: center; width: 4rem; height: 4rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--surface); }
  .glyph-meta { display: grid; gap: 0.125rem; min-width: 0; flex: 1 1 8rem; }
  .glyph-meta code { font-size: 0.75rem; color: var(--muted); }
  .muted { font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
  .glyph-actions { display: flex; gap: 0.375rem; flex-wrap: wrap; }
  .icon-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr)); gap: 0.375rem; }
  .icon-tile {
    display: grid; gap: 0.125rem; justify-items: center; padding: 0.5rem 0.25rem;
    background: var(--surface); color: var(--text); text-align: center;
  }
  .icon-tile.selected { border-color: var(--accent); background: var(--panel); color: var(--accent); }
  .tile-label { font-size: 0.6875rem; }
  .tile-id { font-size: 0.625rem; color: var(--muted); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @media (max-width: 380px) {
    .icon-grid { grid-template-columns: repeat(auto-fill, minmax(4.25rem, 1fr)); }
    .tile-label { display: none; }
  }
</style>
