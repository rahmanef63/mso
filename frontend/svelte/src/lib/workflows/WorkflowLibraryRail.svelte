<script lang="ts">
  import { WORKFLOW_STARTER_TEMPLATES } from "./workflow-templates.ts";
  import { formatTimestamp, graphTone, type StatusFilter } from "./workflow-studio-helpers.ts";
  import type { WorkflowGraphDetail, WorkflowStarterTemplate } from "./workflow-types.ts";

  type Props = {
    graphs: WorkflowGraphDetail[];
    totalCount: number;
    activeId: string | null;
    filterQuery: string;
    statusFilter: StatusFilter;
    busy: boolean;
    onFilterChange: (value: string) => void;
    onStatusChange: (status: StatusFilter) => void;
    onSelect: (id: string) => void;
    onCreateFromTemplate: (template: WorkflowStarterTemplate) => void;
    onDuplicate: (graph: WorkflowGraphDetail) => void;
    onDelete: (graph: WorkflowGraphDetail) => void;
  };

  let {
    graphs,
    totalCount,
    activeId,
    filterQuery,
    statusFilter,
    busy,
    onFilterChange,
    onStatusChange,
    onSelect,
    onCreateFromTemplate,
    onDuplicate,
    onDelete,
  }: Props = $props();

  let showTemplates = $state(false);
  let confirmDeleteId = $state<string | null>(null);
  const statuses: readonly StatusFilter[] = ["all", "active", "draft", "archived"];

  function pickTemplate(tpl: WorkflowStarterTemplate) {
    showTemplates = false;
    onCreateFromTemplate(tpl);
  }
</script>

