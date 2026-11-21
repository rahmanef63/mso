<script lang="ts">
  import {
    createIntegrationsController,
    type IntegrationConnectionSummary,
    type IntegrationsState,
  } from "./integrations-api.ts";

  let { role = null }: { role?: "viewer" | "operator" | "owner" | null } = $props();

  let view = $state<IntegrationsState>({ kind: "loading" });
  let filterQuery = $state("");
  let controller: ReturnType<typeof createIntegrationsController> | undefined;

  let isOwner = $derived(role === "owner");

  let visibleConnections = $derived.by<IntegrationConnectionSummary[]>(() => {
    if (view.kind !== "ready") return [];
    const q = filterQuery.trim().toLowerCase();
    if (!q) return view.snapshot.connections;
    return view.snapshot.connections.filter((conn) =>
      `${conn.provider} ${conn.label} ${conn.id} ${conn.user} ${conn.scope} ${conn.source} ${conn.authMethod} ${conn.state}`
        .toLowerCase().includes(q));
  });

  let providerSummary = $derived.by<Array<{ provider: string; count: number; healthy: number }>>(() => {
    if (view.kind !== "ready") return [];
    const map = new Map<string, { provider: string; count: number; healthy: number }>();
    for (const conn of view.snapshot.connections) {
      const entry = map.get(conn.provider) ?? { provider: conn.provider, count: 0, healthy: 0 };
      entry.count += 1;
      if (conn.state === "verified" || conn.state === "configured" || conn.state === "ACTIVE") entry.healthy += 1;
      map.set(conn.provider, entry);
    }
    return [...map.values()].sort((a, b) => a.provider.localeCompare(b.provider));
  });

  let stateTag = $derived.by(() => {
    if (!isOwner) return "owner-only";
    if (view.kind !== "ready") return view.kind;
    if (view.snapshot.connections.length === 0) return "empty";
    return visibleConnections.length === 0 ? "no-filter-matches" : "ready";
  });

  function connTone(connState: string): "ok" | "warn" | "danger" | "neutral" {
    if (connState === "verified" || connState === "ACTIVE") return "ok";
    if (connState === "configured" || connState === "incomplete" || connState === "authorization-required") return "warn";
    if (connState === "invalid" || connState === "unavailable" || connState === "error") return "danger";
    return "neutral";
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
    const next = createIntegrationsController((s) => { view = s; });
    controller = next;
    void next.refresh();
    return () => {
      next.dispose();
      if (controller === next) controller = undefined;
    };
  });
</script>

<section aria-labelledby="integrations-title" aria-busy={isOwner && view.kind === "loading"} data-integrations-state={stateTag}>
  <header class="feature-header">
    <h2 id="integrations-title">Integrations</h2>
    {#if isOwner}
      <button type="button" disabled={view.kind === "loading"} onclick={refresh}>
        {view.kind === "loading" ? "Loading..." : "Refresh"}
      </button>
    {/if}
  </header>

  {#if !isOwner}
    <p class="feedback pending" role="status">
      Owner role is required to view configured integrations and provider connections. Sign in from an Owner device to inspect connection metadata.
    </p>
  {:else}
    <div class="int-filter-wrap">
      <label for="integrations-filter">Filter connections</label>
      <input id="integrations-filter" type="search" bind:value={filterQuery} placeholder="Provider, label, scope, source, or status" />
    </div>

    <div role="status" aria-live="polite">
      {#if view.kind === "loading"}
        <p>Loading configured integrations...</p>
      {:else if view.kind === "error"}
        <p class="feedback error" role="alert">{view.message}</p>
      {:else if view.snapshot.connections.length === 0}
        <p>No provider connections configured yet for {view.snapshot.user ?? "this workspace"}.</p>
      {:else}
        <div class="provider-chips" aria-label="Configured providers">
          {#each providerSummary as item (item.provider)}
            <span class="pill" data-tone={item.healthy === item.count ? "ok" : "warn"}>
              {item.provider} ({item.count})
            </span>
          {/each}
        </div>

        {#if visibleConnections.length === 0}
          <p>No connections match "{filterQuery.trim()}".</p>
        {:else}
          <ul class="int-list" aria-label="Integration connections">
            {#each visibleConnections as conn (`${conn.user}:${conn.provider}:${conn.id}`)}
              <li class="int-row">
                <div class="int-info">
                  <div class="int-heading">
                    <strong>{conn.label}</strong>
                    <code>{conn.provider}/{conn.id}</code>
                    <span class="pill" data-tone={connTone(conn.state)}>{conn.state}</span>
                    <span class="pill">{conn.source}</span>
                    <span class="pill">{conn.scope}</span>
                    {#if conn.isDefault}
                      <span class="pill" data-tone="ok">default</span>
                    {/if}
                  </div>
                  <p class="int-meta">
                    Profile: {conn.user} | Auth: {conn.authMethod}
                  </p>
                  {#if conn.missing.length > 0}
                    <p class="int-warn">Missing required fields: {conn.missing.join(", ")}</p>
                  {/if}
                  {#if conn.lastCheckDetail}
                    <p class="int-meta">Last check: {conn.lastCheckDetail}</p>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>
  {/if}
</section>

<style>
  .int-filter-wrap { display: grid; gap: 0.375rem; margin: 1rem 0; }
  .int-filter-wrap label { font-size: 0.875rem; font-weight: 600; color: var(--text); }
  .int-filter-wrap input { width: 100%; min-width: 0; min-height: var(--ui-control-height); }
  .provider-chips { display: flex; flex-wrap: wrap; gap: 0.375rem; margin-bottom: 0.75rem; }
  .int-list { list-style: none; padding: 0; margin: 0.5rem 0 0; display: grid; gap: 0.625rem; max-height: 24rem; overflow-y: auto; }
  .int-row { padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel); }
  .int-info { display: grid; gap: 0.25rem; min-width: 0; }
  .int-heading { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .int-heading code { font-size: 0.8125rem; color: var(--muted); }
  .int-meta { margin: 0; font-size: 0.8125rem; color: var(--muted); }
  .int-warn { margin: 0; font-size: 0.8125rem; color: var(--warn); }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="danger"] { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
</style>
