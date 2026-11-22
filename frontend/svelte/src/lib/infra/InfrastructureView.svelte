<script lang="ts">
  import {
    createInfraController,
    type InfraProviderSummary,
    type InfraState,
  } from "./infra-api.ts";

  let { role = null }: { role?: "viewer" | "operator" | "owner" | null } = $props();

  let view = $state<InfraState>({ kind: "loading" });
  let filterQuery = $state("");
  let controller: ReturnType<typeof createInfraController> | undefined;

  let isOwner = $derived(role === "owner");

  let visibleProviders = $derived.by<InfraProviderSummary[]>(() => {
    if (view.kind !== "ready") return [];
    const q = filterQuery.trim().toLowerCase();
    if (!q) return view.providers;
    return view.providers.filter((p) =>
      `${p.id} ${p.label ?? ""} ${p.configured ? "configured" : "unconfigured"} ${(p.fields ?? []).join(" ")} ${(p.missing ?? []).join(" ")}`
        .toLowerCase().includes(q));
  });

  let configuredCount = $derived.by<number>(() => {
    if (view.kind !== "ready") return 0;
    return view.providers.filter((p) => p.configured).length;
  });

  let stateTag = $derived.by(() => {
    if (!isOwner) return "owner-only";
    if (view.kind !== "ready") return view.kind;
    if (view.providers.length === 0) return "empty";
    return visibleProviders.length === 0 ? "no-filter-matches" : "ready";
  });

  export function refresh() {
    if (isOwner) void controller?.refresh();
  }

  $effect(() => {
    if (!isOwner) {
      controller?.dispose();
      controller = undefined;
      return;
    }
    const next = createInfraController((s) => { view = s; });
    controller = next;
    void next.refresh();
    return () => {
      next.dispose();
      if (controller === next) controller = undefined;
    };
  });
</script>

<section aria-labelledby="infra-title" aria-busy={isOwner && view.kind === "loading"} data-infra-state={stateTag}>
  <header class="feature-header">
    <div class="infra-title-group">
      <h2 id="infra-title">Infrastructure</h2>
      {#if isOwner && view.kind === "ready" && view.providers.length > 0}
        <span class="pill" data-tone={configuredCount > 0 ? "ok" : "warn"}>
          {configuredCount} of {view.providers.length} configured
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
      Owner role is required to inspect infrastructure providers and deployment readiness. Sign in from an Owner device to view provider status.
    </p>
  {:else}
    <div class="infra-filter-wrap">
      <label for="infra-filter">Filter providers</label>
      <input
        id="infra-filter"
        type="search"
        bind:value={filterQuery}
        placeholder="Provider ID, label, field name, or configured status"
      />
    </div>

    <div role="status" aria-live="polite">
      {#if view.kind === "loading"}
        <p>Loading infrastructure providers...</p>
      {:else if view.kind === "error"}
        <p class="feedback error" role="alert">{view.message}</p>
      {:else if view.providers.length === 0}
        <p>No infrastructure providers registered for this installation.</p>
      {:else if visibleProviders.length === 0}
        <p>No infrastructure providers match "{filterQuery.trim()}".</p>
      {:else}
        <ul class="infra-list" aria-label="Infrastructure providers">
          {#each visibleProviders as provider (provider.id)}
            <li class="infra-row">
              <div class="infra-info">
                <div class="infra-heading">
                  <strong>{provider.label ?? provider.id}</strong>
                  <code>{provider.id}</code>
                  <span class="pill" data-tone={provider.configured ? "ok" : "warn"}>
                    {provider.configured ? "configured" : "unconfigured"}
                  </span>
                </div>
                {#if provider.fields && provider.fields.length > 0}
                  <p class="infra-meta">Fields: {provider.fields.join(", ")}</p>
                {/if}
                {#if provider.missing && provider.missing.length > 0}
                  <p class="infra-warn">Missing required fields: {provider.missing.join(", ")}</p>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</section>

<style>
  .infra-title-group { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .infra-filter-wrap { display: grid; gap: 0.375rem; margin: 1rem 0; }
  .infra-filter-wrap label { font-size: 0.875rem; font-weight: 600; color: var(--text); }
  .infra-filter-wrap input { width: 100%; min-width: 0; min-height: var(--ui-control-height); }
  .infra-list { list-style: none; padding: 0; margin: 0.5rem 0 0; display: grid; gap: 0.625rem; max-height: 24rem; overflow-y: auto; }
  .infra-row { padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel); }
  .infra-info { display: grid; gap: 0.25rem; min-width: 0; }
  .infra-heading { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .infra-heading code { font-size: 0.8125rem; color: var(--muted); }
  .infra-meta { margin: 0; font-size: 0.8125rem; color: var(--muted); }
  .infra-warn { margin: 0; font-size: 0.8125rem; color: var(--warn); }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
</style>
