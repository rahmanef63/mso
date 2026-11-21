<script lang="ts">
  import { onMount } from "svelte";
  import {
    createWorkflowsController,
    type WorkflowGraphSummary,
    type WorkflowRunSummary,
    type WorkflowsState,
    type WorkflowsTab,
  } from "./workflows-api.ts";

  let view = $state<WorkflowsState>({ kind: "loading", tab: "graphs" });
  let filterQuery = $state("");
  let controller: ReturnType<typeof createWorkflowsController> | undefined;

  let visibleGraphs = $derived.by<WorkflowGraphSummary[]>(() => {
    if (view.kind !== "ready") return [];
    const q = filterQuery.trim().toLowerCase();
    if (!q) return view.graphs;
    return view.graphs.filter((g) =>
      `${g.name} ${g.id} ${g.status} ${g.description} ${g.tags.join(" ")} ${g.project ?? ""} ${g.folder ?? ""}`
        .toLowerCase().includes(q));
  });

  let visibleRuns = $derived.by<WorkflowRunSummary[]>(() => {
    if (view.kind !== "ready") return [];
    const q = filterQuery.trim().toLowerCase();
    if (!q) return view.runs;
    return view.runs.filter((r) =>
      `${r.graphName} ${r.id} ${r.state} ${r.failedNodeName ?? ""} ${r.triggerType ?? ""}`
        .toLowerCase().includes(q));
  });

  let stateTag = $derived.by(() => {
    if (view.kind !== "ready") return view.kind;
    if (view.tab === "graphs") {
      if (view.graphs.length === 0) return "empty";
      return visibleGraphs.length === 0 ? "no-filter-matches" : "ready";
    }
    if (view.runs.length === 0) return "empty";
    return visibleRuns.length === 0 ? "no-filter-matches" : "ready";
  });

  function graphTone(status: WorkflowGraphSummary["status"]): "ok" | "warn" | "neutral" {
    if (status === "active") return "ok";
    if (status === "draft") return "warn";
    return "neutral";
  }

  function runTone(runState: WorkflowRunSummary["state"]): "ok" | "warn" | "danger" | "neutral" {
    if (runState === "completed") return "ok";
    if (runState === "running" || runState === "completed_with_errors") return "warn";
    if (runState === "failed" || runState === "interrupted") return "danger";
    return "neutral";
  }

  function formatTime(iso: string | null): string {
    if (!iso) return "";
    const parsed = Date.parse(iso);
    return Number.isNaN(parsed) ? iso : new Date(parsed).toLocaleString();
  }

  function switchTab(nextTab: WorkflowsTab) {
    if (view.tab === nextTab && view.kind !== "error") return;
    void controller?.setTab(nextTab);
  }

  export function refresh() {
    void controller?.refresh();
  }

  onMount(() => {
    controller = createWorkflowsController((next) => { view = next; });
    void controller.refresh();
    return () => controller?.dispose();
  });
</script>

