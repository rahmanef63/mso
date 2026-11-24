<script lang="ts">
  import { onMount } from "svelte";
  import { ApiError, readWorkflowRuns, type WorkflowRunSummary, type WorkflowsTab } from "./workflows-api.ts";
  import {
    cloneWorkflowGraphApi, createWorkflowGraphApi, deleteWorkflowGraphApi, deleteWorkflowRunApi,
    readWorkflowGraphDetails, readWorkflowRunDetailApi, retryWorkflowRunApi, runWorkflowGraphApi,
    stopWorkflowRunApi, summaryFromDetail, updateWorkflowGraphApi,
  } from "./workflow-studio-api.ts";
  import {
    addNodeToDraft, connectEdgeInDraft, draftFromDetail, isDraftDirty, moveNodeInDraft,
    removeEdgeFromDraft, removeNodeFromDraft, tidyDraftLayout, updateEdgeInDraft, updateNodeInDraft,
  } from "./workflow-draft.ts";
  import {
    filterGraphDetails, filterRunSummaries, runNodeStateMap,
    type RunStateFilter, type StatusFilter, type StudioPane,
  } from "./workflow-studio-helpers.ts";
  import type { WorkflowGraphDetail, WorkflowGraphDraft, WorkflowPaletteItem, WorkflowRunDetail, WorkflowStarterTemplate } from "./workflow-types.ts";
  import WorkflowGraphCanvas from "./WorkflowGraphCanvas.svelte";
  import WorkflowLibraryRail from "./WorkflowLibraryRail.svelte";
  import WorkflowInspectorPanel from "./WorkflowInspectorPanel.svelte";
  import WorkflowRunsPanel from "./WorkflowRunsPanel.svelte";

  let tab = $state<WorkflowsTab>("graphs"), loadKind = $state<"loading" | "ready" | "error">("loading");
  let errorMsg = $state(""), feedback = $state<{ kind: "ok" | "error"; text: string } | null>(null);
  let graphs = $state<WorkflowGraphDetail[]>([]), runs = $state<WorkflowRunSummary[]>([]), totalRuns = $state(0);
  let selectedGraphId = $state<string | null>(null), draft = $state<WorkflowGraphDraft | null>(null);
  let selectedNodeId = $state<string | null>(null), selectedEdgeId = $state<string | null>(null);
  let activeRun = $state<WorkflowRunDetail | null>(null), loadingRunDetail = $state(false), busy = $state(false);
  let filterQuery = $state(""), statusFilter = $state<StatusFilter>("all"), runFilter = $state<RunStateFilter>("all");
  let mobilePane = $state<StudioPane>("canvas");
  let abortCtrl: AbortController | undefined;

  let visibleGraphs = $derived(filterGraphDetails(graphs, filterQuery, statusFilter));
  let activeGraph = $derived(graphs.find((g) => g.id === selectedGraphId) ?? visibleGraphs[0] ?? null);
  let visibleRuns = $derived(filterRunSummaries(runs, filterQuery, runFilter));
  let dirty = $derived(isDraftDirty(activeGraph, draft));
  let selectedNode = $derived(draft?.nodes.find((n) => n.id === selectedNodeId) ?? null);
  let selectedEdge = $derived(draft?.edges.find((e) => e.id === selectedEdgeId) ?? null);
  let canvasSummary = $derived(activeGraph && draft ? {
    ...summaryFromDetail(activeGraph), name: draft.name, status: draft.status,
    nodeCount: draft.nodes.length, edgeCount: draft.edges.length,
  } : null);
  let stateTag = $derived.by(() => {
    if (loadKind !== "ready") return loadKind;
    if (tab === "graphs") return graphs.length === 0 ? "empty" : visibleGraphs.length === 0 ? "no-filter-matches" : "ready";
    return runs.length === 0 ? "empty" : visibleRuns.length === 0 ? "no-filter-matches" : "ready";
  });

  function syncDraft(target: WorkflowGraphDetail | null) {
    draft = target ? draftFromDetail(target) : null; selectedNodeId = null; selectedEdgeId = null;
  }
  function selectGraph(id: string) {
    const found = graphs.find((g) => g.id === id) ?? null;
    selectedGraphId = found?.id ?? null; syncDraft(found); mobilePane = "canvas";
  }
  async function loadTab(nextTab: WorkflowsTab) {
    tab = nextTab; abortCtrl?.abort(); const ctrl = (abortCtrl = new AbortController());
    loadKind = "loading"; errorMsg = "";
    try {
      if (nextTab === "graphs") {
        const list = await readWorkflowGraphDetails(ctrl.signal);
        if (ctrl.signal.aborted) return;
        graphs = list;
        const keep = list.find((g) => g.id === selectedGraphId) ?? list[0] ?? null;
        selectedGraphId = keep?.id ?? null; syncDraft(keep);
      } else {
        const page = await readWorkflowRuns(ctrl.signal);
        if (ctrl.signal.aborted) return;
        runs = page.runs; totalRuns = page.total;
      }
      loadKind = "ready";
    } catch (err) {
      if (!ctrl.signal.aborted) {
        loadKind = "error";
        errorMsg = err instanceof ApiError ? err.message : "Could not load workflows. Check the backend and retry.";
      }
    }
  }
  async function runAction(fn: (signal: AbortSignal) => Promise<void>, okText?: string) {
    busy = true; feedback = null; const ctrl = new AbortController();
    try { await fn(ctrl.signal); if (okText) feedback = { kind: "ok", text: okText }; }
    catch (err) { feedback = { kind: "error", text: err instanceof ApiError ? err.message : "Workflow action failed." }; }
    finally { busy = false; }
  }
  function createFromTemplate(tpl: WorkflowStarterTemplate) {
    void runAction(async (sig) => {
      const created = await createWorkflowGraphApi(tpl.build(), sig);
      graphs = [created, ...graphs]; selectGraph(created.id);
    }, `Created "${tpl.title}".`);
  }
  function saveDraft() {
    if (!activeGraph || !draft) return;
    void runAction(async (sig) => {
      const saved = await updateWorkflowGraphApi(activeGraph.id, activeGraph.revision, draft!, sig);
      graphs = graphs.map((g) => (g.id === saved.id ? saved : g)); syncDraft(saved);
    }, "Workflow changes saved.");
  }
  function duplicateGraph(g: WorkflowGraphDetail) {
    void runAction(async (sig) => {
      const copy = await cloneWorkflowGraphApi(g.id, sig);
      graphs = [copy, ...graphs]; selectGraph(copy.id);
    }, `Duplicated "${g.name}".`);
  }
  function deleteGraph(g: WorkflowGraphDetail) {
    void runAction(async (sig) => {
      await deleteWorkflowGraphApi(g.id, g.revision, sig);
      graphs = graphs.filter((item) => item.id !== g.id);
      const next = graphs[0] ?? null; selectedGraphId = next?.id ?? null; syncDraft(next);
    }, `Deleted "${g.name}".`);
  }
  function triggerRun() {
    if (!activeGraph) return;
    void runAction(async (sig) => {
      activeRun = await runWorkflowGraphApi(activeGraph.id, activeGraph.revision, {}, sig);
    }, `Started run for "${activeGraph.name}".`);
  }
  function inspectRun(runId: string) {
    loadingRunDetail = true; const ctrl = new AbortController();
    void readWorkflowRunDetailApi(runId, ctrl.signal).then((detail) => { activeRun = detail; }).catch((err) => {
      feedback = { kind: "error", text: err instanceof ApiError ? err.message : "Could not load run detail." };
    }).finally(() => { loadingRunDetail = false; });
  }
  function onAddNode(item: WorkflowPaletteItem) {
    if (!draft) return;
    const res = addNodeToDraft(draft, item, selectedNodeId);
    draft = res.draft; selectedNodeId = res.node.id; selectedEdgeId = null;
  }
  function onConnect(src: string, tgt: string, handle?: string) {
    if (!draft) return;
    const res = connectEdgeInDraft(draft, src, tgt, handle);
    if (res.error) feedback = { kind: "error", text: res.error };
    else { draft = res.draft; selectedEdgeId = res.edge?.id ?? null; selectedNodeId = null; feedback = null; }
  }
  function onDeleteSelection() {
    if (!draft) return;
    if (selectedNodeId) { draft = removeNodeFromDraft(draft, selectedNodeId); selectedNodeId = null; }
    else if (selectedEdgeId) { draft = removeEdgeFromDraft(draft, selectedEdgeId); selectedEdgeId = null; }
  }
  const onStopRun = (id: string) => void runAction(async (sig) => { activeRun = await stopWorkflowRunApi(id, sig); await loadTab("runs"); }, "Stop requested.");
  const onRetryRun = (id: string) => void runAction(async (sig) => { activeRun = await retryWorkflowRunApi(id, sig); await loadTab("runs"); }, "Retry started.");
  const onDeleteRun = (id: string) => void runAction(async (sig) => { await deleteWorkflowRunApi(id, sig); activeRun = null; await loadTab("runs"); }, "Run receipt deleted.");
  export function refresh() { void loadTab(tab); }
  onMount(() => { void loadTab("graphs"); return () => abortCtrl?.abort(); });
