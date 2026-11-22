<script lang="ts">
  import { onMount } from "svelte";
  import {
    ApiError, readDesktopContainers, resolveDesktopScreenshotUrl, runDesktopLifecycle, sanitizeLogLines,
    type DesktopContainerItem, type DesktopLifecycleAction,
  } from "./runtime-apps-api.ts";

  type DesktopView = { kind: "loading" } | { kind: "ready"; containers: DesktopContainerItem[] } | { kind: "error"; message: string };

  let { role = null }: { role?: "viewer" | "operator" | "owner" | null } = $props();
  let view = $state<DesktopView>({ kind: "loading" });
  let filterQuery = $state("");
  let busyId = $state<string | null>(null);
  let pendingConfirm = $state<{ id: string; action: "stop" | "restart" } | null>(null);
  let previewId = $state<string | null>(null);
  let previewScreen = $state(":99");
  let previewTick = $state(0);
  let previewError = $state<string | null>(null);
  let logsBox = $state<{ container: string; text: string } | null>(null);
  let notice = $state<string | null>(null);
  let actionError = $state<string | null>(null);
  let activeController: AbortController | undefined;
  let generation = 0;

  let canControl = $derived(role === "operator" || role === "owner");
  let visibleContainers = $derived.by<DesktopContainerItem[]>(() => {
    if (view.kind !== "ready") return [];
    const q = filterQuery.trim().toLowerCase();
    return q
      ? view.containers.filter((c) => `${c.name} ${c.id} ${c.state} ${c.status} ${c.labels.bot ?? ""} ${c.labels.user ?? ""}`.toLowerCase().includes(q))
      : view.containers;
  });

  function stateTone(rawState: string): "ok" | "danger" | "warn" | "neutral" {
    const s = rawState.toLowerCase();
    return s === "running" ? "ok" : s === "exited" || s === "dead" ? "danger" : s === "restarting" || s === "paused" ? "warn" : "neutral";
  }

  async function loadContainers() {
    const run = ++generation;
    activeController?.abort();
    const ctrl = (activeController = new AbortController());
    view = { kind: "loading" };
    pendingConfirm = null;
    try {
      const res = await readDesktopContainers(ctrl.signal);
      if (run === generation && !ctrl.signal.aborted) view = { kind: "ready", containers: res.containers };
    } catch (err) {
      if (run === generation && !ctrl.signal.aborted) view = { kind: "error", message: err instanceof ApiError ? err.message : "Could not load bot desktop containers." };
    }
  }

  async function triggerAction(container: DesktopContainerItem, action: DesktopLifecycleAction) {
    if (busyId || (action !== "logs" && !canControl)) return;
    const key = container.name || container.id;
    busyId = container.id;
    pendingConfirm = null;
    notice = null;
    actionError = null;
    try {
      const res = await runDesktopLifecycle(key, action, new AbortController().signal);
      if (action === "logs") {
        logsBox = { container: key, text: res.logs?.length ? sanitizeLogLines(res.logs) : "(No log lines returned)" };
      } else {
        notice = `Completed ${action} on ${key}.`;
        if (view.kind === "ready" && res.state) {
          const updated = res.state;
          view = { kind: "ready", containers: view.containers.map((c) => (c.id === container.id ? updated : c)) };
        } else await loadContainers();
      }
    } catch (err) {
      actionError = err instanceof ApiError ? err.message : `Could not run ${action} on ${key}.`;
    } finally { busyId = null; }
  }

  function togglePreview(container: DesktopContainerItem) {
    previewError = null;
    previewId = previewId === container.id ? null : container.id;
    if (previewId) previewTick += 1;
  }

  export function refresh() { void loadContainers(); }
  onMount(() => { void loadContainers(); return () => { generation++; activeController?.abort(); }; });
</script>

