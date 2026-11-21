<script lang="ts">
  import { onMount } from "svelte";
  import { createProcessesController, type Process, type ProcessesState } from "./processes-api";

  type SortKey = "cpu" | "mem" | "pid";

  let view = $state<ProcessesState>({ kind: "loading" });
  let filterQuery = $state("");
  let sortBy = $state<SortKey>("cpu");
  let controller: ReturnType<typeof createProcessesController> | undefined;

  let visibleProcesses = $derived.by<Process[]>(() => {
    if (view.kind !== "ready") return [];
    const q = filterQuery.trim().toLowerCase();
    const filtered = q
      ? view.processes.filter((p) =>
          p.name.toLowerCase().includes(q)
          || p.status.toLowerCase().includes(q)
          || String(p.pid).includes(q))
      : view.processes;
    return [...filtered].sort((a, b) => {
      if (sortBy === "mem") return b.mem - a.mem || b.cpu - a.cpu || a.pid - b.pid;
      if (sortBy === "pid") return a.pid - b.pid;
      return b.cpu - a.cpu || b.mem - a.mem || a.pid - b.pid;
    });
  });

  let stateTag = $derived.by(() => {
    if (view.kind !== "ready") return view.kind;
    if (view.processes.length === 0) return "empty";
    return visibleProcesses.length === 0 ? "no-filter-matches" : "ready";
  });

  export function refresh() {
    void controller?.refresh();
  }

  onMount(() => {
    controller = createProcessesController((next) => { view = next; });
    void controller.refresh();
    return () => controller?.dispose();
  });
</script>

<section aria-labelledby="processes-title" aria-busy={view.kind === "loading"} data-processes-state={stateTag}>
  <header class="feature-header">
    <h2 id="processes-title">Processes</h2>
    <button disabled={view.kind === "loading"} onclick={() => void controller?.refresh()}>
      {view.kind === "loading" ? "Loading..." : "Refresh processes"}
    </button>
  </header>

  <div class="process-controls">
    <div class="control-field filter-field">
      <label for="process-filter">Filter processes</label>
      <input id="process-filter" type="search" bind:value={filterQuery} placeholder="Name, status, or PID" />
    </div>
    <div class="control-field sort-field">
      <label for="process-sort">Sort by</label>
      <select id="process-sort" bind:value={sortBy}>
        <option value="cpu">CPU</option>
        <option value="mem">Memory</option>
        <option value="pid">PID</option>
      </select>
    </div>
  </div>

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
      <div class="process-scroll" role="region" aria-label="Process inventory">
        <table class="process-table">
          <thead>
            <tr>
              <th scope="col" class="num">PID</th>
              <th scope="col">Process</th>
              <th scope="col">Status</th>
              <th scope="col" class="num">CPU%</th>
              <th scope="col" class="num">Mem</th>
            </tr>
          </thead>
          <tbody>
            {#each visibleProcesses as proc (proc.pid)}
              <tr>
                <td class="num"><code>{proc.pid}</code></td>
                <td class="proc-name">{proc.name}</td>
                <td><span class="status-pill">{proc.status || "-"}</span></td>
                <td class="num">{proc.cpu.toFixed(1)}%</td>
                <td class="num">{proc.mem.toFixed(0)} MiB</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</section>

<style>
  .process-controls { display: flex; flex-wrap: wrap; gap: 0.75rem; margin: 1rem 0; align-items: end; }
  .control-field { display: grid; gap: 0.375rem; min-width: 0; }
  .control-field label { font-size: 0.875rem; font-weight: 600; color: var(--text); }
  .filter-field { flex: 1 1 12rem; }
  .sort-field { flex: 0 1 10rem; }
  .control-field input, .control-field select { width: 100%; min-width: 0; min-height: var(--ui-control-height); }
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
  .status-pill {
    display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border);
    border-radius: 999px; font-size: 0.75rem; color: var(--muted);
  }
</style>
