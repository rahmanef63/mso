<script lang="ts">
  import { brandFor, loopbackUrl } from "./appdeck-catalog";
  import { appTone, isRunning, lifecycleActions } from "./appdeck-view";
  import { safeDashboardUrl, type ManagedAppItem } from "./managed-apps-api";

  let {
    app,
    selected = false,
    busy = false,
    onopen,
    onstart,
    onstop,
  }: {
    app: ManagedAppItem;
    selected?: boolean;
    busy?: boolean;
    onopen: (id: string) => void;
    onstart: (id: string) => void;
    onstop: (id: string) => void;
  } = $props();

  let confirmStop = $state(false);
  let brand = $derived(brandFor(app.id, app.name));
  let tone = $derived(appTone(app));
  let running = $derived(isRunning(app));
  let actions = $derived(lifecycleActions(app, app.supportedActions));
  let dashboard = $derived(app.dashboardAvailable ? safeDashboardUrl(app.publicDashboardUrl) : null);
  let loopback = $derived(loopbackUrl(brand.port));
</script>

<article class="app-card" data-tone={tone} data-selected={selected ? "true" : "false"}>
  <div class="card-head">
    <span class="mark" style={`background:${brand.gradient}`} aria-hidden="true">{brand.glyph}</span>
    <div class="card-title">
      <h3>{brand.name}</h3>
      <p class="tagline">{brand.tagline}</p>
    </div>
    <span class="health" data-tone={tone}>
      <span class="dot" aria-hidden="true"></span>
      {app.state}
    </span>
  </div>

  {#if app.description}
    <p class="desc">{app.description}</p>
  {/if}

  <dl class="facts">
    {#if app.version}
      <div><dt>Version</dt><dd><code>{app.version.replace(/^v/i, "")}</code></dd></div>
    {/if}
    <div><dt>Runtime</dt><dd>{app.installed ? app.installationType : "not installed"}</dd></div>
    {#if running && brand.port > 0}
      <div><dt>Port</dt><dd><code>{brand.port}</code></dd></div>
    {/if}
    {#if app.domainDiagnostic}
      <div class="wide"><dt>Domain</dt><dd>{app.domainDiagnostic}</dd></div>
    {/if}
  </dl>

  {#if app.diagnostic}
    <p class="diag" role="note">{app.diagnostic}</p>
  {/if}

  <div class="card-actions">
    {#if app.installed && actions.start}
      <button class="primary" disabled={busy} onclick={() => onstart(app.id)}>Start</button>
    {/if}
    {#if actions.stop}
      {#if confirmStop}
        <button class="danger" disabled={busy} onclick={() => { confirmStop = false; onstop(app.id); }}>
          Confirm stop
        </button>
        <button class="ghost" onclick={() => { confirmStop = false; }}>Cancel</button>
      {:else}
        <button disabled={busy} onclick={() => { confirmStop = true; }}>Stop</button>
      {/if}
    {/if}
    {#if dashboard}
      <a class="link" href={dashboard} target="_blank" rel="noopener noreferrer">Open</a>
    {:else if running && loopback}
      <a class="link" href={loopback} target="_blank" rel="noopener noreferrer">Open</a>
    {/if}
    <button class="ghost" disabled={busy} onclick={() => onopen(app.id)} aria-pressed={selected}>
      Details
    </button>
  </div>

</article>

<style>
  .app-card {
    display: grid; gap: 0.625rem; min-width: 0; padding: 0.875rem;
    border: 1px solid var(--border); border-radius: 0.75rem; background: var(--panel);
  }
  .app-card[data-selected="true"] { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
  .card-head { display: flex; align-items: flex-start; gap: 0.625rem; min-width: 0; }
  .mark {
    display: inline-grid; place-items: center; flex: 0 0 auto; width: 2.25rem; height: 2.25rem;
    border-radius: 0.625rem; color: #fff; font-size: 0.875rem; font-weight: 700;
  }
  .card-title { display: grid; gap: 0.125rem; min-width: 0; flex: 1 1 auto; }
  .card-title h3 { margin: 0; font-size: 1rem; line-height: 1.25; color: var(--text); overflow-wrap: anywhere; }
  .tagline { margin: 0; font-size: 0.8125rem; color: var(--muted); }
  .health {
    display: inline-flex; align-items: center; gap: 0.375rem; flex: 0 0 auto;
    font-size: 0.75rem; color: var(--muted); text-transform: capitalize;
  }
  .dot { width: 0.5rem; height: 0.5rem; border-radius: 999px; background: var(--muted); }
  .health[data-tone="ok"] .dot { background: var(--ok); }
  .health[data-tone="danger"] .dot { background: var(--danger); }
  .health[data-tone="warn"] .dot { background: var(--warn); }
  .desc { margin: 0; font-size: 0.875rem; color: var(--muted); overflow-wrap: anywhere; }
  .facts { display: flex; flex-wrap: wrap; gap: 0.375rem 1rem; margin: 0; font-size: 0.8125rem; }
  .facts div { display: flex; gap: 0.375rem; min-width: 0; }
  .facts .wide { flex: 1 1 100%; }
  .facts dt { color: var(--muted); }
  .facts dd { margin: 0; color: var(--text); overflow-wrap: anywhere; }
  .diag { margin: 0; font-size: 0.8125rem; color: var(--warn); }
  .card-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .card-actions button, .link {
    display: inline-flex; align-items: center; justify-content: center; min-height: 2rem;
    padding: 0 0.75rem; border: 1px solid var(--border); border-radius: 0.375rem;
    background: var(--panel-solid); color: var(--text); font-size: 0.8125rem; font-weight: 600;
    text-decoration: none; cursor: pointer;
  }
  .card-actions .primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
  .card-actions .danger { border-color: var(--danger); color: var(--danger); background: var(--danger-bg); }
  .card-actions .ghost { background: transparent; }
  .card-actions button:disabled { opacity: 0.55; cursor: not-allowed; }
  @media (max-width: 400px) {
    .card-head { flex-wrap: wrap; }
    .health { order: 3; }
  }
</style>
