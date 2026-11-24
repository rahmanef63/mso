<script lang="ts">
  import type { ImageGridItem } from "./media-format.ts";

  let {
    items, label, selectedKey, onSelect, onCopy, copyLabel,
  }: {
    items: readonly ImageGridItem[];
    label: string;
    selectedKey: string | null;
    onSelect: (item: ImageGridItem) => void;
    onCopy: (value: string, notice: string) => void;
    copyLabel: string;
  } = $props();
</script>

<div class="grid" role="group" aria-label={label}>
  {#each items as item (item.key)}
    <figure class="card" class:selected={selectedKey === item.key}>
      <button type="button" class="thumb" onclick={() => onSelect(item)} aria-label={`Preview ${item.name}`}>
        <img src={item.thumb} alt={item.name} loading="lazy" />
      </button>
      <figcaption>
        <span class="name">{item.name}</span>
        <span class="meta">{item.meta}</span>
        <button type="button" onclick={() => onCopy(item.key, copyLabel)}>{copyLabel}</button>
      </figcaption>
    </figure>
  {/each}
</div>

<style>
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr)); gap: 0.5rem; }
  .card { margin: 0; display: grid; border: 1px solid var(--border); border-radius: 0.5rem; overflow: hidden; background: var(--surface); }
  .card.selected { border-color: var(--accent); }
  .thumb { padding: 0; border: 0; background: none; display: block; cursor: pointer; }
  .thumb img { width: 100%; height: 6.5rem; object-fit: cover; display: block; }
  figcaption { display: grid; gap: 0.125rem; padding: 0.375rem 0.5rem 0.5rem; min-width: 0; }
  .name { font-size: 0.75rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { font-size: 0.6875rem; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  figcaption button { font-size: 0.6875rem; padding: 0.125rem 0.375rem; justify-self: start; }
  @media (max-width: 380px) {
    .grid { grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr)); }
  }
</style>
