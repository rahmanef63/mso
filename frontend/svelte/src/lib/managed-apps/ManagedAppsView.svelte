<script lang="ts">
  import { onMount } from "svelte";
  import AppCard from "./AppCard.svelte";
  import AppDetailDrawer from "./AppDetailDrawer.svelte";
  import DiscoveryPanel from "./DiscoveryPanel.svelte";
  import { describeError } from "./appdeck-detail";
  import { createAppDeckOverview, initialOverviewState } from "./appdeck-overview";
  import { runLifecycle, type LifecycleAction } from "./appdeck-api";
  import {
    filterApps, OVERVIEW_TABS, tabCounts, tunnelsLabel, tunnelsSummary, type OverviewTab,
  } from "./appdeck-view";
  import type { ManagedAppItem, ManagedAppsState } from "./managed-apps-api";

  let overview: ReturnType<typeof createAppDeckOverview> | undefined;
  const empty = initialOverviewState();
  let apps = $state<ManagedAppsState>({ kind: "loading" });
  let discovery = $state(empty.discovery);
  let tunnels = $state(empty.tunnels);
  let tab = $state<OverviewTab>("all");
  let query = $state("");
  let selectedId = $state<string | null>(null);
  let quickBusy = $state<string | null>(null);
  let quickError = $state<string | null>(null);

  let visible = $derived(apps.kind === "ready" ? filterApps(apps.apps, tab, query) : []);
  let counts = $derived(tabCounts(apps.kind === "ready" ? apps.apps : []));
  let selected = $derived.by<ManagedAppItem | null>(() => {
    if (apps.kind !== "ready" || !selectedId) return null;
    return apps.apps.find((app) => app.id === selectedId) ?? null;
  });
  let tunnelText = $derived(
    tunnels.kind === "ready" ? tunnelsLabel(tunnelsSummary(tunnels.data.tunnels), tunnels.data.sshAvailable) : "SSH tunnels not checked",
  );
  let stateTag = $derived.by(() => {
    if (apps.kind !== "ready") return apps.kind;
    if (apps.apps.length === 0) return "empty";
    return visible.length === 0 ? "no-filter-matches" : "ready";
  });

  export function refresh() {
    void overview?.refresh();
  }

  function openApp(id: string) {
    selectedId = selectedId === id ? null : id;
  }

  function closeApp() {
    selectedId = null;
  }

  function applyOverview() {
    if (!overview) return;
    apps = overview.state.apps;
    discovery = overview.state.discovery;
    tunnels = overview.state.tunnels;
  }

  onMount(() => {
    overview = createAppDeckOverview(applyOverview);
    overview.refresh();
    return () => overview?.dispose();
  });

  // Card buttons act immediately for non-destructive verbs. Stop is confirmed
  // in the drawer, so the card asks for that click instead of firing it.
  async function quickAction(id: string, action: LifecycleAction) {
    if (quickBusy) return;
    quickBusy = id;
    quickError = null;
    try {
      await runLifecycle(id, action, new AbortController().signal);
      overview?.refresh();
    } catch (error) {
      quickError = describeError(error);
    } finally {
      quickBusy = null;
    }
  }

  function quickStart(id: string) {
    void quickAction(id, "start");
  }

  function quickStop(id: string) {
    void quickAction(id, "stop");
  }
</script>

<section aria-labelledby="managed-apps-title" aria-busy={apps.kind === "loading"} data-managed-apps-state={stateTag}>
  <header class="feature-header">
    <h2 id="managed-apps-title">AppDeck</h2>
    <div class="head-actions">
      <span class="tunnel-pill" data-tone={tunnels.kind === "error" ? "warn" : "neutral"}>{tunnelText}</span>
      <button disabled={apps.kind === "loading"} onclick={refresh}>
        {apps.kind === "loading" ? "Loading..." : "Refresh"}
      </button>
    </div>
  </header>

  <div class="controls">
    <div class="tabs" role="tablist" aria-label="Filter managed apps">
      {#each OVERVIEW_TABS as item (item.id)}
        <button
          role="tab"
          id={`deck-tab-${item.id}`}
          aria-selected={tab === item.id}
          class={tab === item.id ? "active" : ""}
          onclick={() => { tab = item.id; }}
        >
          {item.label}
          <span class="count">{counts[item.id]}</span>
        </button>
      {/each}
    </div>
    <div class="search">
      <label for="deck-search">Search apps</label>
      <input id="deck-search" type="search" bind:value={query} placeholder="Name, ID, status, or version" />
    </div>
  </div>

  {#if quickError}
    <p class="feedback error" role="alert">{quickError}</p>
  {/if}

  <div role="tabpanel" aria-label="Managed applications" aria-live="polite">
    {#if apps.kind === "loading"}
      <p>Loading managed applications...</p>
    {:else if apps.kind === "error"}
      <p class="feedback error" role="alert">{apps.message}</p>
    {:else if apps.apps.length === 0}
      <p>No managed applications reported by the host.</p>
    {:else if visible.length === 0}
      <p>No managed applications match this view.</p>
    {:else}
      <ul class="grid" aria-label="Managed applications">
        {#each visible as app (app.id)}
          <li>
            <AppCard
              {app}
              selected={selectedId === app.id}
              busy={quickBusy === app.id}
              onopen={openApp}
              onstart={quickStart}
              onstop={quickStop}
            />
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  {#if selected}
    <AppDetailDrawer app={selected} onclose={closeApp} onchanged={refresh} />
  {/if}

  <DiscoveryPanel
    {discovery}
    {tunnels}
    ondiscover={() => void overview?.discover()}
    ontunnels={() => void overview?.loadTunnels()}
  />
</section>

<style>
  .head-actions { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .tunnel-pill {
    padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px;
    font-size: 0.75rem; color: var(--muted);
  }
  .tunnel-pill[data-tone="warn"] { color: var(--warn); border-color: var(--warn); background: var(--warn-bg); }
  .controls { display: grid; gap: 0.75rem; margin: 1rem 0; }
  .tabs { display: flex; gap: 0.25rem; flex-wrap: wrap; }
  .tabs button {
    display: inline-flex; align-items: center; gap: 0.375rem; min-height: 2rem; padding: 0 0.75rem;
    border: 1px solid var(--border); border-radius: 999px; background: var(--panel-solid);
    color: var(--muted); font-size: 0.8125rem; font-weight: 600; cursor: pointer;
  }
  .tabs button.active { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
  .count {
    padding: 0 0.3125rem; border-radius: 999px; background: var(--border);
    font-size: 0.6875rem; font-variant-numeric: tabular-nums;
  }
  .tabs button.active .count { background: rgba(255, 255, 255, 0.28); }
  .search { display: grid; gap: 0.375rem; }
  .search label { font-size: 0.875rem; font-weight: 600; color: var(--text); }
  .search input { width: 100%; min-width: 0; min-height: var(--ui-control-height); }
  .grid {
    list-style: none; display: grid; gap: 0.625rem; margin: 0.75rem 0 0; padding: 0;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr));
  }
  .grid li { min-width: 0; display: grid; }
  @media (max-width: 400px) {
    .tabs button { flex: 1 1 auto; justify-content: center; }
  }
</style>
