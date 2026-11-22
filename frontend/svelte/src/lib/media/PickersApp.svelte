<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    ApiError,
    filterIcons,
    searchStockImages,
    type IconDefinition,
    type StockImageItem,
  } from "./media-api.ts";

  type PickerTab = "icons" | "images";
  type ImageSearchState =
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ready"; items: StockImageItem[]; page: number; query: string }
    | { kind: "error"; message: string };

  let activeTab = $state<PickerTab>("icons");
  let iconQuery = $state("");
  let selectedIconId = $state<string | null>(null);
  let statusNotice = $state<string | null>(null);

  let imageQuery = $state("");
  let view = $state<ImageSearchState>({ kind: "idle" });
  let activeSearch: AbortController | undefined;

  let visibleIcons = $derived<IconDefinition[]>(filterIcons(iconQuery));

  async function copyText(value: string, label: string) {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        statusNotice = `Copied ${label}: ${value}`;
        return;
      }
    } catch {
      // Clipboard write may be unavailable in restricted contexts.
    }
    statusNotice = `Selected ${label}: ${value}`;
  }

  function selectIcon(icon: IconDefinition) {
    selectedIconId = icon.id;
    void copyText(icon.id, "icon ID");
  }

  async function runImageSearch(query: string, page: number) {
    const trimmed = query.trim();
    if (!trimmed) {
      view = { kind: "error", message: "Enter a search query to browse stock images." };
      return;
    }
    activeSearch?.abort();
    const ctrl = (activeSearch = new AbortController());
    view = { kind: "loading" };
    statusNotice = null;
    try {
      const data = await searchStockImages(trimmed, page, ctrl.signal);
      if (!ctrl.signal.aborted) {
        view = { kind: "ready", items: data.results, page, query: trimmed };
      }
    } catch (error) {
      if (!ctrl.signal.aborted) {
        view = {
          kind: "error",
          message: error instanceof ApiError ? error.message : "Could not search stock images. Retry when ready.",
        };
      }
    }
  }

  function submitImages(event: SubmitEvent) {
    event.preventDefault();
    void runImageSearch(imageQuery, 1);
  }

  onDestroy(() => {
    activeSearch?.abort();
  });
</script>

<section aria-labelledby="pickers-title" data-picker-tab={activeTab}>
  <header class="feature-header">
    <h2 id="pickers-title">Pickers</h2>
    <div class="picker-tabs" role="tablist" aria-label="Picker categories">
      <button type="button" role="tab" aria-selected={activeTab === "icons"} class:primary={activeTab === "icons"} onclick={() => { activeTab = "icons"; }}>
        Icon Picker
      </button>
      <button type="button" role="tab" aria-selected={activeTab === "images"} class:primary={activeTab === "images"} onclick={() => { activeTab = "images"; }}>
        Image Picker
      </button>
    </div>
  </header>

  {#if statusNotice}
    <p class="feedback ok" role="status" aria-live="polite">{statusNotice}</p>
  {/if}

  {#if activeTab === "icons"}
    <div class="field picker-search">
      <label for="icon-filter">Filter icons ({visibleIcons.length})</label>
      <input id="icon-filter" type="search" bind:value={iconQuery} placeholder="Name, ID, or category (e.g. system, media)" />
    </div>

    {#if visibleIcons.length === 0}
      <p>No icons match "{iconQuery.trim()}".</p>
    {:else}
      <div class="icon-grid" role="list" aria-label="Icon catalog">
        {#each visibleIcons as icon (icon.id)}
          <button
            type="button"
            class="icon-tile"
            class:selected={selectedIconId === icon.id}
            aria-pressed={selectedIconId === icon.id}
            onclick={() => selectIcon(icon)}
          >
            <span class="icon-glyph" aria-hidden="true">{icon.glyph}</span>
            <strong>{icon.label}</strong>
            <code>{icon.id}</code>
          </button>
        {/each}
      </div>
    {/if}
  {:else}
    <form class="image-form" onsubmit={submitImages}>
      <div class="field image-input">
        <label for="stock-image-query">Search stock images</label>
        <input id="stock-image-query" type="search" bind:value={imageQuery} placeholder="Workspace, architecture, abstract texture" />
      </div>
      <button type="submit" class="primary" disabled={view.kind === "loading"}>
        {view.kind === "loading" ? "Searching..." : "Search"}
      </button>
    </form>

    <div role="status" aria-live="polite">
      {#if view.kind === "idle"}
        <p>Search Openverse or Unsplash stock photos and copy a safe image URL.</p>
      {:else if view.kind === "loading"}
        <p>Searching stock images...</p>
      {:else if view.kind === "error"}
        <p class="feedback error" role="alert">{view.message}</p>
      {:else if view.items.length === 0}
        <p>No stock images found for "{view.query}".</p>
      {:else}
        {@const readyQuery = view.query}
        {@const readyPage = view.page}
        <div class="image-grid" aria-label="Stock image results">
          {#each view.items as item (item.id)}
            <article class="image-card">
              <img src={item.thumb} alt={item.title || "Stock photo"} loading="lazy" />
              <div class="image-meta">
                <strong class="image-title">{item.title || "Untitled photo"}</strong>
                <span class="image-attr">
                  {item.creator || "Unknown creator"}{#if item.license} ({item.license}){/if}
                </span>
                <button type="button" onclick={() => void copyText(item.url, "image URL")}>Copy URL</button>
              </div>
            </article>
          {/each}
        </div>
        <div class="actions picker-pager">
          <button type="button" disabled={readyPage <= 1} onclick={() => void runImageSearch(readyQuery, readyPage - 1)}>
            Previous
          </button>
          <span>Page {readyPage}</span>
          <button type="button" onclick={() => void runImageSearch(readyQuery, readyPage + 1)}>
            Next
          </button>
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  .picker-tabs { display: inline-flex; gap: 0.375rem; flex-wrap: wrap; }
  .picker-search { margin: 1rem 0; }
  .icon-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr)); gap: 0.5rem; }
  .icon-tile {
    display: grid; gap: 0.2rem; justify-items: center; padding: 0.625rem 0.5rem;
    text-align: center; background: var(--surface);
  }
  .icon-tile.selected { border-color: var(--accent); background: var(--panel); }
  .icon-glyph { font-size: 1.25rem; line-height: 1.2; color: var(--text); }
  .icon-tile strong { font-size: 0.8125rem; }
  .icon-tile code { font-size: 0.75rem; color: var(--muted); }
  .image-form { display: flex; align-items: flex-end; gap: 0.625rem; flex-wrap: wrap; margin: 1rem 0; }
  .image-input { flex: 1 1 16rem; }
  .image-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr)); gap: 0.75rem; }
  .image-card { border: 1px solid var(--border); border-radius: 0.5rem; overflow: hidden; background: var(--surface); display: grid; }
  .image-card img { width: 100%; height: 9rem; object-fit: cover; display: block; }
  .image-meta { padding: 0.625rem; display: grid; gap: 0.375rem; }
  .image-title { font-size: 0.875rem; overflow-wrap: anywhere; }
  .image-attr { font-size: 0.75rem; color: var(--muted); overflow-wrap: anywhere; }
  .picker-pager { margin-top: 0.875rem; justify-content: space-between; }
</style>
