<script lang="ts">
  import { searchStockImages, type StockImageItem } from "../media/media-api.ts";
  import {
    BUILTIN_SAMPLE_CLIPS,
    type ClipFilterPreset,
    type ClipTransition,
  } from "./reel-model.ts";

  type Props = {
    onAddClip: (input: {
      title: string;
      path?: string;
      durationSec: number;
      caption?: string;
      filter?: ClipFilterPreset;
      transition?: ClipTransition;
      externalUrl?: string;
      backdropColor?: string;
    }) => void;
  };

  let { onAddClip }: Props = $props();

  let titleInput = $state("");
  let pathInput = $state("");
  let durationInput = $state("5");
  let captionInput = $state("");
  let stockQuery = $state("");
  let stockLoading = $state(false);
  let stockError = $state<string | null>(null);
  let stockItems = $state<StockImageItem[]>([]);
  let stockAbort: AbortController | null = null;

  function submitManualClip(event: SubmitEvent) {
    event.preventDefault();
    if (!titleInput.trim() && !pathInput.trim()) return;
    onAddClip({
      title: titleInput,
      path: pathInput,
      durationSec: Number(durationInput) || 5,
      caption: captionInput,
    });
    titleInput = "";
    pathInput = "";
    durationInput = "5";
    captionInput = "";
  }

  async function runStockSearch(event: SubmitEvent) {
    event.preventDefault();
    const q = stockQuery.trim();
    if (!q) return;
    stockAbort?.abort();
    stockAbort = new AbortController();
    stockLoading = true;
    stockError = null;
    try {
      const res = await searchStockImages(q, 1, stockAbort.signal);
      stockItems = res.results.slice(0, 6);
      if (stockItems.length === 0) stockError = "No stock images matched this query.";
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        stockError = err instanceof Error ? err.message : "Stock search failed.";
      }
    } finally {
      stockLoading = false;
    }
  }
</script>

<div class="panel-body">
  <form class="asset-form" onsubmit={submitManualClip}>
    <div class="grid-2">
      <div class="field">
        <label for="bin-title">Clip title</label>
        <input id="bin-title" type="text" bind:value={titleInput} placeholder="B-roll shot" />
      </div>
      <div class="field">
        <label for="bin-dur">Seconds (1-60)</label>
        <input id="bin-dur" type="number" min="1" max="60" bind:value={durationInput} />
      </div>
    </div>
    <div class="field">
      <label for="bin-path">VPS media path (optional)</label>
      <input id="bin-path" type="text" bind:value={pathInput} placeholder="/path/to/shot.mp4 or ~/cover.png" />
    </div>
    <div class="field">
      <label for="bin-cap">Caption (optional)</label>
      <input id="bin-cap" type="text" bind:value={captionInput} placeholder="On-screen caption" />
    </div>
    <button type="submit" class="primary">Add clip to timeline</button>
  </form>

  <div class="sub-block">
    <h4>Built-in samples</h4>
    <div class="chip-row">
      {#each BUILTIN_SAMPLE_CLIPS as sample (sample.title)}
        <button type="button" onclick={() => onAddClip(sample)}>+ {sample.title} ({sample.durationSec}s)</button>
      {/each}
    </div>
  </div>

  <div class="sub-block">
    <h4>Stock lookup</h4>
    <form class="inline-form" onsubmit={runStockSearch}>
      <input type="text" bind:value={stockQuery} placeholder="Search stock imagery" aria-label="Search stock imagery" />
      <button type="submit" disabled={stockLoading}>{stockLoading ? "..." : "Find"}</button>
    </form>
    {#if stockError}
      <p class="feedback error">{stockError}</p>
    {/if}
    {#if stockItems.length > 0}
      <div class="stock-grid">
        {#each stockItems as item (item.id)}
          <button
            type="button"
            class="stock-card"
            onclick={() => onAddClip({ title: item.title || "Stock clip", durationSec: 4, externalUrl: item.url })}
          >
            <img src={item.thumb} alt={item.title || "Stock media"} />
            <span>{item.title || "Add clip"}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .panel-body, .asset-form, .sub-block { display: grid; gap: 0.6rem; min-width: 0; }
  .sub-block { padding-top: 0.5rem; border-top: 1px solid var(--border); }
  h4 { margin: 0; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
  .grid-2 { display: grid; gap: 0.5rem; grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr)); }
  .inline-form { display: flex; gap: 0.4rem; }
  .inline-form input { flex: 1 1 auto; min-width: 0; }
  .chip-row { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .stock-grid { display: grid; gap: 0.4rem; grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr)); }
  .stock-card { display: grid; gap: 0.25rem; padding: 0.25rem; text-align: left; }
  .stock-card img { width: 100%; height: 3.75rem; object-fit: cover; border-radius: 0.25rem; }
  .stock-card span { font-size: 0.7rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
