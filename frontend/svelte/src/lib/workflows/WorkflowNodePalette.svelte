<script lang="ts">
  import { WORKFLOW_PALETTE_ITEMS } from "./workflow-palette.ts";
  import type { WorkflowNodeCategory, WorkflowPaletteItem } from "./workflow-types.ts";

  type Props = {
    onAddNode: (item: WorkflowPaletteItem) => void;
  };
  let { onAddNode }: Props = $props();

  let paletteQuery = $state("");
  let paletteCat = $state<"All" | WorkflowNodeCategory>("All");
  const categories: readonly ("All" | WorkflowNodeCategory)[] = ["All", "Triggers", "Actions", "AI", "Flow"];

  let filteredPalette = $derived.by(() => {
    const q = paletteQuery.trim().toLowerCase();
    return WORKFLOW_PALETTE_ITEMS.filter((item) => {
      if (paletteCat !== "All" && item.category !== paletteCat) return false;
      if (!q) return true;
      return `${item.title} ${item.badge} ${item.category} ${item.description}`.toLowerCase().includes(q);
    });
  });
</script>

<div class="wf-pal-wrap">
  <label class="sr-only" for="wf-palette-search">Search node types</label>
  <input id="wf-palette-search" type="search" bind:value={paletteQuery} placeholder="Search node types..." />
  <div class="wf-chip-row">
    {#each categories as cat (cat)}
      <button type="button" class="wf-chip" class:primary={paletteCat === cat} onclick={() => { paletteCat = cat; }}>
        {cat}
      </button>
    {/each}
  </div>
  <div class="wf-palette-list">
    {#each filteredPalette as item (item.id)}
      <button type="button" class="wf-palette-item" onclick={() => onAddNode(item)}>
        <span class="wf-palette-top">
          <strong>{item.title}</strong>
          <span class="wf-badge">{item.badge}</span>
        </span>
        <span class="wf-palette-desc">{item.description}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .wf-pal-wrap { display: grid; gap: 0.5rem; min-width: 0; max-height: 30rem; overflow-y: auto; }
  .wf-pal-wrap input { min-height: 2.1rem; font-size: 0.82rem; width: 100%; min-width: 0; }
  .wf-chip-row { display: flex; gap: 0.25rem; flex-wrap: wrap; }
  .wf-chip { min-height: 1.85rem; padding: 0.2rem 0.5rem; font-size: 0.75rem; }
  .wf-palette-list { display: grid; gap: 0.4rem; }
  .wf-palette-item { display: grid; gap: 0.15rem; text-align: left; padding: 0.45rem 0.55rem; min-height: 0; }
  .wf-palette-top { display: flex; justify-content: space-between; align-items: center; gap: 0.4rem; }
  .wf-palette-top strong { font-size: 0.8rem; color: var(--text); }
  .wf-palette-desc { font-size: 0.73rem; color: var(--muted); }
  .wf-badge { padding: 0.1rem 0.45rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.7rem; color: var(--muted); }
</style>