<aside class="wf-rail" aria-label="Workflow library">
  <div class="wf-rail-head">
    <div class="wf-rail-title-row">
      <h3>Library ({totalCount})</h3>
      <button
        type="button"
        class="primary wf-sm-btn"
        disabled={busy}
        aria-expanded={showTemplates}
        onclick={() => { showTemplates = !showTemplates; }}
      >
        {showTemplates ? "Close" : "New workflow"}
      </button>
    </div>

    {#if showTemplates}
      <div class="wf-templates" role="region" aria-label="Starter templates">
        <p class="wf-tpl-hint">Start from a blank graph or starter template:</p>
        {#each WORKFLOW_STARTER_TEMPLATES as tpl (tpl.id)}
          <button type="button" class="wf-tpl-btn" disabled={busy} onclick={() => pickTemplate(tpl)}>
            <strong>{tpl.title}</strong>
            <span>{tpl.description}</span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="wf-search-field">
      <label class="sr-only" for="workflows-filter">Filter workflows</label>
      <input
        id="workflows-filter"
        type="search"
        value={filterQuery}
        placeholder="Search name, status, or tag"
        oninput={(e) => onFilterChange((e.currentTarget as HTMLInputElement).value)}
      />
    </div>

    <div class="wf-status-pills" role="group" aria-label="Filter by status">
      {#each statuses as st (st)}
        <button
          type="button"
          class="wf-pill-btn"
          class:primary={statusFilter === st}
          aria-pressed={statusFilter === st}
          onclick={() => onStatusChange(st)}
        >
          {st}
        </button>
      {/each}
    </div>
  </div>

  {#if totalCount === 0}
    <p class="wf-empty">No workflow graphs saved for this workspace.</p>
  {:else if graphs.length === 0}
    <p class="wf-empty">No workflow graphs match "{filterQuery.trim() || statusFilter}".</p>
  {:else}
    <ul class="wf-lib-list" aria-label="Workflow graphs">
      {#each graphs as graph (graph.id)}
        {@const selected = activeId === graph.id}
        {@const confirming = confirmDeleteId === graph.id}
        <li class="wf-lib-card" class:selected>
          <button
            type="button"
            class="wf-lib-select"
            aria-pressed={selected}
            onclick={() => { confirmDeleteId = null; onSelect(graph.id); }}
          >
            <div class="wf-lib-top">
              <strong class="wf-lib-name">{graph.name}</strong>
              <span class="wf-pill" data-tone={graphTone(graph.status)}>{graph.status}</span>
            </div>
            {#if graph.description}<p class="wf-lib-desc">{graph.description}</p>{/if}
            <div class="wf-lib-meta">
              <span>{graph.nodes.length} {graph.nodes.length === 1 ? "node" : "nodes"}</span>
              <span>{formatTimestamp(graph.updatedAt)}</span>
            </div>
            {#if graph.metadata.tags?.length}
              <div class="wf-tag-row">
                {#each graph.metadata.tags as tag}<span class="wf-pill">#{tag}</span>{/each}
              </div>
            {/if}
          </button>

          <div class="wf-lib-actions">
            <button
              type="button"
              class="wf-xs-btn"
              class:primary={selected}
              onclick={() => onSelect(graph.id)}
            >
              {selected ? "Inspecting" : "Inspect graph"}
            </button>
            <button type="button" class="wf-xs-btn" disabled={busy} onclick={() => onDuplicate(graph)}>
              Duplicate
            </button>
            {#if confirming}
              <button
                type="button"
                class="wf-xs-btn danger"
                disabled={busy}
                onclick={() => { confirmDeleteId = null; onDelete(graph); }}
              >
                Confirm delete
              </button>
              <button type="button" class="wf-xs-btn" onclick={() => { confirmDeleteId = null; }}>
                Cancel
              </button>
            {:else}
              <button type="button" class="wf-xs-btn danger" disabled={busy} onclick={() => { confirmDeleteId = graph.id; }}>
                Delete
              </button>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</aside>

<style>
  .wf-rail { display: grid; gap: 0.625rem; align-content: start; min-width: 0; border: 1px solid var(--border); border-radius: 0.625rem; padding: 0.625rem; background: var(--surface); }
  .wf-rail-head { display: grid; gap: 0.5rem; min-width: 0; }
  .wf-rail-title-row { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
  .wf-sm-btn { min-height: 2rem; padding: 0.25rem 0.6rem; font-size: 0.8rem; }
  .wf-xs-btn { min-height: 1.85rem; padding: 0.15rem 0.45rem; font-size: 0.74rem; }
  .wf-templates { display: grid; gap: 0.375rem; padding: 0.5rem; border: 1px solid var(--accent); border-radius: 0.5rem; background: var(--panel-solid); }
  .wf-tpl-hint { margin: 0; font-size: 0.75rem; color: var(--muted); }
  .wf-tpl-btn { display: grid; gap: 0.15rem; text-align: left; padding: 0.45rem 0.55rem; min-height: 0; }
  .wf-tpl-btn strong { font-size: 0.8rem; color: var(--text); }
  .wf-tpl-btn span { font-size: 0.74rem; color: var(--muted); }
  .wf-search-field input { width: 100%; min-width: 0; min-height: 2.1rem; font-size: 0.84rem; }
  .wf-status-pills { display: flex; gap: 0.3rem; flex-wrap: wrap; }
  .wf-pill-btn { min-height: 1.8rem; padding: 0.15rem 0.5rem; font-size: 0.74rem; border-radius: 999px; text-transform: capitalize; }
  .wf-empty { margin: 0.25rem 0; font-size: 0.82rem; color: var(--muted); }
  .wf-lib-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; max-height: 28rem; overflow-y: auto; }
  .wf-lib-card { border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel-solid); overflow: hidden; min-width: 0; }
  .wf-lib-card.selected { border-color: var(--accent); }
  .wf-lib-select { width: 100%; border: 0; border-radius: 0; background: transparent; text-align: left; display: grid; gap: 0.25rem; padding: 0.55rem; min-height: 0; }
  .wf-lib-top { display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; min-width: 0; }
  .wf-lib-name { font-size: 0.84rem; overflow-wrap: anywhere; }
  .wf-lib-desc { margin: 0; font-size: 0.76rem; color: var(--muted); overflow-wrap: anywhere; }
  .wf-lib-meta { display: flex; justify-content: space-between; gap: 0.4rem; flex-wrap: wrap; font-size: 0.72rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  .wf-tag-row { display: flex; gap: 0.25rem; flex-wrap: wrap; }
  .wf-lib-actions { display: flex; gap: 0.3rem; flex-wrap: wrap; padding: 0.4rem 0.55rem; border-top: 1px solid var(--border); background: var(--panel); }
  .wf-pill { display: inline-block; padding: 0.08rem 0.45rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.7rem; color: var(--muted); }
  .wf-pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .wf-pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
</style>
