<script lang="ts">
  import type { WorkflowRunSummary } from "./workflows-api.ts";
  import {
    formatDurationMs,
    formatJsonPreview,
    formatTimestamp,
    runTone,
    type RunStateFilter,
  } from "./workflow-studio-helpers.ts";
  import type { WorkflowRunDetail } from "./workflow-types.ts";

  type Props = {
    runs: WorkflowRunSummary[];
    totalRuns: number;
    filterQuery: string;
    stateFilter: RunStateFilter;
    selectedRun: WorkflowRunDetail | null;
    loadingDetail: boolean;
    busy: boolean;
    onFilterChange: (value: string) => void;
    onStateFilterChange: (next: RunStateFilter) => void;
    onInspectRun: (runId: string) => void;
    onStopRun: (runId: string) => void;
    onRetryRun: (runId: string) => void;
    onDeleteRun: (runId: string) => void;
  };

  let {
    runs,
    totalRuns,
    filterQuery,
    stateFilter,
    selectedRun,
    loadingDetail,
    busy,
    onFilterChange,
    onStateFilterChange,
    onInspectRun,
    onStopRun,
    onRetryRun,
    onDeleteRun,
  }: Props = $props();

  let confirmDeleteId = $state<string | null>(null);
  const filters: readonly RunStateFilter[] = ["all", "running", "completed", "failed"];
</script>

