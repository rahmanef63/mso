<script lang="ts">
  import {
    createAppStoreController,
    type AppStoreState,
  } from "./catalog-api.ts";
  import {
    buildCatalogCards,
    CATALOG_CATEGORIES,
    CATALOG_SORTS,
    catalogStatusTone,
    filterCatalogCards,
    sortCatalogCards,
    type CatalogCard,
    type CatalogCategoryId,
    type CatalogSortId,
  } from "./catalog-model.ts";
  import CatalogCardTile from "./CatalogCard.svelte";
  import CatalogDetailDrawer from "./CatalogDetailDrawer.svelte";

  let { role = null }: { role?: "viewer" | "operator" | "owner" | null } = $props();

  let view = $state<AppStoreState>({ kind: "loading" });
  let filterQuery = $state("");
  let category = $state<CatalogCategoryId>("all");
  let sort = $state<CatalogSortId>("curated");
  let selected = $state<CatalogCard | null>(null);
  let controller: ReturnType<typeof createAppStoreController> | undefined;

  let isOwner = $derived(role === "owner");

  let cards = $derived.by<CatalogCard[]>(() =>
    view.kind === "ready" ? buildCatalogCards(view.catalog) : []);

  let spotlight = $derived(cards.find((card) => card.spotlight) ?? null);

  let visibleCards = $derived.by<CatalogCard[]>(() =>
    sortCatalogCards(filterCatalogCards(cards, filterQuery, category), sort));

  let stateTag = $derived.by(() => {
    if (!isOwner) return "owner-only";
    if (view.kind !== "ready") return view.kind;
    if (cards.length === 0) return "empty";
    return visibleCards.length === 0 ? "no-filter-matches" : "ready";
  });

  export function refresh() {
    if (isOwner) void controller?.refresh();
  }

  function launch(url: string) {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  $effect(() => {
    if (!isOwner) {
      controller?.dispose();
      controller = undefined;
      return;
    }
    const next = createAppStoreController((s) => { view = s; });
    controller = next;
    void next.refresh();
    return () => {
      next.dispose();
      if (controller === next) controller = undefined;
    };
  });
</script>

<section
  aria-labelledby="app-store-title"
  aria-busy={isOwner && view.kind === "loading"}
  data-app-store-state={stateTag}
>
  <header class="feature-header store-header">
    <div class="store-title-group">
      <h2 id="app-store-title">App Store</h2>
      {#if isOwner && view.kind === "ready"}
        <span
          class="pill"
          data-tone={catalogStatusTone(view.catalog.status)}
          data-catalog-status={view.catalog.status}
        >Catalog: {view.catalog.status}</span>
      {/if}
    </div>
    {#if isOwner}
      <button type="button" disabled={view.kind === "loading"} onclick={refresh}>
        {view.kind === "loading" ? "Loading..." : "Refresh"}
      </button>
    {/if}
  </header>

  {#if !isOwner}
    <p class="feedback pending" role="status">
      Owner role is required to browse and manage the App Store catalog. Sign in from an Owner device to inspect available catalog apps.
    </p>
  {:else}
    <div role="status" aria-live="polite">
      {#if view.kind === "loading"}
        <p>Loading app catalog...</p>
      {:else if view.kind === "error"}
        <p class="feedback error" role="alert">{view.message}</p>
      {:else if cards.length === 0}
        <p>No app catalog entries available ({view.catalog.status}).</p>
      {:else}
        {#if spotlight}
          <article class="spotlight" aria-label="Featured app">
            <span class="spotlight-glyph" aria-hidden="true">{spotlight.title.slice(0, 1).toUpperCase()}</span>
            <div class="spotlight-body">
              <span class="spotlight-kicker">Editor's choice</span>
              <h3>{spotlight.title}</h3>
              <p>{spotlight.summary}</p>
              <div class="spotlight-row">
                <span class="pill" data-tone="ok">{spotlight.kindLabel}</span>
                <span class="spotlight-meta">{spotlight.meta}</span>
              </div>
              <button type="button" onclick={() => { selected = spotlight; }}>View details</button>
            </div>
          </article>
        {/if}

        <div class="store-toolbar">
          <div class="store-search field">
            <label for="app-store-filter">Search apps</label>
            <input
              id="app-store-filter"
              type="search"
              bind:value={filterQuery}
              placeholder="Name, ID, category, or description"
            />
          </div>
          <div class="store-sort field">
            <label for="app-store-sort">Sort by</label>
            <select id="app-store-sort" bind:value={sort}>
              {#each CATALOG_SORTS as option (option.id)}
                <option value={option.id}>{option.label}</option>
              {/each}
            </select>
          </div>
        </div>

        <div class="store-pills" role="group" aria-label="Filter by category">
          {#each CATALOG_CATEGORIES as option (option.id)}
            <button
              type="button"
              class="pill-button"
              class:active={category === option.id}
              aria-pressed={category === option.id}
              onclick={() => { category = option.id; }}
            >{option.label}</button>
          {/each}
        </div>

        {#if visibleCards.length === 0}
          <p class="feedback pending" role="status">No apps match this search and category filter.</p>
        {:else}
          <ul class="store-grid" aria-label="App catalog entries">
            {#each visibleCards as card (card.key)}
              <CatalogCardTile {card} onOpen={(next) => { selected = next; }} />
            {/each}
          </ul>
        {/if}
      {/if}
    </div>

    <CatalogDetailDrawer card={selected} onClose={() => { selected = null; }} onLaunch={launch} />
  {/if}
</section>

<style>
  .store-header { margin-bottom: 0.75rem; }
  .store-title-group { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; min-width: 0; }
  .spotlight {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    padding: 1rem;
    margin-bottom: 1rem;
    border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--border));
    border-radius: 0.875rem;
    background: color-mix(in srgb, var(--accent) 10%, var(--panel-solid));
  }
  .spotlight-glyph {
    display: grid;
    place-items: center;
    width: 3.5rem;
    height: 3.5rem;
    border-radius: 1rem;
    background: var(--accent);
    color: var(--accent-text);
    font-size: 1.5rem;
    font-weight: 700;
  }
  .spotlight-body { display: grid; gap: 0.375rem; min-width: 0; justify-items: start; }
  .spotlight-kicker { font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text); }
  .spotlight-body h3 { font-size: 1.125rem; }
  .spotlight-body p { margin: 0; font-size: 0.875rem; }
  .spotlight-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .spotlight-meta { font-size: 0.75rem; color: var(--muted); overflow-wrap: anywhere; }
  .store-toolbar { display: grid; gap: 0.75rem; grid-template-columns: 1fr; margin-bottom: 0.75rem; }
  .store-search input, .store-sort select { width: 100%; min-width: 0; }
  label { font-size: 0.8125rem; font-weight: 600; color: var(--text); }
  .store-pills { display: flex; flex-wrap: wrap; gap: 0.375rem; margin-bottom: 1rem; }
  .pill-button { min-height: var(--ui-control-height); border-radius: 999px; font-size: 0.8125rem; }
  .pill-button.active { background: var(--accent); color: var(--accent-text); border-color: var(--accent); font-weight: 600; }
  .store-grid { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.75rem; grid-template-columns: 1fr; }
  .pill {
    display: inline-block;
    padding: 0.125rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: 0.75rem;
    color: var(--muted);
  }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
  .pill[data-tone="danger"] { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
  @media (min-width: 560px) {
    .store-toolbar { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); align-items: end; }
    .store-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (min-width: 900px) {
    .store-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  }
</style>
