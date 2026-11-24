<script lang="ts">
  import { resolveRawMediaUrl } from "../media/media-api.ts";
  import type { StudioProjectAsset, StudioViewMode } from "./studio-model.ts";

  type Props = {
    allAssets: readonly StudioProjectAsset[];
    filteredAssets: readonly StudioProjectAsset[];
    selectedId: string | null;
    viewMode: StudioViewMode;
    onSelect: (id: string) => void;
    onReorder: (index: number, delta: number) => void;
    onRemove: (id: string) => void;
  };

  let {
    allAssets,
    filteredAssets,
    selectedId,
    viewMode,
    onSelect,
    onReorder,
    onRemove,
  }: Props = $props();

  function thumbUrlFor(asset: StudioProjectAsset): string | null {
    if (asset.kind !== "image") return null;
    try { return resolveRawMediaUrl(asset.path); } catch { return null; }
  }
</script>

<div class="bin-pane">
  <h3>Asset Bin ({filteredAssets.length})</h3>
  {#if filteredAssets.length === 0}
    <p class="empty-msg">
      {allAssets.length === 0
        ? "No assets yet. Add a host media path above or open Browse VPS."
        : "No assets match the current filter."}
    </p>
  {:else}
    <ul class="asset-collection mode-{viewMode}">
      {#each filteredAssets as asset (asset.id)}
        {@const idx = allAssets.findIndex((a) => a.id === asset.id)}
        {@const thumb = thumbUrlFor(asset)}
        <li class="asset-card" class:selected={selectedId === asset.id}>
          <button
            type="button"
            class="card-select"
            aria-current={selectedId === asset.id ? "true" : undefined}
            onclick={() => onSelect(asset.id)}
          >
            <div class="thumb-box">
              {#if thumb}
                <img src={thumb} alt={asset.label} loading="lazy" />
              {:else}
                <span class="kind-tag">{asset.kind.toUpperCase()}</span>
              {/if}
            </div>
            <div class="card-info">
              <span class="card-title">{idx + 1}. {asset.label}</span>
              <span class="card-sub">
                {asset.kind} | {asset.durationSec}s{asset.tags.length ? ` | #${asset.tags.join(" #")}` : ""}
              </span>
            </div>
          </button>
          <div class="card-actions">
            <button type="button" aria-label="Move {asset.label} up" disabled={idx <= 0} onclick={() => onReorder(idx, -1)}>Up</button>
            <button type="button" aria-label="Move {asset.label} down" disabled={idx >= allAssets.length - 1} onclick={() => onReorder(idx, 1)}>Down</button>
            <button type="button" class="danger" aria-label="Remove {asset.label}" onclick={() => onRemove(asset.id)}>x</button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .bin-pane { display: grid; gap: 0.65rem; align-content: start; padding: 0.875rem; border: 1px solid var(--border); border-radius: 0.625rem; background: var(--surface); min-width: 0; }
  .asset-collection { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
  .asset-collection.mode-grid { grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr)); }
  .asset-card { display: grid; gap: 0.4rem; padding: 0.5rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel-solid); }
  .asset-collection.mode-list .asset-card { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; }
  .asset-card.selected { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  .card-select { display: flex; align-items: center; gap: 0.5rem; flex: 1 1 10rem; min-width: 0; border: 0; background: transparent; padding: 0.15rem; text-align: left; }
  .asset-collection.mode-grid .card-select { flex-direction: column; align-items: stretch; }
  .thumb-box { width: 3.25rem; height: 2.75rem; flex-shrink: 0; display: grid; place-items: center; overflow: hidden; border-radius: 0.35rem; border: 1px solid var(--border); background: var(--surface); }
  .asset-collection.mode-grid .thumb-box { width: 100%; height: 6.5rem; }
  .thumb-box img { width: 100%; height: 100%; object-fit: cover; }
  .kind-tag { font-family: var(--font-mono); font-size: 0.7rem; font-weight: 700; color: var(--muted); }
  .card-info { display: grid; min-width: 0; }
  .card-title { font-size: 0.84rem; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card-sub { font-size: 0.75rem; color: var(--muted); overflow-wrap: anywhere; }
  .card-actions { display: flex; gap: 0.25rem; flex-wrap: wrap; }
  .card-actions button { min-height: 2rem; padding: 0.2rem 0.45rem; font-size: 0.76rem; }
  .empty-msg { margin: 0; font-size: 0.875rem; color: var(--muted); }
</style>
