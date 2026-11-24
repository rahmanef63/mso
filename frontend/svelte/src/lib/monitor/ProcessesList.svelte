<script lang="ts">
  import { onMount } from "svelte";
  import { createProcessesController, type Process, type ProcessesState } from "./processes-api";
  import {
    defaultDirection,
    matchesProcess,
    sortProcesses,
    summarize,
    type ProcessSortKey,
    type SortDirection,
  } from "./process-view";

  const INTERVAL_MS = 5_000;
  const DETAIL_ROWS = 6;

  let view = $state<ProcessesState>({ kind: "loading" });
  let filterQuery = $state("");
  let sortBy = $state<ProcessSortKey>("cpu");
  let direction = $state<SortDirection>("desc");
  let autoRefresh = $state(true);
  let selected = $state<Process | null>(null);
  let controller: ReturnType<typeof createProcessesController> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  let summary = $derived.by(() => summarize(view.kind === "ready" ? view.processes : []));
  let visibleProcesses = $derived.by<Process[]>(() => {
    if (view.kind !== "ready") return [];
    return sortProcesses(view.processes.filter((proc) => matchesProcess(proc, filterQuery)), sortBy, direction);
  });

  let stateTag = $derived.by(() => {
    if (view.kind !== "ready") return view.kind;
    if (view.processes.length === 0) return "empty";
    return visibleProcesses.length === 0 ? "no-filter-matches" : "ready";
  });

  export function refresh() {
    void controller?.refresh();
  }

  function applySort(key: ProcessSortKey) {
    if (sortBy === key) direction = direction === "asc" ? "desc" : "asc";
    else { sortBy = key; direction = defaultDirection(key); }
  }

  function ariaSort(key: ProcessSortKey): "ascending" | "descending" | "none" {
    if (sortBy !== key) return "none";
    return direction === "asc" ? "ascending" : "descending";
  }

  function schedule() {
    if (timer !== undefined) { clearInterval(timer); timer = undefined; }
    if (!autoRefresh) return;
    timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void controller?.refresh();
    }, INTERVAL_MS);
  }

  function toggleAutoRefresh() {
    autoRefresh = !autoRefresh;
    schedule();
    if (autoRefresh) void controller?.refresh();
  }

  onMount(() => {
    controller = createProcessesController((next) => { view = next; });
    void controller.refresh();
    schedule();
    return () => {
      if (timer !== undefined) clearInterval(timer);
      controller?.dispose();
    };
  });
</script>

