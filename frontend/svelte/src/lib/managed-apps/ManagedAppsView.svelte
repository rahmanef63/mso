<script lang="ts">
  import { onMount } from "svelte";
  import {
    createManagedAppsController,
    safeDashboardUrl,
    type ManagedAppItem,
    type ManagedAppsState,
  } from "./managed-apps-api";

  let view = $state<ManagedAppsState>({ kind: "loading" });
  let filterQuery = $state("");
  let controller: ReturnType<typeof createManagedAppsController> | undefined;

  let visibleApps = $derived.by<ManagedAppItem[]>(() => {
    if (view.kind !== "ready") return [];
    const q = filterQuery.trim().toLowerCase();
    if (!q) return view.apps;
    return view.apps.filter((app) =>
      `${app.name} ${app.id} ${app.state} ${app.installationType} ${app.version ?? ""} ${app.description}`
        .toLowerCase().includes(q));
  });

  let stateTag = $derived.by(() => {
    if (view.kind !== "ready") return view.kind;
    if (view.apps.length === 0) return "empty";
    return visibleApps.length === 0 ? "no-filter-matches" : "ready";
  });

  function stateTone(app: ManagedAppItem): "ok" | "danger" | "warn" | "neutral" {
    if (app.state === "running" && app.healthy !== false) return "ok";
    if (app.state === "unhealthy" || app.state === "error" || app.healthy === false) return "danger";
    if (app.state === "starting") return "warn";
    return "neutral";
  }

  export function refresh() {
    void controller?.refresh();
  }

  onMount(() => {
    controller = createManagedAppsController((next) => { view = next; });
    void controller.refresh();
    return () => controller?.dispose();
  });
</script>

<section aria-labelledby="managed-apps-title" aria-busy={view.kind === "loading"} data-managed-apps-state={stateTag}>
  <header class="feature-header">
    <h2 id="managed-apps-title">Managed Apps</h2>
    <button disabled={view.kind === "loading"} onclick={refresh}>
      {view.kind === "loading" ? "Loading..." : "Refresh apps"}
    </button>
  </header>

  <div class="apps-filter-wrap">
    <label for="managed-apps-filter">Filter apps</label>
    <input id="managed-apps-filter" type="search" bind:value={filterQuery} placeholder="Name, ID, status, or version" />
  </div>

  <div role="status" aria-live="polite">
    {#if view.kind === "loading"}
      <p>Loading managed applications...</p>
    {:else if view.kind === "error"}
      <p class="feedback error" role="alert">{view.message}</p>
    {:else if view.apps.length === 0}
      <p>No managed applications reported by the host.</p>
    {:else if visibleApps.length === 0}
      <p>No managed applications match "{filterQuery.trim()}".</p>
    {:else}
      <ul class="apps-list" aria-label="Managed applications">
        {#each visibleApps as app (app.id)}
          {@const dashboardHref = app.dashboardAvailable ? safeDashboardUrl(app.publicDashboardUrl) : null}
          <li class="app-row">
            <div class="app-info">
              <div class="app-heading">
                <strong>{app.name}</strong>
                <code>{app.id}</code>
                <span class="pill" data-tone={stateTone(app)}>{app.state}</span>
                <span class="pill">{app.installed ? app.installationType : "not installed"}</span>
                {#if app.healthy !== null}
                  <span class="pill" data-tone={app.healthy ? "ok" : "danger"}>
                    {app.healthy ? "healthy" : "unhealthy"}
                  </span>
                {/if}
                {#if app.version}
                  <span class="pill">v{app.version.replace(/^v/i, "")}</span>
                {/if}
              </div>
              {#if app.description}
                <p class="app-desc">{app.description}</p>
              {/if}
              {#if app.diagnostic}
                <p class="app-diag">{app.diagnostic}</p>
              {/if}
            </div>
            {#if dashboardHref}
              <a class="dash-link" href={dashboardHref} target="_blank" rel="noopener noreferrer">
                Open dashboard
              </a>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>

<style>
  .apps-filter-wrap { display: grid; gap: 0.375rem; margin: 1rem 0; }
  .apps-filter-wrap label { font-size: 0.875rem; font-weight: 600; color: var(--text); }
  .apps-filter-wrap input { width: 100%; min-width: 0; min-height: var(--ui-control-height); }
  .apps-list {
    list-style: none; padding: 0; margin: 0.75rem 0 0; display: grid; gap: 0.625rem;
    max-height: 24rem; overflow-y: auto;
  }
  .app-row {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;
    padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel);
  }
  .app-info { display: grid; gap: 0.25rem; min-width: 0; flex: 1 1 14rem; }
  .app-heading { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .app-heading code { font-size: 0.8125rem; color: var(--muted); }
  .app-desc { margin: 0; font-size: 0.875rem; color: var(--muted); }
  .app-diag { margin: 0.25rem 0 0; font-size: 0.8125rem; color: var(--warn); }
  .pill {
    display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border);
    border-radius: 999px; font-size: 0.75rem; color: var(--muted);
  }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="danger"] { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
  .dash-link {
    display: inline-flex; align-items: center; min-height: var(--ui-control-height); padding: 0.5rem 0.875rem;
    border: 1px solid var(--accent); border-radius: 0.375rem; background: var(--accent); color: var(--accent-text);
    font-size: 0.875rem; font-weight: 600; text-decoration: none; white-space: nowrap;
  }
</style>