<div class="wf-runs-shell">
  <div class="wf-runs-toolbar">
    <div class="wf-search-wrap">
      <label class="sr-only" for="workflows-runs-filter">Filter runs</label>
      <input
        id="workflows-runs-filter"
        type="search"
        value={filterQuery}
        placeholder="Workflow name, run state, or trigger"
        oninput={(e) => onFilterChange((e.currentTarget as HTMLInputElement).value)}
      />
    </div>
    <div class="wf-filter-pills" role="group" aria-label="Filter runs by state">
      {#each filters as f (f)}
        <button
          type="button"
          class="wf-pill-btn"
          class:primary={stateFilter === f}
          aria-pressed={stateFilter === f}
          onclick={() => onStateFilterChange(f)}
        >
          {f}
        </button>
      {/each}
    </div>
  </div>

  {#if totalRuns === 0}
    <p class="wf-empty">No recent workflow runs recorded.</p>
  {:else if runs.length === 0}
    <p class="wf-empty">No recent workflow runs match "{filterQuery.trim() || stateFilter}".</p>
  {:else}
    <p class="wf-summary">
      Showing {runs.length} of {totalRuns} recorded {totalRuns === 1 ? "run" : "runs"}.
    </p>
    <div class="wf-runs-grid">
      <ul class="wf-run-list" aria-label="Recent workflow runs">
        {#each runs as run (run.id)}
          {@const active = selectedRun?.id === run.id}
          <li class="wf-run-card" class:active>
            <button type="button" class="wf-run-select" aria-pressed={active} onclick={() => onInspectRun(run.id)}>
              <div class="wf-run-head">
                <strong>{run.graphName}</strong>
                <span class="wf-pill" data-tone={runTone(run.state)}>{run.state.replace(/_/g, " ")}</span>
                {#if run.triggerType}<span class="wf-pill">{run.triggerType}</span>{/if}
              </div>
              {#if run.failedNodeName}<p class="wf-diag">Failed node: {run.failedNodeName}</p>{/if}
              <p class="wf-meta">
                Started {formatTimestamp(run.startedAt)}{#if run.finishedAt} | Duration {formatDurationMs(run.startedAt, run.finishedAt)}{/if}
              </p>
            </button>
          </li>
        {/each}
      </ul>

      <div class="wf-run-inspector" aria-label="Run step inspector">
        {#if loadingDetail}
          <p class="wf-empty">Loading step-by-step execution details...</p>
        {:else if !selectedRun}
          <p class="wf-empty">Select a run to inspect step timings, status badges, logs, and diagnostics.</p>
        {:else}
          <div class="wf-detail-head">
            <div>
              <h3>{selectedRun.graphName}</h3>
              <p class="wf-meta">
                Trigger: {selectedRun.triggerType ?? "manual"} | Duration: {formatDurationMs(selectedRun.startedAt, selectedRun.finishedAt)}
              </p>
            </div>
            <span class="wf-pill" data-tone={runTone(selectedRun.state)}>{selectedRun.state.replace(/_/g, " ")}</span>
          </div>

          {#if selectedRun.failedNodeName || selectedRun.error}
            <div class="feedback error" role="alert">
              {#if selectedRun.failedNodeName}<strong>Failed node: {selectedRun.failedNodeName}.</strong> {/if}
              {selectedRun.error ?? "Execution encountered an error."}
            </div>
          {/if}

          <div class="wf-detail-actions">
            {#if selectedRun.state === "running"}
              <button type="button" class="wf-xs-btn danger" disabled={busy} onclick={() => onStopRun(selectedRun.id)}>Stop run</button>
            {:else}
              <button type="button" class="wf-xs-btn" disabled={busy} onclick={() => onRetryRun(selectedRun.id)}>Retry run</button>
              {#if confirmDeleteId === selectedRun.id}
                <button type="button" class="wf-xs-btn danger" disabled={busy} onclick={() => { confirmDeleteId = null; onDeleteRun(selectedRun.id); }}>Confirm delete</button>
                <button type="button" class="wf-xs-btn" onclick={() => { confirmDeleteId = null; }}>Cancel</button>
              {:else}
                <button type="button" class="wf-xs-btn danger" disabled={busy} onclick={() => { confirmDeleteId = selectedRun.id; }}>Delete receipt</button>
              {/if}
            {/if}
          </div>

          {#if selectedRun.nodes.length === 0}
            <p class="wf-empty">No per-node step details were returned for this run receipt.</p>
          {:else}
            <ol class="wf-steps">
              {#each selectedRun.nodes as step (step.id)}
                <li class="wf-step">
                  <details open={step.state === "failed" || step.state === "running"}>
                    <summary class="wf-step-summary">
                      <span class="wf-step-name">{step.name}</span>
                      <span class="wf-step-meta">
                        <span class="wf-pill" data-tone={runTone(step.state)}>{step.state}</span>
                        {#if step.durationMs !== undefined}<span class="wf-meta">{step.durationMs} ms</span>{/if}
                        {#if step.attempts && step.attempts > 1}<span class="wf-meta">{step.attempts} tries</span>{/if}
                      </span>
                    </summary>
                    <div class="wf-step-body">
                      {#if step.error}<p class="wf-diag">{step.error}</p>{/if}
                      {#if step.logs.length > 0}
                        <ul class="wf-logs">
                          {#each step.logs as line}<li>{line}</li>{/each}
                        </ul>
                      {/if}
                      {#if step.output !== undefined}
                        <pre class="wf-output">{formatJsonPreview(step.output)}</pre>
                      {/if}
                    </div>
                  </details>
                </li>
              {/each}
            </ol>
          {/if}
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .wf-runs-shell { display: grid; gap: 0.75rem; min-width: 0; }
  .wf-runs-toolbar { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
  .wf-search-wrap { flex: 1 1 12rem; min-width: 0; }
  .wf-search-wrap input { width: 100%; min-width: 0; min-height: 2.1rem; font-size: 0.85rem; }
  .wf-filter-pills { display: flex; gap: 0.3rem; flex-wrap: wrap; }
  .wf-pill-btn { min-height: 1.9rem; padding: 0.2rem 0.55rem; font-size: 0.75rem; border-radius: 999px; text-transform: capitalize; }
  .wf-summary, .wf-empty { margin: 0; font-size: 0.84rem; color: var(--muted); }
  .wf-runs-grid { display: grid; gap: 0.75rem; grid-template-columns: minmax(0, 1fr); min-width: 0; }
  @media (min-width: 820px) { .wf-runs-grid { grid-template-columns: minmax(0, 19rem) minmax(0, 1fr); } }
  .wf-run-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.5rem; align-content: start; max-height: 28rem; overflow-y: auto; }
  .wf-run-card { border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel-solid); overflow: hidden; }
  .wf-run-card.active { border-color: var(--accent); }
  .wf-run-select { width: 100%; border: 0; border-radius: 0; background: transparent; text-align: left; display: grid; gap: 0.25rem; padding: 0.6rem; min-height: 0; }
  .wf-run-head { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
  .wf-run-inspector { border: 1px solid var(--border); border-radius: 0.625rem; padding: 0.75rem; background: var(--surface); display: grid; gap: 0.625rem; align-content: start; min-width: 0; }
  .wf-detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
  .wf-detail-actions { display: flex; gap: 0.375rem; flex-wrap: wrap; }
  .wf-xs-btn { min-height: 1.9rem; padding: 0.2rem 0.55rem; font-size: 0.76rem; }
  .wf-steps { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.45rem; }
  .wf-step { border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel-solid); padding: 0.45rem 0.6rem; min-width: 0; }
  .wf-step-summary { cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; flex-wrap: wrap; font-size: 0.82rem; font-weight: 600; }
  .wf-step-meta { display: inline-flex; align-items: center; gap: 0.35rem; flex-wrap: wrap; }
  .wf-step-body { margin-top: 0.45rem; display: grid; gap: 0.35rem; min-width: 0; }
  .wf-logs { margin: 0; padding-left: 1rem; font-family: var(--font-mono); font-size: 0.74rem; color: var(--muted); }
  .wf-output { margin: 0; padding: 0.5rem; border-radius: 0.375rem; background: var(--panel); border: 1px solid var(--border); font-family: var(--font-mono); font-size: 0.74rem; overflow-x: auto; max-height: 11rem; }
  .wf-meta { margin: 0; font-size: 0.76rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  .wf-diag { margin: 0; font-size: 0.78rem; color: var(--danger); }
  .wf-pill { display: inline-block; padding: 0.08rem 0.45rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.7rem; color: var(--muted); }
  .wf-pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .wf-pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
  .wf-pill[data-tone="danger"] { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
</style>
