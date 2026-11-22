<script lang="ts">
  import { onMount } from "svelte";
  import {
    ApiError, readCamoufoxSession, readCamoufoxStatus, safeViewerHref, setCamoufoxPower,
    type CamoufoxPowerAction, type CamoufoxSession, type CamoufoxStatus,
  } from "./runtime-apps-api.ts";

  type CamoufoxView =
    | { kind: "loading" }
    | { kind: "ready"; status: CamoufoxStatus; session: CamoufoxSession | null; sessionNote: string | null }
    | { kind: "error"; message: string };

  let { role = null }: { role?: "viewer" | "operator" | "owner" | null } = $props();
  let view = $state<CamoufoxView>({ kind: "loading" });
  let busy = $state(false);
  let confirmStop = $state(false);
  let notice = $state<string | null>(null);
  let actionError = $state<string | null>(null);
  let activeController: AbortController | undefined;
  let generation = 0;

  let canControl = $derived(role === "operator" || role === "owner");
  let viewerHref = $derived.by<string | null>(() =>
    view.kind === "ready" && view.session
      ? safeViewerHref(view.session.viewerOrigin, view.session.viewerPathPrefix)
      : null);

  async function loadCamoufox() {
    const run = ++generation;
    activeController?.abort();
    const ctrl = (activeController = new AbortController());
    view = { kind: "loading" };
    confirmStop = false;
    actionError = null;
    try {
      const status = await readCamoufoxStatus(ctrl.signal);
      let session: CamoufoxSession | null = null;
      let sessionNote: string | null = null;
      if (canControl) {
        try {
          session = await readCamoufoxSession(ctrl.signal);
        } catch (err) {
          if (ctrl.signal.aborted) return;
          sessionNote = err instanceof ApiError ? err.message : "Viewer session details are unavailable on this host.";
        }
      }
      if (run === generation && !ctrl.signal.aborted) view = { kind: "ready", status, session, sessionNote };
    } catch (err) {
      if (run === generation && !ctrl.signal.aborted) {
        view = { kind: "error", message: err instanceof ApiError ? err.message : "Could not load Camoufox browser status." };
      }
    }
  }

  async function handlePower(action: CamoufoxPowerAction) {
    if (!canControl || busy) return;
    busy = true;
    confirmStop = false;
    notice = null;
    actionError = null;
    try {
      const nextStatus = await setCamoufoxPower(action, new AbortController().signal);
      notice = action === "start" ? "Camoufox display started." : "Camoufox display stopped.";
      if (view.kind === "ready") view = { ...view, status: nextStatus };
      await loadCamoufox();
    } catch (err) {
      actionError = err instanceof ApiError ? err.message : `Could not ${action} Camoufox display.`;
    } finally {
      busy = false;
    }
  }

  export function refresh() { void loadCamoufox(); }

  onMount(() => {
    void loadCamoufox();
    return () => { generation++; activeController?.abort(); };
  });
</script>

