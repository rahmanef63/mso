<script lang="ts">
  import { onMount } from "svelte";
  import {
    createServicesController,
    serviceKey,
    type ServiceAction,
    type ServicesState,
    type SystemService,
  } from "./services-api";

  type PendingConfirmation = { key: string; service: SystemService; action: ServiceAction };

  let view = $state<ServicesState>({ kind: "loading" });
  let filterQuery = $state("");
  let pending = $state<PendingConfirmation | null>(null);
  let controller: ReturnType<typeof createServicesController> | undefined;

  let visibleServices = $derived.by<SystemService[]>(() => {
    if (view.kind !== "ready") return [];
    const q = filterQuery.trim().toLowerCase();
    if (!q) return view.inventory.services;
    return view.inventory.services.filter((svc) =>
      `${svc.unit} ${svc.scope} ${svc.active} ${svc.sub} ${svc.description}`.toLowerCase().includes(q));
  });

  let stateTag = $derived.by(() => {
    if (view.kind !== "ready") return view.kind;
    if (view.inventory.services.length === 0) return "empty";
    return visibleServices.length === 0 ? "no-filter-matches" : "ready";
  });

  export function refresh() {
    pending = null;
    void controller?.refresh();
  }

  function confirmAction(item: PendingConfirmation) {
    pending = null;
    void controller?.trigger(item.service.scope, item.service.unit, item.action);
  }

  onMount(() => {
    controller = createServicesController((next) => {
      if (next.kind !== "ready") pending = null;
      view = next;
    });
    void controller.refresh();
    return () => controller?.dispose();
  });
</script>

<section aria-labelledby="services-title" aria-busy={view.kind === "loading"} data-services-state={stateTag}>
  <header class="feature-header">
    <h2 id="services-title">Services</h2>
    <button disabled={view.kind === "loading"} onclick={refresh}>
      {view.kind === "loading" ? "Loading..." : "Refresh services"}
    </button>
  </header>

  <div class="service-filter-wrap">
    <label for="service-filter">Filter services</label>
    <input id="service-filter" type="search" bind:value={filterQuery} placeholder="Unit, scope, state, or description" />
  </div>

  <div role="status" aria-live="polite">
    {#if view.kind === "loading"}
      <p>Loading host services...</p>
    {:else if view.kind === "unavailable"}
      <p class="feedback pending">{view.message}</p>
    {:else if view.kind === "error"}
      <p class="feedback error" role="alert">{view.message}</p>
    {:else}
      {#if view.notice}
        <p class="feedback ok">{view.notice}</p>
      {/if}
      {#if view.actionError}
        <p class="feedback error" role="alert">{view.actionError}</p>
      {/if}
      {#if !view.inventory.controlAllowlistConfigured}
        <p class="service-hint">Read-only inventory. Owner allowlisting via <code>OS_SERVICE_CONTROL_UNITS</code> is required for lifecycle actions.</p>
      {/if}
      {#if view.inventory.services.length === 0}
        <p>No systemd services reported by the host.</p>
      {:else if visibleServices.length === 0}
        <p>No services match "{filterQuery.trim()}".</p>
      {:else}
        <ul class="service-list" aria-label="Service inventory">
          {#each visibleServices as svc (serviceKey(svc.scope, svc.unit))}
            {@const key = serviceKey(svc.scope, svc.unit)}
            {@const isBusy = view.busyKey === key}
            {@const activeConfirm = pending?.key === key ? pending : null}
            <li class="service-row">
              <div class="service-info">
                <div class="service-heading">
                  <code>{svc.unit}</code>
                  <span class="pill">{svc.scope}</span>
                  <span class="pill" data-active={svc.active === "active" ? "on" : svc.active === "failed" ? "failed" : "off"}>
                    {svc.active}/{svc.sub}
                  </span>
                </div>
                <p class="service-desc">{svc.description || "No description"}</p>
              </div>
              {#if svc.controllable}
                <div class="service-actions">
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
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>
</section>

<style>
  .service-filter-wrap { display: grid; gap: 0.375rem; margin: 1rem 0; }
  .service-filter-wrap label { font-size: 0.875rem; font-weight: 600; color: var(--text); }
  .service-filter-wrap input { width: 100%; min-width: 0; min-height: var(--ui-control-height); }
  .service-hint { margin: 0.5rem 0 0; font-size: 0.875rem; color: var(--muted); }
  .service-list {
    list-style: none; padding: 0; margin: 0.75rem 0 0; display: grid; gap: 0.625rem;
    max-height: 24rem; overflow-y: auto;
  }
  .service-row {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;
    padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel);
  }
  .service-info { display: grid; gap: 0.25rem; min-width: 0; flex: 1 1 14rem; }
  .service-heading { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .service-heading code { font-weight: 600; color: var(--text); }
  .service-desc { margin: 0; font-size: 0.875rem; color: var(--muted); }
  .service-actions { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .pill {
    display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border);
    border-radius: 999px; font-size: 0.75rem; color: var(--muted);
  }
  .pill[data-active="on"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-active="failed"] { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
</style>
