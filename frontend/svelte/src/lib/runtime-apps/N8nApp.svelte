<script lang="ts">
  import { onMount } from "svelte";
  import { ApiError, readN8nApp, safeDashboardUrl, type ManagedAppItem } from "./runtime-apps-api.ts";

  type N8nView =
    | { kind: "loading" }
    | { kind: "ready"; app: ManagedAppItem | null }
    | { kind: "error"; message: string };

  let view = $state<N8nView>({ kind: "loading" });
  let frameTick = $state(0);
  let frameError = $state<string | null>(null);
  let activeController: AbortController | undefined;
  let generation = 0;

  let app = $derived(view.kind === "ready" ? view.app : null);
  let dashboardHref = $derived.by<string | null>(() => {
    if (!app || !app.dashboardAvailable) return null;
    return safeDashboardUrl(app.publicDashboardUrl);
  });
  let installed = $derived(Boolean(app?.installed) && app?.state !== "not-installed");
  let live = $derived(installed && app?.state === "running" && app?.healthy !== false);

  function tone(target: ManagedAppItem | null): "ok" | "danger" | "warn" | "neutral" {
    if (!target || !target.installed) return "warn";
    if (target.state === "running" && target.healthy !== false) return "ok";
    if (target.state === "unhealthy" || target.state === "error" || target.healthy === false) return "danger";
    if (target.state === "starting") return "warn";
    return "neutral";
  }

  async function loadN8n() {
    const run = ++generation;
    activeController?.abort();
    const ctrl = (activeController = new AbortController());
    if (view.kind !== "ready") view = { kind: "loading" };
    try {
      const next = await readN8nApp(ctrl.signal);
      if (run === generation && !ctrl.signal.aborted) view = { kind: "ready", app: next };
    } catch (err) {
      if (run === generation && !ctrl.signal.aborted) {
        view = { kind: "error", message: err instanceof ApiError ? err.message : "Could not load n8n status. Check the backend and retry." };
      }
    }
  }

  function reloadFrame() {
    frameError = null;
    frameTick += 1;
  }

  export function refresh() { void loadN8n(); }

  onMount(() => {
    void loadN8n();
    return () => { generation++; activeController?.abort(); };
  });
</script>