<section aria-labelledby="bot-desktops-title" aria-busy={view.kind === "loading"} data-desktops-state={view.kind}>
  <header class="feature-header">
    <div class="bd-row-flex">
      <h2 id="bot-desktops-title">Bot Desktops</h2>
      {#if view.kind === "ready"}<span class="pill">{view.containers.length} containers</span>{/if}
    </div>
    <button type="button" disabled={view.kind === "loading" || busyId !== null} onclick={refresh}>
      {view.kind === "loading" ? "Loading..." : "Refresh"}
    </button>
  </header>

  <div class="bd-filter-wrap">
    <label for="bot-desktops-filter">Filter containers</label>
    <input id="bot-desktops-filter" type="search" bind:value={filterQuery} placeholder="Name, ID, state, bot, or user" />
  </div>

  <div role="status" aria-live="polite">
    {#if view.kind === "loading"}
      <p>Loading bot desktop containers...</p>
    {:else if view.kind === "error"}
      <p class="feedback error" role="alert">{view.message}</p>
    {:else}
      {#if notice}<p class="feedback ok">{notice}</p>{/if}
      {#if actionError}<p class="feedback error" role="alert">{actionError}</p>{/if}
      {#if view.containers.length === 0}
        <p>No bot desktop containers reported by the host.</p>
      {:else if visibleContainers.length === 0}
        <p>No containers match "{filterQuery.trim()}".</p>
      {:else}
        <ul class="bd-list" aria-label="Bot desktop containers">
          {#each visibleContainers as c (c.id)}
            {@const isBusy = busyId === c.id}
            {@const isRunning = c.state.toLowerCase() === "running"}
            {@const confirm = pendingConfirm?.id === c.id ? pendingConfirm : null}
            {@const target = c.name || c.id}
            <li class="bd-row">
              <div class="bd-head-row">
                <div class="bd-info">
                  <div class="bd-row-flex">
                    <strong>{target}</strong>
                    <code>{c.id}</code>
                    <span class="pill" data-tone={stateTone(c.state)}>{c.state || "unknown"}</span>
                    {#if c.labels.bot}<span class="pill">bot: {c.labels.bot}</span>{/if}
                    {#if c.labels.user}<span class="pill">user: {c.labels.user}</span>{/if}
                  </div>
                  {#if c.status}<p class="bd-meta">{c.status}</p>{/if}
                </div>
                <div class="bd-row-flex">
                  {#if isRunning}
                    <button type="button" disabled={isBusy} onclick={() => togglePreview(c)}>
                      {previewId === c.id ? "Hide screen" : "Screenshot"}
                    </button>
                  {/if}
                  <button type="button" disabled={isBusy} onclick={() => void triggerAction(c, "logs")}>Logs</button>
                  {#if canControl}
                    {#if confirm}
                      <button type="button" class={confirm.action === "stop" ? "danger" : "primary"} disabled={isBusy}
                        onclick={() => void triggerAction(c, confirm.action)}>Confirm {confirm.action}</button>
                      <button type="button" disabled={isBusy} onclick={() => { pendingConfirm = null; }}>Cancel</button>
                    {:else if isRunning}
                      <button type="button" disabled={isBusy} onclick={() => { pendingConfirm = { id: c.id, action: "restart" }; }}>Restart</button>
                      <button type="button" class="danger" disabled={isBusy} onclick={() => { pendingConfirm = { id: c.id, action: "stop" }; }}>Stop</button>
                    {:else}
                      <button type="button" class="primary" disabled={isBusy} onclick={() => void triggerAction(c, "start")}>Start</button>
                    {/if}
                  {/if}
                </div>
              </div>
              {#if previewId === c.id && isRunning}
                <div class="bd-preview">
                  <div class="bd-row-flex">
                    <label for={`screen-${c.id}`}>Display</label>
                    <select id={`screen-${c.id}`} bind:value={previewScreen} onchange={() => { previewError = null; previewTick += 1; }}>
                      <option value=":99">:99 (primary)</option><option value=":1">:1</option><option value=":2">:2</option><option value=":3">:3</option>
                    </select>
                    <button type="button" onclick={() => { previewError = null; previewTick += 1; }}>Reload frame</button>
                  </div>
                  {#if previewError}<p class="feedback error" role="alert">{previewError}</p>{/if}
                  {#key previewTick}
                    <img class="bd-shot" src={resolveDesktopScreenshotUrl(target, undefined, previewScreen)}
                      alt={`Screenshot of ${target} on ${previewScreen}`}
                      onerror={() => { previewError = "Could not load desktop screenshot for this display."; }} />
                  {/key}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
      {#if logsBox}
        <div class="bd-logs" role="region" aria-label={`Logs for ${logsBox.container}`}>
          <div class="bd-row-flex bd-between">
            <strong>Logs: <code>{logsBox.container}</code></strong>
            <button type="button" onclick={() => { logsBox = null; }}>Close</button>
          </div>
          <pre>{logsBox.text}</pre>
        </div>
      {/if}
    {/if}
  </div>
</section>

<style>
  .bd-row-flex { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .bd-between { justify-content: space-between; }
  .bd-filter-wrap { display: grid; gap: 0.375rem; margin: 1rem 0; }
  .bd-filter-wrap label { font-size: 0.875rem; font-weight: 600; color: var(--text); }
  .bd-filter-wrap input { width: 100%; min-width: 0; min-height: var(--ui-control-height); }
  .bd-list { list-style: none; padding: 0; margin: 0.75rem 0 0; display: grid; gap: 0.625rem; max-height: 24rem; overflow-y: auto; }
  .bd-row, .bd-logs { display: grid; gap: 0.5rem; padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel); }
  .bd-head-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap; }
  .bd-info { display: grid; gap: 0.25rem; min-width: 0; flex: 1 1 14rem; }
  .bd-meta { margin: 0; font-size: 0.8125rem; color: var(--muted); }
  .bd-preview { display: grid; gap: 0.5rem; padding-top: 0.5rem; border-top: 1px solid var(--border); }
  .bd-shot { max-width: 100%; max-height: 20rem; object-fit: contain; border-radius: 0.375rem; border: 1px solid var(--border); }
  .bd-logs { margin-top: 1rem; }
  .bd-logs pre { margin: 0; max-height: 14rem; overflow: auto; font-size: 0.75rem; white-space: pre-wrap; overflow-wrap: anywhere; }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="danger"] { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
</style>
