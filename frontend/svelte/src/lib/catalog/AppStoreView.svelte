<script lang="ts">
  import {
    createAppStoreController,
    type AppCatalogEntry,
    type AppCatalogStatus,
    type AppStoreState,
  } from "./catalog-api.ts";

  let { role = null }: { role?: "viewer" | "operator" | "owner" | null } = $props();

  let view = $state<AppStoreState>({ kind: "loading" });
  let filterQuery = $state("");
  let controller: ReturnType<typeof createAppStoreController> | undefined;

  let isOwner = $derived(role === "owner");

  let visibleEntries = $derived.by<AppCatalogEntry[]>(() => {
    if (view.kind !== "ready") return [];
    const q = filterQuery.trim().toLowerCase();
    if (!q) return view.catalog.entries;
    return view.catalog.entries.filter((entry) => {
      if (entry.kind === "managed") {
        return `managed ${entry.id}`.toLowerCase().includes(q);
      }
      const m = entry.manifest;
      return `connected ${m.id} ${m.name} ${m.description ?? ""} ${m.launchUrl ?? ""}`.toLowerCase().includes(q);
    });
  });

  let stateTag = $derived.by(() => {
    if (!isOwner) return "owner-only";
    if (view.kind !== "ready") return view.kind;
    if (view.catalog.entries.length === 0) return "empty";
    return visibleEntries.length === 0 ? "no-filter-matches" : "ready";
  });

  function statusTone(status: AppCatalogStatus): "ok" | "warn" | "danger" {
    if (status === "remote") return "ok";
    if (status === "stale") return "warn";
    return "danger";
  }

  function entryKey(entry: AppCatalogEntry): string {
    return entry.kind === "managed" ? `managed:${entry.id}` : `connected:${entry.manifest.id}`;
  }

  export function refresh() {
    if (isOwner) void controller?.refresh();
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

<section aria-labelledby="app-store-title" aria-busy={isOwner && view.kind === "loading"} data-app-store-state={stateTag}>
  <header class="feature-header">
    <div class="store-title-group">
      <h2 id="app-store-title">App Store</h2>
      {#if isOwner && view.kind === "ready"}
        <span class="pill" data-tone={statusTone(view.catalog.status)} data-catalog-status={view.catalog.status}>
          Catalog: {view.catalog.status}
        </span>
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
    <div class="store-filter-wrap">
      <label for="app-store-filter">Filter catalog entries</label>
      <input
        id="app-store-filter"
        type="search"
        bind:value={filterQuery}
        placeholder="App ID, name, kind (managed or connected), or description"
      />
    </div>

    <div role="status" aria-live="polite">
      {#if view.kind === "loading"}
        <p>Loading app catalog...</p>
      {:else if view.kind === "error"}
        <p class="feedback error" role="alert">{view.message}</p>
      {:else if view.catalog.entries.length === 0}
        <p>No app catalog entries available ({view.catalog.status}).</p>
      {:else if visibleEntries.length === 0}
        <p>No app catalog entries match "{filterQuery.trim()}".</p>
      {:else}
        <ul class="store-list" aria-label="App catalog entries">
          {#each visibleEntries as entry (entryKey(entry))}
            <li class="store-row">
              {#if entry.kind === "managed"}
                <div class="store-info">
                  <div class="store-heading">
                    <strong>{entry.id}</strong>
                    <span class="pill" data-tone="ok">managed</span>
                  </div>
                  <p class="store-meta">Managed container application template ({entry.id})</p>
                </div>
              {:else}
                <div class="store-info">
                  <div class="store-heading">
                    <strong>{entry.manifest.name}</strong>
                    <code>{entry.manifest.id}</code>
                    <span class="pill">connected</span>
                  </div>
                  {#if entry.manifest.description}
                    <p class="store-desc">{entry.manifest.description}</p>
                  {/if}
                  {#if entry.manifest.launchUrl}
                    <p class="store-meta">Launch URL: {entry.manifest.launchUrl}</p>
                  {/if}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</section>

<style>
  .store-title-group { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .store-filter-wrap { display: grid; gap: 0.375rem; margin: 1rem 0; }
  .store-filter-wrap label { font-size: 0.875rem; font-weight: 600; color: var(--text); }
  .store-filter-wrap input { width: 100%; min-width: 0; min-height: var(--ui-control-height); }
  .store-list { list-style: none; padding: 0; margin: 0.5rem 0 0; display: grid; gap: 0.625rem; max-height: 24rem; overflow-y: auto; }
  .store-row { padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel); }
  .store-info { display: grid; gap: 0.25rem; min-width: 0; }
  .store-heading { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .store-heading code { font-size: 0.8125rem; color: var(--muted); }
  .store-desc { margin: 0; font-size: 0.875rem; color: var(--muted); }
  .store-meta { margin: 0; font-size: 0.8125rem; color: var(--muted); }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
  .pill[data-tone="danger"] { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
</style>
