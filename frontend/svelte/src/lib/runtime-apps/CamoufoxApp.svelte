<script lang="ts">
  import { onMount } from "svelte";
  import {
    ApiError, readCamoufoxSession, readCamoufoxStatus, safeViewerHref, setCamoufoxPower,
    viewerEmbedSrc, type CamoufoxPowerAction, type CamoufoxSession, type CamoufoxStatus,
  } from "./runtime-apps-api.ts";
  import CamoufoxViewer from "./CamoufoxViewer.svelte";

  type CamoufoxView =
    | { kind: "loading" }
    | { kind: "ready"; status: CamoufoxStatus; session: CamoufoxSession | null; sessionNote: string | null }
    | { kind: "error"; message: string };

  let { role = null }: { role?: "viewer" | "operator" | "owner" | null } = $props();

  let view = $state<CamoufoxView>({ kind: "loading" });
  let busy = $state(false);
  let confirmStop = $state(false);
  let showPassword = $state(false);
  let frameTick = $state(0);
  let frameError = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let actionError = $state<string | null>(null);
  let activeController: AbortController | undefined;
  let generation = 0;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  let canControl = $derived(role === "operator" || role === "owner");
  let viewerHref = $derived.by<string | null>(() =>
    view.kind === "ready" && view.session
      ? safeViewerHref(view.session.viewerOrigin, view.session.viewerPathPrefix)
      : null);
  let embedSrc = $derived(viewerEmbedSrc(viewerHref));

  function revealPassword() {
    showPassword = !showPassword;
    if (hideTimer) clearTimeout(hideTimer);
    if (showPassword) hideTimer = setTimeout(() => { showPassword = false; }, 12_000);
  }

  async function loadCamoufox() {
    const run = ++generation;
    activeController?.abort();
    const ctrl = (activeController = new AbortController());
    view = { kind: "loading" };
    confirmStop = false;
    actionError = null;
    frameError = null;
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

  function reloadFrame() {
    frameError = null;
    frameTick += 1;
  }

  export function refresh() { void loadCamoufox(); }

  onMount(() => {
    void loadCamoufox();
    return () => {
      generation++;
      activeController?.abort();
      if (hideTimer) clearTimeout(hideTimer);
    };
  });
</script>

<section aria-labelledby="camoufox-title" aria-busy={view.kind === "loading" || busy} data-camoufox-state={view.kind}>
  <header class="feature-header cf-bar">
    <div class="cf-actions">
      <h2 id="camoufox-title">Camoufox Browser</h2>
      {#if view.kind === "ready"}
        <span class="pill" data-tone={view.status.running ? "ok" : "neutral"}>{view.status.running ? "running" : "stopped"}</span>
        {#if view.status.viewerReady !== undefined}
          <span class="pill" data-tone={view.status.viewerReady ? "ok" : "warn"}>{view.status.viewerReady ? "viewer ready" : "viewer offline"}</span>
        {/if}
        {#if view.status.enabled !== undefined}<span class="pill">{view.status.enabled ? "autostart" : "on-demand"}</span>{/if}
      {/if}
    </div>
    <div class="cf-actions">
      <button type="button" disabled={view.kind === "loading" || busy} onclick={refresh}>
        {view.kind === "loading" ? "Loading..." : "Refresh"}
      </button>
      {#if canControl && view.kind === "ready" && view.status.installed !== false}
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
      {/if}
    </div>
  </header>

  <div role="status" aria-live="polite">
    {#if view.kind === "loading"}
      <p>Loading Camoufox browser service status...</p>
    {:else if view.kind === "error"}
      <p class="feedback error" role="alert">{view.message}</p>
    {:else}
      {#if notice}<p class="feedback ok">{notice}</p>{/if}
      {#if actionError}<p class="feedback error" role="alert">{actionError}</p>{/if}
      {#if view.status.detail}<p class="cf-detail">{view.status.detail}</p>{/if}
      <CamoufoxViewer
        status={view.status}
        session={view.session}
        sessionNote={view.sessionNote}
        {viewerHref} {embedSrc} {canControl} {showPassword} {frameTick} {frameError}
        onRevealPassword={revealPassword}
        onReload={reloadFrame}
        onFrameError={(message) => { frameError = message || null; }}
      />
    {/if}
  </div>
</section>

<style>
  .cf-bar { flex-wrap: wrap; gap: 0.5rem; }
  .cf-actions { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .cf-detail { margin: 0.75rem 0 0; font-size: 0.8125rem; color: var(--muted); overflow-wrap: anywhere; }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
  @media (max-width: 400px) {
    .cf-actions button { flex: 1 1 calc(50% - 0.25rem); }
  }
</style>