<section aria-labelledby="workflows-title" aria-busy={view.kind === "loading"} data-workflows-state={stateTag} data-workflows-tab={view.tab}>
  <header class="feature-header">
    <h2 id="workflows-title">Workflows</h2>
    <div class="actions">
      <div class="wf-tabs" role="tablist" aria-label="Workflow views">
        <button type="button" role="tab" aria-selected={view.tab === "graphs"} class:primary={view.tab === "graphs"} onclick={() => switchTab("graphs")}>
          Graphs
        </button>
        <button type="button" role="tab" aria-selected={view.tab === "runs"} class:primary={view.tab === "runs"} onclick={() => switchTab("runs")}>
          Recent Runs
        </button>
      </div>
      <button type="button" disabled={view.kind === "loading"} onclick={refresh}>
        {view.kind === "loading" ? "Loading..." : "Refresh"}
      </button>
    </div>
  </header>

  <div class="wf-filter-wrap">
    <label for="workflows-filter">Filter {view.tab === "graphs" ? "workflows" : "runs"}</label>
    <input
      id="workflows-filter"
      type="search"
      bind:value={filterQuery}
      placeholder={view.tab === "graphs" ? "Name, status, description, or tag" : "Workflow name, run state, or trigger"}
    />
  </div>

  <div role="status" aria-live="polite">
    {#if view.kind === "loading"}
      <p>Loading {view.tab === "graphs" ? "workflow graphs" : "recent workflow runs"}...</p>
    {:else if view.kind === "error"}
      <p class="feedback error" role="alert">{view.message}</p>
    {:else if view.tab === "graphs"}
      {#if view.graphs.length === 0}
        <p>No workflow graphs saved for this workspace.</p>
      {:else if visibleGraphs.length === 0}
        <p>No workflow graphs match "{filterQuery.trim()}".</p>
      {:else}
        <ul class="wf-list" aria-label="Workflow graphs">
          {#each visibleGraphs as graph (graph.id)}
            <li class="wf-row">
              <div class="wf-info">
                <div class="wf-heading">
                  <strong>{graph.name}</strong>
                  <span class="pill" data-tone={graphTone(graph.status)}>{graph.status}</span>
                  <span class="pill">{graph.nodeCount} {graph.nodeCount === 1 ? "node" : "nodes"}</span>
                  {#each graph.tags as tag}
                    <span class="pill">#{tag}</span>
                  {/each}
                </div>
                {#if graph.description}
                  <p class="wf-desc">{graph.description}</p>
                {/if}
                <p class="wf-meta">Updated {formatTime(graph.updatedAt)}</p>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    {:else if view.runs.length === 0}
      <p>No recent workflow runs recorded.</p>
    {:else if visibleRuns.length === 0}
      <p>No recent workflow runs match "{filterQuery.trim()}".</p>
    {:else}
      <p class="wf-summary">Showing {visibleRuns.length} of {view.totalRuns} recorded {view.totalRuns === 1 ? "run" : "runs"}.</p>
      <ul class="wf-list" aria-label="Recent workflow runs">
        {#each visibleRuns as run (run.id)}
          <li class="wf-row">
            <div class="wf-info">
              <div class="wf-heading">
                <strong>{run.graphName}</strong>
                <span class="pill" data-tone={runTone(run.state)}>{run.state.replace(/_/g, " ")}</span>
                {#if run.triggerType}
                  <span class="pill">{run.triggerType}</span>
                {/if}
              </div>
              {#if run.failedNodeName}
                <p class="wf-diag">Failed node: {run.failedNodeName}</p>
              {/if}
              <p class="wf-meta">
                Started {formatTime(run.startedAt)}{#if run.finishedAt} | Finished {formatTime(run.finishedAt)}{/if}
              </p>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>

<style>
  .wf-tabs { display: inline-flex; gap: 0.375rem; flex-wrap: wrap; }
  .wf-filter-wrap { display: grid; gap: 0.375rem; margin: 1rem 0; }
  .wf-filter-wrap label { font-size: 0.875rem; font-weight: 600; color: var(--text); }
  .wf-filter-wrap input { width: 100%; min-width: 0; min-height: var(--ui-control-height); }
  .wf-summary { margin: 0 0 0.5rem; font-size: 0.875rem; color: var(--muted); }
  .wf-list { list-style: none; padding: 0; margin: 0.5rem 0 0; display: grid; gap: 0.625rem; max-height: 24rem; overflow-y: auto; }
  .wf-row { padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel); }
  .wf-info { display: grid; gap: 0.25rem; min-width: 0; }
  .wf-heading { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .wf-desc { margin: 0; font-size: 0.875rem; color: var(--muted); }
  .wf-meta { margin: 0; font-size: 0.8125rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  .wf-diag { margin: 0; font-size: 0.8125rem; color: var(--danger); }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="danger"] { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
</style>
