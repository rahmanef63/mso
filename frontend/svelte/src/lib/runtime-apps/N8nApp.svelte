<script lang="ts">
  import { onMount } from "svelte";
  import {
    ApiError,
    readN8nApp,
    safeDashboardUrl,
    type ManagedAppItem,
  } from "./runtime-apps-api.ts";

  type N8nView =
    | { kind: "loading" }
    | { kind: "ready"; app: ManagedAppItem | null }
    | { kind: "error"; message: string };

  let view = $state<N8nView>({ kind: "loading" });
  let activeController: AbortController | undefined;
  let generation = 0;

  let dashboardHref = $derived.by<string | null>(() => {
    if (view.kind !== "ready" || !view.app || !view.app.dashboardAvailable) return null;
    return safeDashboardUrl(view.app.publicDashboardUrl);
  });

  function stateTone(app: ManagedAppItem): "ok" | "danger" | "warn" | "neutral" {
    if (app.state === "running" && app.healthy !== false) return "ok";
    if (app.state === "unhealthy" || app.state === "error" || app.healthy === false) return "danger";
    if (app.state === "starting") return "warn";
    return "neutral";
  }

  async function loadN8n() {
    const run = ++generation;
    activeController?.abort();
    const ctrl = (activeController = new AbortController());
    view = { kind: "loading" };
    try {
      const app = await readN8nApp(ctrl.signal);
      if (run === generation && !ctrl.signal.aborted) {
        view = { kind: "ready", app };
      }
    } catch (err) {
      if (run === generation && !ctrl.signal.aborted) {
        view = {
          kind: "error",
          message: err instanceof ApiError ? err.message : "Could not load n8n status. Check the backend and retry.",
        };
      }
    }
  }

  export function refresh() {
    void loadN8n();
  }

  onMount(() => {
    void loadN8n();
    return () => {
      generation++;
      activeController?.abort();
    };
  });
</script>

<section aria-labelledby="n8n-title" aria-busy={view.kind === "loading"} data-n8n-state={view.kind}>
  <header class="feature-header">
    <div class="n8n-title-group">
      <h2 id="n8n-title">n8n Automation</h2>
      {#if view.kind === "ready" && view.app}
        <span class="pill" data-tone={stateTone(view.app)}>{view.app.state}</span>
      {:else if view.kind === "ready"}
        <span class="pill" data-tone="neutral">not installed</span>
      {/if}
    </div>
    <button type="button" disabled={view.kind === "loading"} onclick={refresh}>
      {view.kind === "loading" ? "Loading..." : "Refresh"}
    </button>
  </header>

  <div role="status" aria-live="polite">
    {#if view.kind === "loading"}
      <p>Checking n8n status on the host...</p>
    {:else if view.kind === "error"}
      <p class="feedback error" role="alert">{view.message}</p>
    {:else if !view.app || !view.app.installed || view.app.state === "not-installed"}
      <div class="n8n-card">
        <div class="n8n-pills">
          <span class="pill" data-tone="warn">not installed</span>
          <code>n8n</code>
        </div>
        <p class="n8n-desc">
          n8n is not currently installed as a managed application on this host.
        </p>
        <ol class="n8n-steps">
          <li>Install n8n on the host using Docker or a systemd service configured for MSO managed apps.</li>
          <li>Verify the service appears as installed in Managed Apps and exposes a local or public dashboard URL.</li>
          <li>Click Refresh above to check live health and open the n8n dashboard.</li>
        </ol>
        {#if view.app?.diagnostic}
          <p class="n8n-diag">{view.app.diagnostic}</p>
        {/if}
      </div>
    {:else}
      {@const app = view.app}
      <div class="n8n-card">
        <div class="n8n-row">
          <div class="n8n-info">
            <div class="n8n-pills">
              <strong>{app.name}</strong>
              <code>{app.id}</code>
              <span class="pill" data-tone={stateTone(app)}>{app.state}</span>
              <span class="pill">{app.installationType}</span>
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
              <p class="n8n-desc">{app.description}</p>
            {/if}
            {#if app.diagnostic}
              <p class="n8n-diag">{app.diagnostic}</p>
            {/if}
            {#if app.domainDiagnostic}
              <p class="n8n-diag">{app.domainDiagnostic}</p>
            {/if}
          </div>
          {#if dashboardHref}
            <a class="dash-link" href={dashboardHref} target="_blank" rel="noopener noreferrer">
              Open n8n Dashboard
            </a>
          {/if}
        </div>
        {#if !dashboardHref}
          <p class="n8n-hint">
            Dashboard link is not available yet. Start n8n or configure its public dashboard URL in Managed Apps.
          </p>
        {/if}
      </div>
    {/if}
  </div>
</section>

<style>
  .n8n-title-group, .n8n-pills { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .n8n-card {
    display: grid; gap: 0.75rem; margin-top: 1rem; padding: 1rem;
    border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel);
  }
  .n8n-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap; }
  .n8n-info { display: grid; gap: 0.375rem; min-width: 0; flex: 1 1 14rem; }
  .n8n-desc, .n8n-hint { margin: 0; font-size: 0.875rem; color: var(--muted); }
  .n8n-diag { margin: 0; font-size: 0.8125rem; color: var(--warn); overflow-wrap: anywhere; }
  .n8n-steps { margin: 0; padding-left: 1.25rem; display: grid; gap: 0.375rem; font-size: 0.875rem; color: var(--text); }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="danger"] { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
  .dash-link {
    display: inline-flex; align-items: center; min-height: var(--ui-control-height); padding: 0.5rem 0.875rem;
    border: 1px solid var(--accent); border-radius: 0.375rem; background: var(--accent); color: var(--accent-text);
    font-size: 0.875rem; font-weight: 600; text-decoration: none; white-space: nowrap;
  }
</style>
