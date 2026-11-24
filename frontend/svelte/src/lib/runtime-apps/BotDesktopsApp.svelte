<script lang="ts">
  import { onMount } from "svelte";
  import {
    ApiError, readDesktopContainers, runDesktopLifecycle, sanitizeLogLines,
    type DesktopContainerItem, type DesktopLifecycleAction,
  } from "./runtime-apps-api.ts";
  import DesktopCard from "./DesktopCard.svelte";

  type DesktopView = { kind: "loading" } | { kind: "ready"; containers: DesktopContainerItem[] } | { kind: "error"; message: string };
  const INTERVALS_COPY = [0, 5, 15, 30] as const;

  let { role = null }: { role?: "viewer" | "operator" | "owner" | null } = $props();

  let view = $state<DesktopView>({ kind: "loading" });
  let filterQuery = $state("");
  let busyId = $state<string | null>(null);
  let pending = $state<{ id: string; action: "stop" | "restart" } | null>(null);
  let expandedId = $state<string | null>(null);
  let screen = $state<string>(":99");
  let tick = $state(0);
  let previewError = $state<string | null>(null);
  let logsBox = $state<{ container: string; text: string } | null>(null);
  let notice = $state<string | null>(null);
  let actionError = $state<string | null>(null);
  let refreshSeconds = $state<number>(0);
  let timer: ReturnType<typeof setInterval> | undefined;
  let activeController: AbortController | undefined;
  let generation = 0;

  let canControl = $derived(role === "operator" || role === "owner");
  let runningCount = $derived(view.kind === "ready" ? view.containers.filter((c) => c.state.toLowerCase() === "running").length : 0);
  let visible = $derived.by<DesktopContainerItem[]>(() => {
    if (view.kind !== "ready") return [];
    const q = filterQuery.trim().toLowerCase();
    if (!q) return view.containers;
    return view.containers.filter((c) =>
      `${c.name} ${c.id} ${c.state} ${c.status} ${c.labels.bot ?? ""} ${c.labels.user ?? ""}`.toLowerCase().includes(q));
  });

  async function loadContainers(silent = false) {
    const run = ++generation;
    activeController?.abort();
    const ctrl = (activeController = new AbortController());
    if (!silent) view = { kind: "loading" };
    pending = null;
    try {
      const res = await readDesktopContainers(ctrl.signal);
      if (run === generation && !ctrl.signal.aborted) view = { kind: "ready", containers: res.containers };
    } catch (err) {
      if (run === generation && !ctrl.signal.aborted && !silent) {
        view = { kind: "error", message: err instanceof ApiError ? err.message : "Could not load bot desktop containers." };
      }
    }
  }

  async function act(container: DesktopContainerItem, action: DesktopLifecycleAction) {
    if (busyId || (action !== "logs" && !canControl)) return;
    const key = container.name || container.id;
    busyId = container.id;
    if (action === "stop" || action === "restart") pending = null;
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
        } else {
          await loadContainers(true);
        }
      }
    } catch (err) {
      actionError = err instanceof ApiError ? err.message : `Could not run ${action} on ${key}.`;
    } finally {
      busyId = null;
    }
  }

  function requestAction(container: DesktopContainerItem, action: DesktopLifecycleAction) {
    if (action === "stop" || action === "restart") {
      pending = { id: container.id, action };
      return;
    }
    void act(container, action);
  }

  function setRefresh(seconds: number) {
    refreshSeconds = seconds;
    if (timer) clearInterval(timer);
    timer = undefined;
    if (seconds > 0) timer = setInterval(() => { tick += 1; void loadContainers(true); }, seconds * 1000);
  }

  export function refresh() { void loadContainers(); }

  onMount(() => {
    void loadContainers();
    return () => { generation++; activeController?.abort(); if (timer) clearInterval(timer); };
  });
</script>

<section aria-labelledby="bot-desktops-title" aria-busy={view.kind === "loading"} data-desktops-state={view.kind}>
  <header class="feature-header bd-bar">
    <div class="bd-flex">
      <h2 id="bot-desktops-title">Bot Desktops</h2>
      {#if view.kind === "ready"}
        <span class="pill">{view.containers.length} found</span>
        <span class="pill" data-tone={runningCount > 0 ? "ok" : "neutral"}>{runningCount} running</span>
      {/if}
    </div>
    <div class="bd-flex">
      <label class="bd-interval">
        <span>Auto refresh</span>
        <select value={String(refreshSeconds)} onchange={(event) => setRefresh(Number(event.currentTarget.value))}>
          {#each INTERVALS_COPY as seconds (seconds)}
            <option value={String(seconds)}>{seconds === 0 ? "Off" : `${seconds}s`}</option>
          {/each}
        </select>
      </label>
      <button type="button" disabled={view.kind === "loading" || busyId !== null} onclick={refresh}>
        {view.kind === "loading" ? "Loading..." : "Refresh"}
      </button>
    </div>
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
      {#if previewError}<p class="feedback error" role="alert">{previewError}</p>{/if}
      {#if view.containers.length === 0}
        <p>No bot desktops on this host. They appear once the bot runtime runs with a container backend and creates one.</p>
      {:else if visible.length === 0}
        <p>No containers match "{filterQuery.trim()}".</p>
      {:else}
        <div class="bd-grid">
          {#each visible as c (c.id)}
            <DesktopCard
              container={c}
              {canControl}
              busy={busyId === c.id}
              pendingAction={pending?.id === c.id ? pending.action : null}
              expanded={expandedId === c.id}
              {screen} {tick}
              onAction={(action) => requestAction(c, action)}
              onCancel={() => { pending = null; }}
              onToggleExpand={() => { expandedId = expandedId === c.id ? null : c.id; }}
              onScreenChange={(next) => { screen = next; previewError = null; tick += 1; }}
              onPreviewError={(message) => { previewError = message; }}
            />
          {/each}
        </div>
      {/if}
      {#if logsBox}
        <div class="bd-logs" role="region" aria-label={`Logs for ${logsBox.container}`}>
          <div class="bd-flex bd-between">
            <strong>Logs: <code>{logsBox.container}</code></strong>
            <button type="button" class="bd-small" onclick={() => { logsBox = null; }}>Close</button>
          </div>
          <pre>{logsBox.text}</pre>
        </div>
      {/if}
    {/if}
  </div>
</section>

<style>
  .bd-bar { flex-wrap: wrap; gap: 0.5rem; }
  .bd-flex { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .bd-between { justify-content: space-between; }
  .bd-interval { display: inline-flex; align-items: center; gap: 0.375rem; font-size: 0.75rem; color: var(--muted); }
  .bd-filter-wrap { display: grid; gap: 0.375rem; margin: 1rem 0; }
  .bd-filter-wrap label { font-size: 0.875rem; font-weight: 600; }
  .bd-filter-wrap input { width: 100%; min-width: 0; min-height: var(--ui-control-height); }
  .bd-grid { display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fit, minmax(min(19rem, 100%), 1fr)); }
  .bd-small { font-size: 0.75rem; padding: 0.1875rem 0.5rem; }
  .bd-logs { margin-top: 0.875rem; padding: 0.625rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel); }
  .bd-logs pre { margin: 0.5rem 0 0; max-height: 14rem; overflow: auto; font-size: 0.75rem; white-space: pre-wrap; overflow-wrap: anywhere; }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
</style>
