<script lang="ts">
  import {
    type CloudflareZone, type DokployProject, type DoctorResult, type InfraProviderRow,
  } from "./infra-workspace-api.ts";
  import {
    createInfraWorkspaceController, type InfraTab, type InfraWorkspaceState,
  } from "./infra-workspace-controller.ts";
  import {
    createIntegrationCatalogController,
    type IntegrationCatalogProvider,
    type IntegrationCatalogState,
  } from "../integrations/integrations-workspace-api.ts";
  import {
    createIntegrationsController,
    type IntegrationsState,
  } from "../integrations/integrations-api.ts";
  import InfraProviderList from "./InfraProviderList.svelte";
  import InfraSetupDrawer from "./InfraSetupDrawer.svelte";

  let { role = null }: { role?: "viewer" | "operator" | "owner" | null } = $props();

  let view = $state<InfraWorkspaceState>({ kind: "loading", tab: "providers" });
  let catalog = $state<IntegrationCatalogState>({ kind: "loading" });
  let bindings = $state<IntegrationsState>({ kind: "loading" });
  let tab = $state<InfraTab>("providers");
  let filterQuery = $state("");
  let setupId = $state<string | null>(null);
  let notice = $state("");
  let doctorRun = $state<DoctorResult[] | null>(null);
  let controller: ReturnType<typeof createInfraWorkspaceController> | undefined;
  let catalogController: ReturnType<typeof createIntegrationCatalogController> | undefined;
  let bindingsController: ReturnType<typeof createIntegrationsController> | undefined;

  let isOwner = $derived(role === "owner");
  let providers = $derived.by<InfraProviderRow[]>(() => (view.kind === "ready" ? view.providers : []));
  let projects = $derived.by<DokployProject[]>(() => (view.kind === "ready" ? view.projects : []));
  let zones = $derived.by<CloudflareZone[]>(() => (view.kind === "ready" ? view.zones : []));
  let doctor = $derived.by<DoctorResult[]>(() => doctorRun ?? (view.kind === "ready" ? view.doctor : []));
  let profiles = $derived.by<string[]>(() => (bindings.kind === "ready" ? bindings.snapshot.users.map((user) => user.id) : []));
  let catalogProviders = $derived.by<IntegrationCatalogProvider[]>(() => (catalog.kind === "ready" ? catalog.providers : []));

  let configuredCount = $derived(providers.filter((row) => row.configured).length);
  let doctorFailures = $derived(doctor.filter((row) => row.ok === false).length);
  let doctorById = $derived.by<Map<string, DoctorResult>>(() => {
    const map = new Map<string, DoctorResult>();
    for (const row of doctor) map.set(row.id, row);
    return map;
  });
  let selectedSetup = $derived.by<IntegrationCatalogProvider | null>(
    () => catalogProviders.find((provider) => provider.id === setupId) ?? null,
  );

  let stateTag = $derived.by(() => {
    if (!isOwner) return "owner-only";
    if (view.kind !== "ready") return view.kind;
    if (tab === "providers") return providers.length === 0 ? "empty" : "ready";
    if (tab === "dokploy") return projects.length === 0 ? "empty" : "ready";
    return zones.length === 0 ? "empty" : "ready";
  });

  export function refresh() {
    if (!isOwner) return;
    notice = "";
    doctorRun = null;
    void controller?.refresh();
    void catalogController?.refresh();
    void bindingsController?.refresh();
  }

  function switchTab(next: InfraTab) {
    if (tab === next) return;
    tab = next;
    doctorRun = null;
  }

  async function runDiagnostics() {
    if (!controller || !isOwner) return;
    notice = "";
    const results = await controller.runDoctor(null);
    doctorRun = results;
    notice = results.length === 0
      ? "Diagnostics did not return a result. Retry when the backend responds."
      : `${results.filter((row) => row.ok === true).length} of ${results.length} providers passed diagnostics.`;
  }

  function onSetupSaved(message: string) {
    notice = message;
    setupId = null;
    void controller?.refresh();
  }

  function inventoryTone(): "ok" | "danger" {
    return doctorFailures === 0 ? "ok" : "danger";
  }

  $effect(() => {
    if (!isOwner) {
      controller?.dispose();
      catalogController?.dispose();
      bindingsController?.dispose();
      controller = undefined;
      catalogController = undefined;
      bindingsController = undefined;
      setupId = null;
      return;
    }
    const nextInfra = createInfraWorkspaceController((state) => { view = state; });
    const nextCatalog = createIntegrationCatalogController((state) => { catalog = state; });
    const nextBindings = createIntegrationsController((state) => { bindings = state; });
    controller = nextInfra;
    catalogController = nextCatalog;
    bindingsController = nextBindings;
    void nextInfra.refresh();
    void nextCatalog.refresh();
    void nextBindings.refresh();
    return () => {
      nextInfra.dispose();
      nextCatalog.dispose();
      nextBindings.dispose();
      if (controller === nextInfra) controller = undefined;
      if (catalogController === nextCatalog) catalogController = undefined;
      if (bindingsController === nextBindings) bindingsController = undefined;
    };
  });
