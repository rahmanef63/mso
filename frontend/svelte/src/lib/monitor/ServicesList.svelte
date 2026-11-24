<script lang="ts">
  import { onMount } from "svelte";
  import {
    createServicesController,
    serviceKey,
    type ServiceAction,
    type ServicesState,
    type SystemService,
  } from "./services-api";
  import { readServiceLogs, LOG_LIMIT } from "./services-logs-api";
  import {
    countByStatus,
    matchesService,
    serviceStatus,
    SERVICE_FILTERS,
    type ServiceStatusFilter,
  } from "./services-view";
  import ServiceLogsDrawer from "./ServiceLogsDrawer.svelte";
  import type { ServiceLogs } from "../../../../../lib/contracts/os-api";

  type PendingConfirmation = { key: string; service: SystemService; action: ServiceAction };
  type LogTarget = { scope: SystemService["scope"]; unit: string };

  let view = $state<ServicesState>({ kind: "loading" });
  let filterQuery = $state("");
  let statusFilter = $state<ServiceStatusFilter>("all");
  let pending = $state<PendingConfirmation | null>(null);
  let detail = $state<SystemService | null>(null);
  let logs = $state<ServiceLogs | null>(null);
  let logsBusy = $state(false);
  let logsError = $state<string | null>(null);
  let controller: ReturnType<typeof createServicesController> | undefined;
  let logRun = 0;
  let logAbort: AbortController | undefined;

  let inventoryRows = $derived.by<SystemService[]>(() =>
    view.kind === "ready" || view.kind === "unavailable" ? view.inventory.services : []);

  let visibleServices = $derived.by<SystemService[]>(() =>
    inventoryRows.filter((svc) => matchesService(svc, filterQuery, statusFilter)));

  let counts = $derived(countByStatus(inventoryRows));

  let stateTag = $derived.by(() => {
    if (view.kind !== "ready") return view.kind;
    if (view.inventory.services.length === 0) return "empty";
    return visibleServices.length === 0 ? "no-filter-matches" : "ready";
  });

  export function refresh() {
    pending = null;
    closeDetail();
    void controller?.refresh();
  }

  function confirmAction(item: PendingConfirmation) {
    pending = null;
    void controller?.trigger(item.service.scope, item.service.unit, item.action);
  }

  async function loadLogs(target: LogTarget) {
    const run = ++logRun;
    logAbort?.abort();
    const abort = (logAbort = new AbortController());
    logsBusy = true;
    logsError = null;
    logs = null;
    try {
      const result = await readServiceLogs(target.scope, target.unit, abort.signal, fetch, undefined, LOG_LIMIT);
      if (run !== logRun) return;
      logs = result;
    } catch (error) {
      if (run !== logRun || abort.signal.aborted) return;
      logsError = error instanceof Error ? error.message : "Could not read the service journal.";
    } finally {
      if (run === logRun) logsBusy = false;
    }
  }

  function closeDetail() {
    detail = null;
    logs = null;
    logsError = null;
    logRun++;
    logAbort?.abort();
    logsBusy = false;
  }

  function openDetail(svc: SystemService) {
    if (detail?.unit === svc.unit && detail?.scope === svc.scope) closeDetail();
    else { detail = svc; void loadLogs(svc); }
  }

  onMount(() => {
    controller = createServicesController((next) => {
      if (next.kind !== "ready") pending = null;
      view = next;
    });
    void controller.refresh();
    return () => {
      logRun++;
      logAbort?.abort();
      controller?.dispose();
    };
  });
</script>