<section class="n8n" aria-labelledby="n8n-title" aria-busy={view.kind === "loading"} data-n8n-state={view.kind}>
  <header class="n8n-bar">
    <div class="n8n-id">
      <span class="n8n-mark" aria-hidden="true">n8n</span>
      <h2 id="n8n-title">Workflow Automation</h2>
      {#if view.kind === "ready"}
        <span class="pill" data-tone={tone(app)}>{app ? app.state : "not installed"}</span>
        {#if app?.healthy !== null && app?.healthy !== undefined}
          <span class="pill" data-tone={app.healthy ? "ok" : "danger"}>{app.healthy ? "healthy" : "unhealthy"}</span>
        {/if}
        {#if app?.version}<span class="pill">v{app.version.replace(/^v/i, "")}</span>{/if}
      {/if}
    </div>
    <div class="n8n-actions">
      <button type="button" class="n8n-small" disabled={view.kind === "loading"} onclick={refresh}>
        {view.kind === "loading" ? "Checking..." : "Refresh status"}
      </button>
      {#if live && dashboardHref}
        <button type="button" class="n8n-small" onclick={reloadFrame}>Reload editor</button>
        <a class="n8n-link" href={dashboardHref} target="_blank" rel="noopener noreferrer">Open externally</a>
      {/if}
    </div>
  </header>

  {#if view.kind === "loading" && !app}
    <p class="n8n-note" role="status">Checking n8n status on the host...</p>
  {:else if view.kind === "error"}
    <p class="feedback error" role="alert">{view.message}</p>
  {:else if !installed}
    <div class="n8n-fallback">
      <strong>n8n is not installed as a managed app on this host.</strong>
      <ol>
        <li>Install n8n through a container runtime or a systemd unit registered with MSO managed apps.</li>
        <li>Confirm it appears as installed in Managed Apps and reports a dashboard URL.</li>
        <li>Refresh status above, then the embedded editor loads in this bar.</li>
      </ol>
      {#if app?.diagnostic}<p class="n8n-diag">{app.diagnostic}</p>{/if}
    </div>
  {:else if !app?.dashboardAvailable || !dashboardHref}
    <div class="n8n-fallback">
      <strong>n8n is installed but has no reachable dashboard address.</strong>
      <p>Start n8n, or configure its public dashboard URL on the host, then refresh status.</p>
      {#if app?.diagnostic}<p class="n8n-diag">{app.diagnostic}</p>{/if}
      {#if app?.domainDiagnostic}<p class="n8n-diag">{app.domainDiagnostic}</p>{/if}
    </div>
  {:else if !live}
    <div class="n8n-fallback">
      <strong>n8n is {app?.state || "not running"}.</strong>
      <p>Start it from Managed Apps. The embedded editor reloads here once it reports healthy.</p>
      {#if app?.diagnostic}<p class="n8n-diag">{app.diagnostic}</p>{/if}
    </div>
  {:else}
    {#if frameError}<p class="feedback error" role="alert">{frameError}</p>{/if}
    <div class="n8n-frame">
      {#key frameTick}
        <iframe
          src={`${dashboardHref}#embed-${frameTick}`}
          title="n8n workflow editor"
          allow="clipboard-read; clipboard-write; fullscreen"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
          onload={() => { frameError = null; }}
          onerror={() => { frameError = "The n8n editor could not be framed. Open it externally instead."; }}
        ></iframe>
      {/key}
    </div>
    <p class="n8n-note">
      n8n may refuse framing through its own headers. If the pane stays blank, use Open externally.
    </p>
  {/if}
</section>

<style>
  .n8n { display: grid; gap: 0.625rem; min-width: 0; }
  .n8n-bar {
    display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap;
    padding: 0.5rem 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel);
  }
  .n8n-id, .n8n-actions { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; min-width: 0; }
  .n8n-mark {
    display: inline-grid; place-items: center; width: 2rem; height: 2rem; border-radius: 0.375rem;
    background: var(--accent); color: var(--accent-text); font-size: 0.6875rem; font-weight: 700;
  }
  .n8n-bar h2 { margin: 0; font-size: 0.9375rem; }
  .n8n-small { font-size: 0.75rem; padding: 0.1875rem 0.5rem; }
  .n8n-link {
    display: inline-flex; align-items: center; min-height: 2rem; padding: 0.1875rem 0.625rem;
    border: 1px solid var(--accent); border-radius: 0.375rem; background: var(--accent);
    color: var(--accent-text); font-size: 0.75rem; font-weight: 600; text-decoration: none; white-space: nowrap;
  }
  .n8n-frame { border: 1px solid var(--border); border-radius: 0.5rem; overflow: hidden; background: var(--surface); }
  .n8n-frame iframe { display: block; width: 100%; height: clamp(20rem, 62vh, 48rem); border: 0; }
  .n8n-fallback {
    display: grid; gap: 0.5rem; padding: 1rem; border: 1px dashed var(--border);
    border-radius: 0.5rem; background: var(--surface);
  }
  .n8n-fallback ol { margin: 0; padding-left: 1.25rem; display: grid; gap: 0.375rem; font-size: 0.8125rem; }
  .n8n-fallback p, .n8n-note { margin: 0; font-size: 0.8125rem; color: var(--muted); }
  .n8n-diag { color: var(--warn); overflow-wrap: anywhere; }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="danger"] { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
  @media (max-width: 400px) {
    .n8n-actions { width: 100%; }
    .n8n-actions button, .n8n-actions a { flex: 1 1 calc(50% - 0.25rem); justify-content: center; }
  }
</style>