<section aria-labelledby="camoufox-title" aria-busy={view.kind === "loading" || busy} data-camoufox-state={view.kind}>
  <header class="feature-header">
    <div class="cf-title-group">
      <h2 id="camoufox-title">Camoufox Browser</h2>
      {#if view.kind === "ready"}
        <span class="pill" data-tone={view.status.running ? "ok" : "neutral"}>
          {view.status.running ? "running" : "stopped"}
        </span>
      {/if}
    </div>
    <button type="button" disabled={view.kind === "loading" || busy} onclick={refresh}>
      {view.kind === "loading" ? "Loading..." : "Refresh"}
    </button>
  </header>

  <div role="status" aria-live="polite">
    {#if view.kind === "loading"}
      <p>Loading Camoufox browser service status...</p>
    {:else if view.kind === "error"}
      <p class="feedback error" role="alert">{view.message}</p>
    {:else}
      {#if notice}<p class="feedback ok">{notice}</p>{/if}
      {#if actionError}<p class="feedback error" role="alert">{actionError}</p>{/if}

      <div class="cf-card">
        <div class="cf-row">
          <div class="cf-meta-group">
            <div class="cf-pills">
              <span class="pill" data-tone={view.status.running ? "ok" : "neutral"}>{view.status.running ? "Active" : "Inactive"}</span>
              {#if view.status.installed === false}<span class="pill" data-tone="warn">not installed</span>{/if}
              {#if view.status.enabled !== undefined}<span class="pill">{view.status.enabled ? "autostart enabled" : "on-demand"}</span>{/if}
              {#if view.status.viewerReady !== undefined}
                <span class="pill" data-tone={view.status.viewerReady ? "ok" : "neutral"}>
                  {view.status.viewerReady ? "viewer ready" : "viewer offline"}
                </span>
              {/if}
              {#if view.status.activeState}<span class="pill">{view.status.activeState}</span>{/if}
              {#if view.status.unit}<code>{view.status.unit}</code>{/if}
            </div>
            {#if view.status.detail}<p class="cf-note">{view.status.detail}</p>{/if}
          </div>

          {#if canControl && view.status.installed !== false}
            <div class="cf-actions">
              {#if view.status.running}
                {#if confirmStop}
                  <button type="button" class="danger" disabled={busy} onclick={() => void handlePower("stop")}>Confirm stop</button>
                  <button type="button" disabled={busy} onclick={() => { confirmStop = false; }}>Cancel</button>
                {:else}
                  <button type="button" class="danger" disabled={busy} onclick={() => { confirmStop = true; }}>Stop</button>
                {/if}
              {:else}
                <button type="button" class="primary" disabled={busy} onclick={() => void handlePower("start")}>
                  {busy ? "Starting..." : "Start"}
                </button>
              {/if}
            </div>
          {/if}
        </div>

        <div class="cf-viewer">
          <h3>Remote Viewer</h3>
          {#if !canControl}
            <p class="cf-note">Operator or Owner role is required to control power or open the remote browser viewer.</p>
          {:else if view.sessionNote}
            <p class="cf-note">{view.sessionNote}</p>
          {:else if view.session}
            <div class="cf-pills">
              <span class="pill" data-tone={viewerHref ? "ok" : "warn"}>{viewerHref ? "origin configured" : "origin unavailable"}</span>
              <span class="pill" data-tone={view.session.hasPassword ? "ok" : "warn"}>
                {view.session.hasPassword ? "VNC password configured (masked)" : "VNC password missing"}
              </span>
            </div>
            {#if view.session.viewerOrigin}<p class="cf-note">Viewer origin: <code>{view.session.viewerOrigin}</code></p>{/if}
            {#if viewerHref}
              <div class="cf-actions">
                <a class="viewer-link" href={viewerHref} target="_blank" rel="noopener noreferrer">Open Viewer</a>
              </div>
            {/if}
          {:else}
            <p class="cf-note">Viewer session configuration was not returned by the host.</p>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</section>

<style>
  .cf-title-group, .cf-pills, .cf-actions { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .cf-card { display: grid; gap: 1rem; margin-top: 1rem; padding: 1rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel); }
  .cf-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap; }
  .cf-meta-group { display: grid; gap: 0.375rem; min-width: 0; flex: 1 1 14rem; }
  .cf-viewer { display: grid; gap: 0.5rem; padding-top: 0.75rem; border-top: 1px solid var(--border); }
  .cf-viewer h3 { margin: 0; font-size: 0.9375rem; }
  .cf-note { margin: 0; font-size: 0.875rem; color: var(--muted); overflow-wrap: anywhere; }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
  .viewer-link {
    display: inline-flex; align-items: center; min-height: var(--ui-control-height); padding: 0.5rem 0.875rem;
    border: 1px solid var(--accent); border-radius: 0.375rem; background: var(--accent); color: var(--accent-text);
    font-size: 0.875rem; font-weight: 600; text-decoration: none; white-space: nowrap;
  }
</style>