<section aria-labelledby="services-title" aria-busy={view.kind === "loading"} data-services-state={stateTag}>
  <header class="feature-header">
    <h2 id="services-title">Services</h2>
    <button disabled={view.kind === "loading"} onclick={refresh}>
      {view.kind === "loading" ? "Loading..." : "Refresh services"}
    </button>
  </header>

  <div class="service-controls">
    <div class="filter-chips" role="group" aria-label="Filter services by status">
      {#each SERVICE_FILTERS as filter (filter.id)}
        <button
          type="button"
          class="chip"
          aria-pressed={statusFilter === filter.id}
          onclick={() => { statusFilter = filter.id; }}
        >{filter.label}<span class="chip-count">{counts[filter.id]}</span></button>
      {/each}
    </div>
    <div class="control-field">
      <label for="service-filter">Search services</label>
      <input id="service-filter" type="search" bind:value={filterQuery} placeholder="Unit, scope, state, or description" />
    </div>
  </div>

  <div role="status" aria-live="polite">
    {#if view.kind === "loading"}
      <p>Loading host services...</p>
    {:else if view.kind === "error"}
      <p class="feedback error" role="alert">{view.message}</p>
    {:else}
      {#if view.kind === "unavailable"}
        <p class="feedback pending">{view.message}</p>
      {/if}
      {#if view.kind === "ready" && view.notice}
        <p class="feedback ok">{view.notice}</p>
      {/if}
      {#if view.kind === "ready" && view.actionError}
        <p class="feedback error" role="alert">{view.actionError}</p>
      {/if}
      {#if !view.inventory.controlAllowlistConfigured}
        <p class="service-hint">Read-only inventory. Owner allowlisting via <code>OS_SERVICE_CONTROL_UNITS</code> is required for lifecycle actions.</p>
      {/if}
      {#if view.inventory.services.length === 0}
        <p>No systemd services reported by the host.</p>
      {:else if visibleServices.length === 0}
        <p>No services match the current filter.</p>
      {:else}
        <ul class="service-list" aria-label="Service inventory">
          {#each visibleServices as svc (serviceKey(svc.scope, svc.unit))}
            {@const key = serviceKey(svc.scope, svc.unit)}
            {@const isBusy = view.kind === "ready" && view.busyKey === key}
            {@const activeConfirm = pending?.key === key ? pending : null}
            <li class="service-row" data-status={serviceStatus(svc)}>
              <div class="service-info">
                <div class="service-heading">
                  <span class="dot" data-status={serviceStatus(svc)} aria-hidden="true"></span>
                  <code>{svc.unit}</code>
                  <span class="pill">{svc.scope}</span>
                  <span class="pill" data-active={svc.active === "active" ? "on" : svc.active === "failed" ? "failed" : "off"}>
                    {svc.active}/{svc.sub}
                  </span>
                  {#if svc.controllable}<span class="pill" data-active="on">allowlisted</span>{/if}
                </div>
                <p class="service-desc">{svc.description || "No description"}</p>
              </div>
              <div class="service-actions">
                <button
                  type="button"
                  disabled={logsBusy}
                  aria-expanded={detail?.unit === svc.unit && detail?.scope === svc.scope}
                  onclick={() => openDetail(svc)}
                >{detail?.unit === svc.unit && detail?.scope === svc.scope ? "Hide" : "Logs"}</button>
                {#if svc.controllable}
                  {#if activeConfirm}
                    <button
                      class={activeConfirm.action === "stop" ? "danger" : "primary"}
                      disabled={isBusy}
                      onclick={() => confirmAction(activeConfirm)}
                    >
                      Confirm {activeConfirm.action}
                    </button>
                    <button disabled={isBusy} onclick={() => { pending = null; }}>Cancel</button>
                  {:else if svc.active === "active"}
                    <button disabled={isBusy} onclick={() => { pending = { key, service: svc, action: "restart" }; }}>Restart</button>
                    <button class="danger" disabled={isBusy} onclick={() => { pending = { key, service: svc, action: "stop" }; }}>Stop</button>
                  {:else}
                    <button class="primary" disabled={isBusy} onclick={() => { pending = { key, service: svc, action: "start" }; }}>Start</button>
                    <button disabled={isBusy} onclick={() => { pending = { key, service: svc, action: "restart" }; }}>Restart</button>
                  {/if}
                {/if}
              </div>
              {#if detail?.unit === svc.unit && detail?.scope === svc.scope}
                <ServiceLogsDrawer
                  service={svc}
                  {logs}
                  busy={logsBusy}
                  error={logsError}
                  onReload={() => void loadLogs(svc)}
                  onClose={closeDetail}
                />
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>
</section>

<style>
  .service-controls { display: grid; gap: 0.75rem; margin: 1rem 0; }
  .filter-chips { display: flex; gap: 0.375rem; flex-wrap: wrap; }
  .chip {
    display: inline-flex; align-items: center; gap: 0.375rem; padding: 0.2rem 0.6rem;
    border-radius: 999px; font-size: 0.8125rem; color: var(--muted);
  }
  .chip[aria-pressed="true"] { background: var(--accent); color: var(--accent-text); border-color: var(--accent); font-weight: 600; }
  .chip-count { font-variant-numeric: tabular-nums; opacity: 0.8; }
  .control-field { display: grid; gap: 0.375rem; min-width: 0; }
  .control-field label { font-size: 0.875rem; font-weight: 600; color: var(--text); }
  .control-field input { width: 100%; min-width: 0; min-height: var(--ui-control-height); }
  .service-hint { margin: 0.5rem 0 0; font-size: 0.875rem; color: var(--muted); }
  .service-list {
    list-style: none; padding: 0; margin: 0.75rem 0 0; display: grid; gap: 0.625rem;
    max-height: 26rem; overflow-y: auto;
  }
  .service-row {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;
    padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel);
  }
  .service-info { display: grid; gap: 0.25rem; min-width: 0; flex: 1 1 14rem; }
  .service-heading { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .service-heading code { font-weight: 600; color: var(--text); overflow-wrap: anywhere; }
  .service-desc { margin: 0; font-size: 0.875rem; color: var(--muted); }
  .dot { width: 0.55rem; height: 0.55rem; border-radius: 999px; background: var(--muted); flex: none; }
  .dot[data-status="active"] { background: var(--ok); }
  .dot[data-status="failed"] { background: var(--danger); }
  .service-actions { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .pill {
    display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border);
    border-radius: 999px; font-size: 0.7rem; color: var(--muted);
  }
  .pill[data-active="on"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-active="failed"] { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
  @media (max-width: 26rem) {
    .service-actions { width: 100%; }
  }
</style>
