<script lang="ts">
  import "./IntegrationsView.css";
  import {
    createIntegrationsController,
    type IntegrationConnectionSummary,
    type IntegrationsState,
  } from "./integrations-api.ts";
  import {
    createIntegrationCatalogController,
    type IntegrationCatalogProvider,
    type IntegrationCatalogState,
  } from "./integrations-workspace-api.ts";
  import {
    buildProviderCards, connectionsFor, filterProviderCards, providerTone,
    INTEGRATION_CATEGORIES, type IntegrationCategoryId,
  } from "./integrations-catalog.ts";
  import IntegrationProviderDetail from "./IntegrationProviderDetail.svelte";
  import ComposioSessionPanel from "./ComposioSessionPanel.svelte";
  import IntegrationTransferPanel from "./IntegrationTransferPanel.svelte";

  let { role = null }: { role?: "viewer" | "operator" | "owner" | null } = $props();

  let view = $state<IntegrationsState>({ kind: "loading" });
  let catalog = $state<IntegrationCatalogState>({ kind: "loading" });
  let category = $state<IntegrationCategoryId>("all");
  let filterQuery = $state("");
  let selectedId = $state<string | null>(null);
  let showTransfer = $state(false);
  let notice = $state("");
  let controller: ReturnType<typeof createIntegrationsController> | undefined;
  let catalogController: ReturnType<typeof createIntegrationCatalogController> | undefined;

  let isOwner = $derived(role === "owner");

  let connections = $derived.by<IntegrationConnectionSummary[]>(() => (view.kind === "ready" ? view.snapshot.connections : []));
  let profiles = $derived.by<string[]>(() => (view.kind === "ready" ? view.snapshot.users.map((user) => user.id) : []));
  let providers = $derived.by<IntegrationCatalogProvider[]>(() => (catalog.kind === "ready" ? catalog.providers : []));

  let cards = $derived.by(() => filterProviderCards(buildProviderCards(providers, connections), category, filterQuery));
  let selectedProvider = $derived.by<IntegrationCatalogProvider | null>(
    () => providers.find((provider) => provider.id === selectedId) ?? null,
  );
  let composioConnections = $derived(connections.filter((row) => row.provider === "composio"));
  let convexConnections = $derived(connections.filter((row) => row.provider === "convex"));

  let stateTag = $derived.by(() => {
    if (!isOwner) return "owner-only";
    if (catalog.kind !== "ready" || view.kind !== "ready") return catalog.kind === "error" ? "error" : view.kind === "error" ? "error" : "loading";
    if (providers.length === 0) return "empty";
    return cards.length === 0 ? "no-filter-matches" : "ready";
  });

  export function refresh() {
    if (!isOwner) return;
    notice = "";
    void controller?.refresh();
    void catalogController?.refresh();
  }

  function openProvider(id: string) {
    selectedId = selectedId === id ? null : id;
  }

  function closeDetail() {
    selectedId = null;
  }

  function onChanged(message: string) {
    notice = message;
    void controller?.refresh();
  }

  $effect(() => {
    if (!isOwner) {
      controller?.dispose();
      catalogController?.dispose();
      controller = undefined;
      catalogController = undefined;
      selectedId = null;
      showTransfer = false;
      return;
    }
    const nextConnections = createIntegrationsController((s) => { view = s; });
    const nextCatalog = createIntegrationCatalogController((s) => { catalog = s; });
    controller = nextConnections;
    catalogController = nextCatalog;
    void nextConnections.refresh();
    void nextCatalog.refresh();
    return () => {
      nextConnections.dispose();
      nextCatalog.dispose();
      if (controller === nextConnections) controller = undefined;
      if (catalogController === nextCatalog) catalogController = undefined;
    };
  });
</script>

<section aria-labelledby="integrations-title" aria-busy={view.kind === "loading"} data-integrations-state={stateTag}>
  <header class="feature-header">
    <h2 id="integrations-title">Integrations</h2>
    {#if isOwner}
      <div class="actions">
        <button type="button" disabled={view.kind === "loading"} onclick={refresh}>
          {view.kind === "loading" ? "Loading..." : "Refresh"}
        </button>
        <button type="button" aria-expanded={showTransfer} onclick={() => { showTransfer = !showTransfer; }}>
          {showTransfer ? "Hide transfer" : "Transfer"}
        </button>
      </div>
    {/if}
  </header>

  {#if !isOwner}
    <p class="feedback pending" role="status">
      Owner role is required to view providers, configure credentials and open transfer previews. Sign in from an
      Owner device to manage integrations.
    </p>
  {:else}
    {#if notice}<p class="feedback ok" role="status">{notice}</p>{/if}
    {#if view.kind === "error"}<p class="feedback error" role="alert">{view.message}</p>{/if}
    {#if catalog.kind === "error"}<p class="feedback error" role="alert">{catalog.message}</p>{/if}

    <div class="int-toolbar">
      <div class="field int-search">
        <label for="integrations-filter">Filter providers</label>
        <input
          id="integrations-filter"
          type="search"
          bind:value={filterQuery}
          placeholder="Name, category, connection state, or required field"
        />
      </div>
      <div class="int-tabs" role="tablist" aria-label="Provider categories">
        {#each INTEGRATION_CATEGORIES as tab (tab.id)}
          <button
            type="button"
            role="tab"
            aria-selected={category === tab.id}
            class:primary={category === tab.id}
            onclick={() => { category = tab.id; }}
          >{tab.label}</button>
        {/each}
      </div>
    </div>

    <div role="status" aria-live="polite">
      {#if catalog.kind === "loading"}
        <p>Loading the provider catalog...</p>
      {:else if providers.length === 0}
        <p>No integration providers are registered for this installation.</p>
      {:else if cards.length === 0}
        <p>No providers match "{filterQuery.trim()}".</p>
      {:else}
        <ul class="int-grid" aria-label="Integration providers">
          {#each cards as card (card.id)}
            <li class="int-card" data-tone={providerTone(card)}>
              <button
                type="button"
                class="int-card-hit"
                aria-pressed={selectedId === card.id}
                aria-expanded={selectedId === card.id}
                onclick={() => openProvider(card.id)}
              >
                <span class="int-card-head">
                  <strong>{card.title}</strong>
                  <span class="pill" data-tone={card.connected > 0 ? (card.healthy ? "ok" : "warn") : "neutral"}>
                    {card.connected > 0 ? `${card.connected} connected` : "not connected"}
                  </span>
                </span>
                <span class="int-card-desc">{card.description}</span>
                <span class="int-card-meta">
                  {card.methods} method{card.methods === 1 ? "" : "s"} · {card.sources.join(", ")}
                </span>
                {#if card.missing.length > 0}
                  <span class="int-card-warn">Missing: {card.missing.join(", ")}</span>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    {#if selectedProvider}
      <IntegrationProviderDetail
        provider={selectedProvider}
        connections={connectionsFor(selectedProvider.id, connections)}
        users={profiles}
        onClose={closeDetail}
        {onChanged}
      />
    {/if}

    {#if convexConnections.length > 1}
      <p class="int-hint">
        {convexConnections.length} Convex connections share one provider. Cloud and self-hosted deployments are a
        project dimension, not separate cards.
      </p>
    {/if}

    {#if composioConnections.length > 0}
      <ComposioSessionPanel connections={composioConnections} />
    {/if}

    {#if showTransfer}
      <IntegrationTransferPanel onClose={() => { showTransfer = false; }} />
    {/if}
  {/if}
</section>