</script>

<section aria-labelledby="infra-title" aria-busy={view.kind === "loading"} data-infra-state={stateTag} data-infra-tab={tab}>
  <header class="feature-header">
    <div class="infra-title-group">
      <h2 id="infra-title">Infrastructure</h2>
      {#if isOwner && providers.length > 0}
        <span class="pill" data-tone={configuredCount === providers.length ? "ok" : "warn"}>
          {configuredCount} of {providers.length} configured
        </span>
        {#if doctor.length > 0}
          <span class="pill" data-tone={inventoryTone()}>{doctorFailures} diagnostic failure(s)</span>
        {/if}
      {/if}
    </div>
    {#if isOwner}
      <div class="actions">
        <button type="button" disabled={view.kind === "loading"} onclick={refresh}>
          {view.kind === "loading" ? "Loading..." : "Refresh"}
        </button>
        <button type="button" disabled={view.kind !== "ready"} onclick={() => void runDiagnostics()}>
          {view.kind === "ready" && view.doctorBusy ? "Running doctor..." : "Run doctor"}
        </button>
      </div>
    {/if}
  </header>

  {#if !isOwner}
    <p class="feedback pending" role="status">
      Owner role is required to inspect providers, deployment inventory and diagnostics. Sign in from an Owner device
      to view infrastructure.
    </p>
  {:else}
    <div class="infra-tabs" role="tablist" aria-label="Infrastructure views">
      <button type="button" role="tab" aria-selected={tab === "providers"} class:primary={tab === "providers"} onclick={() => switchTab("providers")}>
        Providers
      </button>
      <button type="button" role="tab" aria-selected={tab === "dokploy"} class:primary={tab === "dokploy"} onclick={() => switchTab("dokploy")}>
        Dokploy
      </button>
      <button type="button" role="tab" aria-selected={tab === "cloudflare"} class:primary={tab === "cloudflare"} onclick={() => switchTab("cloudflare")}>
        Cloudflare
      </button>
    </div>

    {#if notice}<p class="feedback ok" role="status">{notice}</p>{/if}

    <div role="status" aria-live="polite">
      {#if view.kind === "loading"}
        <p>Loading infrastructure providers...</p>
      {:else if view.kind === "error"}
        <p class="feedback error" role="alert">{view.message}</p>
        <div class="actions"><button type="button" onclick={refresh}>Retry</button></div>
      {:else if tab === "providers"}
        <InfraProviderList rows={providers} {doctorById} bind:filterQuery onSelect={(id) => { setupId = setupId === id ? null : id; }} />
      {:else if tab === "dokploy"}
        {#if !providers.some((row) => row.id === "dokploy" && row.configured)}
          <p class="infra-meta">Dokploy is not configured. Configure it in the Providers tab first.</p>
        {:else if view.inventoryError}
          <p class="feedback error" role="alert">{view.inventoryError}</p>
        {:else if projects.length === 0}
          <p>No Dokploy projects returned for this connection.</p>
        {:else}
          <ul class="infra-inventory" aria-label="Dokploy projects">
            {#each projects as project (project.projectId)}
              <li><strong>{project.name}</strong><code>{project.projectId}</code></li>
            {/each}
          </ul>
        {/if}
      {:else if !providers.some((row) => row.id === "cloudflare" && row.configured)}
        <p class="infra-meta">Cloudflare is not configured. Configure it in the Providers tab first.</p>
      {:else if view.inventoryError}
        <p class="feedback error" role="alert">{view.inventoryError}</p>
      {:else if zones.length === 0}
        <p>No Cloudflare zones are reachable with this token.</p>
      {:else}
        <ul class="infra-inventory" aria-label="Cloudflare zones">
          {#each zones as zone (zone.id)}
            <li><strong>{zone.name}</strong><code>{zone.id}</code></li>
          {/each}
        </ul>
      {/if}
    </div>

    {#if selectedSetup}
      <InfraSetupDrawer
        provider={selectedSetup}
        users={profiles}
        onClose={() => { setupId = null; }}
        onSaved={onSetupSaved}
      />
    {/if}

    {#if doctor.length > 0}
      <div class="infra-doctor">
        <h3>Doctor results</h3>
        <ul>
          {#each doctor as row (`${row.id}:${row.detail}`)}
            <li data-tone={row.ok === true ? "ok" : row.ok === false ? "danger" : "warn"}>
              <strong>{row.id}</strong>
              <span class="pill" data-tone={row.ok === true ? "ok" : row.ok === false ? "danger" : "warn"}>
                {row.ok === true ? "healthy" : row.ok === false ? "failing" : "not configured"}
              </span>
              <p>{row.detail}</p>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  {/if}
</section>

<style>
  .infra-title-group { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .infra-tabs { display: flex; gap: 0.375rem; flex-wrap: wrap; margin: 0.875rem 0 0; }
  .infra-tabs button { font-size: 0.8125rem; padding: 0.25rem 0.625rem; }
  .infra-meta { margin: 0; font-size: 0.8125rem; color: var(--muted); overflow-wrap: anywhere; }
  .infra-inventory { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.375rem; }
  .infra-inventory li { display: flex; gap: 0.5rem; align-items: baseline; justify-content: space-between; flex-wrap: wrap; padding: 0.5rem 0.625rem; border: 1px solid var(--border); border-radius: 0.375rem; background: var(--panel); min-width: 0; }
  .infra-inventory code { font-size: 0.7rem; color: var(--muted); overflow-wrap: anywhere; }
  .infra-doctor { display: grid; gap: 0.5rem; }
  .infra-doctor h3 { margin: 0; font-size: 0.8125rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
  .infra-doctor ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.375rem; }
  .infra-doctor li { padding: 0.5rem 0.625rem; border: 1px solid var(--border); border-radius: 0.375rem; background: var(--panel); min-width: 0; }
  .infra-doctor li[data-tone="danger"] { border-color: color-mix(in srgb, var(--danger) 45%, var(--border)); }
  .infra-doctor li[data-tone="ok"] { border-color: color-mix(in srgb, var(--ok) 45%, var(--border)); }
  .infra-doctor p { margin: 0.25rem 0 0; font-size: 0.75rem; color: var(--muted); overflow-wrap: anywhere; }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.7rem; color: var(--muted); }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
  .pill[data-tone="danger"] { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
  section { display: grid; gap: 0.75rem; align-content: start; }
  @media (max-width: 420px) {
    .infra-tabs button { flex: 1 1 auto; }
    .actions button { flex: 1 1 100%; }
  }
</style>