</script>

<section aria-labelledby="workflows-title" aria-busy={loadKind === "loading"} data-workflows-state={stateTag} data-workflows-tab={tab}>
  <header class="feature-header">
    <h2 id="workflows-title">Workflows</h2>
    <div class="actions">
      <div class="wf-tabs" role="tablist" aria-label="Workflow views">
        <button type="button" role="tab" aria-selected={tab === "graphs"} class:primary={tab === "graphs"} onclick={() => void loadTab("graphs")}>Graphs</button>
        <button type="button" role="tab" aria-selected={tab === "runs"} class:primary={tab === "runs"} onclick={() => void loadTab("runs")}>Recent Runs</button>
      </div>
      {#if tab === "graphs" && activeGraph}
        <button type="button" class="primary" disabled={busy || dirty} title={dirty ? "Save draft before running" : "Run workflow"} onclick={triggerRun}>Run Workflow</button>
      {/if}
      <button type="button" disabled={loadKind === "loading" || busy} onclick={refresh}>{loadKind === "loading" ? "Loading..." : "Refresh"}</button>
    </div>
  </header>
  {#if dirty && draft}
    <div class="wf-draft-bar" role="region" aria-label="Unsaved workflow draft">
      <span class="wf-unsaved-pill">Unsaved changes</span>
      <div class="actions">
        <button type="button" class="primary wf-bar-btn" disabled={busy} onclick={saveDraft}>Save changes</button>
        <button type="button" class="wf-bar-btn" disabled={busy} onclick={() => syncDraft(activeGraph)}>Discard</button>
      </div>
    </div>
  {/if}
  {#if feedback}<p class={`feedback ${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.text}</p>{/if}
  <div class="wf-body" role="status" aria-live="polite">
    {#if loadKind === "loading"}<p>Loading {tab === "graphs" ? "workflow graphs" : "recent workflow runs"}...</p>
    {:else if loadKind === "error"}<p class="feedback error" role="alert">{errorMsg}</p>
    {:else if tab === "graphs"}
      <div class="wf-mobile-nav" role="tablist" aria-label="Studio panes">
        <button type="button" role="tab" aria-selected={mobilePane === "library"} class:primary={mobilePane === "library"} onclick={() => { mobilePane = "library"; }}>Library</button>
        <button type="button" role="tab" aria-selected={mobilePane === "canvas"} class:primary={mobilePane === "canvas"} onclick={() => { mobilePane = "canvas"; }}>Inspect graph</button>
        <button type="button" role="tab" aria-selected={mobilePane === "inspector"} class:primary={mobilePane === "inspector"} onclick={() => { mobilePane = "inspector"; }}>Inspector</button>
      </div>
      <div class="wf-studio" data-mobile-pane={mobilePane}>
        <div class="wf-pane-lib">
          <WorkflowLibraryRail graphs={visibleGraphs} totalCount={graphs.length} activeId={activeGraph?.id ?? null} {filterQuery} {statusFilter} {busy}
            onFilterChange={(v) => { filterQuery = v; }} onStatusChange={(s) => { statusFilter = s; }}
            onSelect={selectGraph} onCreateFromTemplate={createFromTemplate} onDuplicate={duplicateGraph} onDelete={deleteGraph} />
        </div>
        <div class="wf-pane-canvas">
          {#if canvasSummary && draft}
            <WorkflowGraphCanvas graph={canvasSummary} nodes={draft.nodes} edges={draft.edges} {selectedNodeId} {selectedEdgeId}
              runNodeStates={runNodeStateMap(activeRun, activeGraph?.id ?? null)}
              onSelectNode={(id) => { selectedNodeId = id; selectedEdgeId = null; }} onSelectEdge={(id) => { selectedEdgeId = id; selectedNodeId = null; }}
              onMoveNode={(id, x, y) => { if (draft) draft = moveNodeInDraft(draft, id, x, y); }} {onConnect} {onDeleteSelection}
              onTidy={() => { if (draft) draft = tidyDraftLayout(draft); }} />
          {:else}<p class="wf-empty">Select a workflow from the library or create one from a starter template.</p>{/if}
        </div>
        <div class="wf-pane-insp">
          <WorkflowInspectorPanel {draft} {selectedNode} {selectedEdge} {onAddNode}
            onUpdateNode={(id, p) => { if (draft) draft = updateNodeInDraft(draft, id, p); }}
            onDeleteNode={(id) => { if (draft) { draft = removeNodeFromDraft(draft, id); selectedNodeId = null; } }}
            onUpdateEdge={(id, p) => { if (draft) draft = updateEdgeInDraft(draft, id, p); }}
            onDeleteEdge={(id) => { if (draft) { draft = removeEdgeFromDraft(draft, id); selectedEdgeId = null; } }}
            onUpdateDraftMeta={(p) => { if (draft) draft = { ...draft, ...p }; }} />
        </div>
      </div>
    {:else}
      <WorkflowRunsPanel runs={visibleRuns} {totalRuns} {filterQuery} stateFilter={runFilter} selectedRun={activeRun} loadingDetail={loadingRunDetail} {busy}
        onFilterChange={(v) => { filterQuery = v; }} onStateFilterChange={(s) => { runFilter = s; }}
        onInspectRun={inspectRun} {onStopRun} {onRetryRun} {onDeleteRun} />
    {/if}
  </div>
</section>

<style>
  .wf-tabs { display: inline-flex; gap: 0.375rem; flex-wrap: wrap; }
  .wf-draft-bar { margin-top: 0.625rem; padding: 0.5rem 0.75rem; border: 1px solid var(--warn); border-radius: 0.5rem; background: var(--warn-bg); display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
  .wf-unsaved-pill { font-size: 0.8rem; font-weight: 600; color: var(--warn); }
  .wf-bar-btn { min-height: 2rem; padding: 0.25rem 0.65rem; font-size: 0.8rem; }
  .wf-body { margin-top: 0.75rem; min-width: 0; }
  .wf-empty { margin: 0; padding: 1rem; border: 1px dashed var(--border); border-radius: 0.625rem; font-size: 0.85rem; color: var(--muted); }
  .wf-mobile-nav { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.35rem; margin-bottom: 0.625rem; }
  .wf-mobile-nav button { min-height: 2.1rem; padding: 0.25rem 0.4rem; font-size: 0.8rem; }
  .wf-studio { display: grid; gap: 0.75rem; min-width: 0; grid-template-columns: minmax(0, 1fr); }
  .wf-studio > div { min-width: 0; }
  @media (max-width: 959px) {
    .wf-studio[data-mobile-pane="library"] .wf-pane-canvas, .wf-studio[data-mobile-pane="library"] .wf-pane-insp { display: none; }
    .wf-studio[data-mobile-pane="canvas"] .wf-pane-lib, .wf-studio[data-mobile-pane="canvas"] .wf-pane-insp { display: none; }
    .wf-studio[data-mobile-pane="inspector"] .wf-pane-lib, .wf-studio[data-mobile-pane="inspector"] .wf-pane-canvas { display: none; }
  }
  @media (min-width: 960px) {
    .wf-mobile-nav { display: none; }
    .wf-studio { grid-template-columns: minmax(14rem, 16.5rem) minmax(0, 1fr) minmax(15rem, 18.5rem); align-items: start; }
  }
</style>
