<script lang="ts">
  import { onMount } from "svelte";
  import BackupsTab from "./BackupsTab.svelte";
  import JobsLogsTab from "./JobsLogsTab.svelte";
  import LifecycleTab from "./LifecycleTab.svelte";
  import { brandFor, loopbackUrl } from "./appdeck-catalog";
  import { createAppDeckDetail, DETAIL_TABS, initialDetailState, type DetailState, type DetailTab } from "./appdeck-detail";
  import { isRunning } from "./appdeck-view";
  import { safeDashboardUrl, type ManagedAppItem } from "./managed-apps-api";

  let {
    app,
    onclose,
    onchanged,
  }: {
    app: ManagedAppItem;
    onclose: () => void;
    onchanged: () => void;
  } = $props();

  let controller = $state<ReturnType<typeof createAppDeckDetail> | undefined>(undefined);
  let detail = $state<DetailState>(initialDetailState());
  let lastRevision = 0;

  onMount(() => {
    controller = createAppDeckDetail(app.id, (next) => {
      detail = next;
      // A finished lifecycle action may have installed, uninstalled, or moved
      // the app, so the deck is re-read by the parent instead of patched here.
      if (next.revision !== lastRevision) {
        lastRevision = next.revision;
        onchanged();
      }
    });
    void controller.loadTab("lifecycle");
    return () => controller?.dispose();
  });

  let brand = $derived(brandFor(app.id, app.name));
  let running = $derived(isRunning(app));
  let dashboard = $derived(app.dashboardAvailable ? safeDashboardUrl(app.publicDashboardUrl) : null);
  let loopback = $derived(loopbackUrl(brand.port));

  function selectTab(tab: DetailTab) {
    if (!controller || controller.state.tab === tab) return;
    controller.setTab(tab);
    void controller.loadTab(tab);
  }
</script>

<section class="drawer" aria-labelledby="app-detail-title">
  <header class="drawer-head">
    <span class="mark" style={`background:${brand.gradient}`} aria-hidden="true">{brand.glyph}</span>
    <div class="titles">
      <h3 id="app-detail-title">{brand.name}</h3>
      <p>{brand.tagline}</p>
    </div>
    <button class="close" onclick={onclose} aria-label="Close app details">Close</button>
  </header>

  <div class="links">
    {#if dashboard}
      <a href={dashboard} target="_blank" rel="noopener noreferrer">Open dashboard</a>
    {:else if running && loopback}
      <a href={loopback} target="_blank" rel="noopener noreferrer">Open on this host</a>
    {/if}
    {#if app.version}<span class="pill">v{app.version.replace(/^v/i, "")}</span>{/if}
  </div>

  {#if detail.notice}
    <p class="feedback ok" role="status">{detail.notice}</p>
  {/if}
  {#if detail.error}
    <p class="feedback error" role="alert">{detail.error}</p>
  {/if}

  <div class="tabs" role="tablist" aria-label="App detail sections">
    {#each DETAIL_TABS as tab (tab.id)}
      <button
        role="tab"
        id={`tab-${tab.id}`}
        aria-selected={detail.tab === tab.id}
        aria-controls={`panel-${tab.id}`}
        class={detail.tab === tab.id ? "active" : ""}
        onclick={() => selectTab(tab.id)}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  <div class="panel" id={`panel-${detail.tab}`} role="tabpanel" aria-labelledby={`tab-${detail.tab}`}>
    {#if !controller}
      <p>Loading app details...</p>
    {:else if detail.tab === "lifecycle"}
      <LifecycleTab
        appName={brand.name}
        installed={app.installed}
        {running}
        preflight={detail.preflight}
        update={detail.update}
        busy={detail.busy}
        onpreflight={() => void controller?.loadPreflight()}
        onaction={(action) => void controller?.act(action)}
        oninstall={() => void controller?.install()}
        onupdate={() => void controller?.update()}
        onuninstall={() => void controller?.uninstall()}
      />
    {:else if detail.tab === "jobs"}
      <JobsLogsTab
        jobs={detail.jobs}
        logs={detail.logs}
        onjobs={() => void controller?.loadJobs()}
        onlogs={() => void controller?.loadLogs()}
      />
    {:else}
      <BackupsTab
        backups={detail.backups}
        busy={detail.busy}
        onload={() => void controller?.loadBackups()}
        onbackup={() => void controller?.act("backup")}
      />
    {/if}
  </div>
</section>

<style>
  .drawer {
    display: grid; gap: 0.75rem; min-width: 0; margin-top: 1rem; padding: 0.875rem;
    border: 1px solid var(--border); border-radius: 0.75rem; background: var(--panel);
  }
  .drawer-head { display: flex; align-items: flex-start; gap: 0.625rem; }
  .mark {
    display: inline-grid; place-items: center; flex: 0 0 auto; width: 2.25rem; height: 2.25rem;
    border-radius: 0.625rem; color: #fff; font-size: 0.875rem; font-weight: 700;
  }
  .titles { display: grid; gap: 0.125rem; min-width: 0; flex: 1 1 auto; }
  .titles h3 { margin: 0; font-size: 1.0625rem; color: var(--text); }
  .titles p { margin: 0; font-size: 0.8125rem; color: var(--muted); }
  .close {
    flex: 0 0 auto; min-height: 2rem; padding: 0 0.75rem; border: 1px solid var(--border);
    border-radius: 0.375rem; background: transparent; color: var(--text); font-size: 0.8125rem;
    font-weight: 600; cursor: pointer;
  }
  .links { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; font-size: 0.8125rem; }
  .links a { color: var(--accent); font-weight: 600; }
  .pill {
    padding: 0.0625rem 0.4375rem; border: 1px solid var(--border); border-radius: 999px;
    font-size: 0.6875rem; color: var(--muted);
  }
  .tabs { display: flex; gap: 0.25rem; flex-wrap: wrap; border-bottom: 1px solid var(--border); }
  .tabs button {
    min-height: 2.25rem; padding: 0 0.75rem; border: 1px solid transparent; border-bottom: 0;
    border-radius: 0.375rem 0.375rem 0 0; background: transparent; color: var(--muted);
    font-size: 0.8125rem; font-weight: 600; cursor: pointer;
  }
  .tabs button.active {
    border-color: var(--border); background: var(--panel-solid); color: var(--text);
  }
  .panel { min-width: 0; }
  @media (max-width: 400px) {
    .drawer { padding: 0.75rem 0.625rem; }
    .tabs button { flex: 1 1 auto; }
  }
</style>