<section aria-labelledby="processes-title" aria-busy={view.kind === "loading"} data-processes-state={stateTag}>
  <header class="feature-header">
    <h2 id="processes-title">Processes</h2>
    <div class="head-actions">
      <label class="auto-toggle">
        <input type="checkbox" checked={autoRefresh} onchange={toggleAutoRefresh} />
        Auto refresh
      </label>
      <button disabled={view.kind === "loading"} onclick={() => void controller?.refresh()}>
        {view.kind === "loading" ? "Loading..." : "Refresh processes"}
      </button>
    </div>
  </header>

  <div class="process-controls">
    <div class="control-field filter-field">
      <label for="process-filter">Search processes</label>
      <input id="process-filter" type="search" bind:value={filterQuery} placeholder="PID, name, status, or command" />
    </div>
    <div class="control-field sort-field">
      <label for="process-sort">Sort by</label>
      <select id="process-sort" value={sortBy} onchange={(event) => applySort(event.currentTarget.value as ProcessSortKey)}>
        <option value="cpu">CPU</option>
        <option value="mem">Memory</option>
        <option value="pid">PID</option>
        <option value="name">Name</option>
      </select>
    </div>
    <button class="direction" type="button" onclick={() => { direction = direction === "asc" ? "desc" : "asc"; }}>
      {direction === "asc" ? "Ascending" : "Descending"}
    </button>
  </div>

  {#if view.kind === "ready" && view.processes.length > 0}
    <dl class="process-kpis">
      <div><dt>Total processes</dt><dd>{summary.total}</dd></div>
      <div><dt>Top CPU</dt><dd>{summary.topCpu ? `${summary.topCpu.name} ${summary.topCpu.cpu.toFixed(1)}%` : "n/a"}</dd></div>
      <div><dt>Total RSS</dt><dd>{(summary.totalRssMiB / 1024).toFixed(2)} GiB</dd></div>
    </dl>
  {/if}

  <div role="status" aria-live="polite">
    {#if view.kind === "loading"}
      <p>Loading host processes...</p>
    {:else if view.kind === "error"}
      <p class="feedback error" role="alert">{view.message}</p>
    {:else if view.processes.length === 0}
      <p>No active processes reported by the host.</p>
    {:else if visibleProcesses.length === 0}
      <p>No processes match "{filterQuery.trim()}".</p>
    {:else}
      <div class="process-scroll" role="region" aria-label="Process inventory" tabindex="-1">
        <table class="process-table">
          <thead>
            <tr>
              <th scope="col" class="num" aria-sort={ariaSort("pid")}>
                <button type="button" class="th-sort" onclick={() => applySort("pid")}>PID</button>
              </th>
              <th scope="col" aria-sort={ariaSort("name")}>
                <button type="button" class="th-sort" onclick={() => applySort("name")}>Process</button>
              </th>
              <th scope="col">Status</th>
              <th scope="col" class="num" aria-sort={ariaSort("cpu")}>
                <button type="button" class="th-sort" onclick={() => applySort("cpu")}>CPU%</button>
              </th>
              <th scope="col" class="num" aria-sort={ariaSort("mem")}>
                <button type="button" class="th-sort" onclick={() => applySort("mem")}>Mem</button>
              </th>
              <th scope="col" class="num">Detail</th>
            </tr>
          </thead>
          <tbody>
            {#each visibleProcesses as proc (proc.pid)}
              <tr data-selected={selected?.pid === proc.pid}>
                <td class="num"><code>{proc.pid}</code></td>
                <td class="proc-name" title={proc.name}>{proc.name}</td>
                <td><span class="status-pill">{proc.status || "-"}</span></td>
                <td class="num" class:cpu-hot={proc.cpu > 50}>{proc.cpu.toFixed(1)}%</td>
                <td class="num">{proc.mem.toFixed(0)} MiB</td>
                <td class="num">
                  <button
                    type="button"
                    class="detail-btn"
                    aria-label="Process detail for {proc.name}"
                    aria-expanded={selected?.pid === proc.pid}
                    onclick={() => { selected = selected?.pid === proc.pid ? null : proc; }}
                  >{selected?.pid === proc.pid ? "Hide" : "Show"}</button>
                </td>
              </tr>
              {#if selected?.pid === proc.pid}
                <tr class="detail-row">
                  <td colspan={DETAIL_ROWS}>
                    <div class="drawer" role="region" aria-label="Process detail">
                      <p><strong>{proc.name}</strong> · PID {proc.pid}</p>
                      <p>Status {proc.status || "unknown"} · CPU {proc.cpu.toFixed(2)}% · RSS {proc.mem.toFixed(0)} MiB</p>
                      <p class="drawer-note">Host inventory exposes the executable name, not full argv. Inspect the process in Terminal for its command line.</p>
                    </div>
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</section>

<style>
  .head-actions { display: flex; align-items: center; gap: 0.625rem; flex-wrap: wrap; }
  .auto-toggle { display: inline-flex; align-items: center; gap: 0.375rem; font-size: 0.875rem; color: var(--muted); }
  .auto-toggle input { width: 1.05rem; height: 1.05rem; }
  .process-controls { display: flex; flex-wrap: wrap; gap: 0.75rem; margin: 1rem 0; align-items: end; }
  .control-field { display: grid; gap: 0.375rem; min-width: 0; }
  .control-field label { font-size: 0.875rem; font-weight: 600; color: var(--text); }
  .filter-field { flex: 1 1 12rem; }
  .sort-field { flex: 0 1 10rem; }
  .control-field input, .control-field select { width: 100%; min-width: 0; min-height: var(--ui-control-height); }
  .direction { min-height: var(--ui-control-height); }
  .process-kpis { margin: 0 0 0.75rem; }
  .process-scroll {
    width: 100%; max-width: 100%; overflow-x: auto; overflow-y: auto; max-height: 22rem;
    border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel);
  }
  .process-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; color: var(--text); }
  .process-table th, .process-table td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid var(--border); white-space: nowrap; }
  .process-table thead th { position: sticky; top: 0; z-index: 1; background: var(--panel); color: var(--muted); font-weight: 600; }
  .process-table tbody tr:last-child td { border-bottom: 0; }
  .process-table .num { text-align: right; font-variant-numeric: tabular-nums; }
  .process-table .proc-name { max-width: 18rem; overflow: hidden; text-overflow: ellipsis; }
  .process-table tr[data-selected="true"] { background: color-mix(in srgb, var(--accent) 10%, transparent); }
  .th-sort { all: unset; cursor: pointer; font: inherit; font-weight: 600; color: var(--muted); }
  .th-sort:focus-visible, .detail-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .detail-btn { padding: 0.125rem 0.5rem; font-size: 0.75rem; border-radius: 0.375rem; }
  .cpu-hot { color: var(--danger); font-weight: 700; }
  .status-pill {
    display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border);
    border-radius: 999px; font-size: 0.75rem; color: var(--muted);
  }
  .detail-row td { white-space: normal; background: color-mix(in srgb, var(--panel-solid) 72%, transparent); }
  .drawer { display: grid; gap: 0.25rem; font-size: 0.8125rem; }
  .drawer p { margin: 0; overflow-wrap: anywhere; }
  .drawer-note { color: var(--muted); }
  @media (max-width: 26rem) {
    .process-table .proc-name { max-width: 8rem; }
    .direction { flex: 1 1 100%; }
  }
</style>
