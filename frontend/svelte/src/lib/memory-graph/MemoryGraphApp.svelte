<script lang="ts">
  import {
    createMemoryGraphController,
    type MemoryGraphEdge,
    type MemoryGraphNode,
    type MemoryGraphState,
    type MemoryNodeKind,
  } from "./memory-graph-api.ts";
  import { neighbourhood, type GraphLayoutName, type NeighborLink } from "./memory-graph-layout.ts";
  import MemoryGraphCanvas from "./MemoryGraphCanvas.svelte";
  import MemoryGraphFilters from "./MemoryGraphFilters.svelte";
  import MemoryGraphSummary from "./MemoryGraphSummary.svelte";
  import MemoryGraphInspector from "./MemoryGraphInspector.svelte";

  let { role = null, onOpenFile }: {
    role?: "viewer" | "operator" | "owner" | null;
    onOpenFile?: (path: string) => void;
  } = $props();

  const LAYOUTS: GraphLayoutName[] = ["web", "radial", "layered"];
  const KINDS: MemoryNodeKind[] = ["note", "knowledge", "memory", "agent", "folder", "ghost", "tag"];

  let view = $state<MemoryGraphState>({ kind: "loading" });
  let layout = $state<GraphLayoutName>("web");
  let kindFilter = $state<"all" | MemoryNodeKind>("all");
  let filterQuery = $state("");
  let selectedId = $state<string | null>(null);
  let hoverId = $state<string | null>(null);
  let showGhosts = $state(true);
  let showTags = $state(true);
  let showOrphans = $state(true);
  let focusMode = $state(false);
  let depth = $state(2);
  let hiddenGroups = $state<string[]>([]);
  let controller: ReturnType<typeof createMemoryGraphController> | undefined;

  let isOwner = $derived(role === "owner");

  let nodesById = $derived.by(() => new Map(
    view.kind === "ready" ? view.graph.nodes.map((node) => [node.id, node] as const) : [],
  ));

  let groups = $derived.by(() =>
    view.kind === "ready"
      ? [...new Set(view.graph.nodes.map((node) => node.group))].sort((a, b) => a.localeCompare(b))
      : []);

  let filteredNodes = $derived.by<MemoryGraphNode[]>(() => {
    if (view.kind !== "ready") return [];
    const query = filterQuery.trim().toLowerCase();
    return view.graph.nodes.filter((node) => {
      if (kindFilter !== "all" && node.kind !== kindFilter) return false;
      if (!showGhosts && node.kind === "ghost") return false;
      if (!showTags && node.kind === "tag") return false;
      if (hiddenGroups.includes(node.group)) return false;
      if (!query) return true;
      return `${node.title} ${node.id} ${node.group} ${node.kind} ${node.excerpt ?? ""} ${node.path ?? ""}`.toLowerCase().includes(query);
    });
  });

  let visibleEdges = $derived.by<MemoryGraphEdge[]>(() => {
    if (view.kind !== "ready") return [];
    const kept = new Set(filteredNodes.map((node) => node.id));
    return view.graph.edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target));
  });

  let visibleNodes = $derived.by<MemoryGraphNode[]>(() =>
    showOrphans ? filteredNodes : filteredNodes.filter((node) => node.degree > 0 || node.kind === "folder"));

  let renderNodes = $derived.by<MemoryGraphNode[]>(() => {
    if (!focusMode || visibleNodes.length === 0) return visibleNodes;
    const focus = selectedId ?? [...visibleNodes].sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id))[0]?.id;
    if (!focus) return visibleNodes;
    const near = neighbourhood(visibleEdges, focus, depth);
    const scoped = visibleNodes.filter((node) => near.has(node.id));
    return scoped.length > 0 ? scoped : visibleNodes;
  });

  let renderEdges = $derived.by<MemoryGraphEdge[]>(() => {
    const kept = new Set(renderNodes.map((node) => node.id));
    return visibleEdges.filter((edge) => kept.has(edge.source) && kept.has(edge.target));
  });

  let selectedNode = $derived.by<MemoryGraphNode | null>(() => {
    if (view.kind !== "ready") return null;
    if (selectedId) {
      const exact = nodesById.get(selectedId);
      if (exact) return exact;
    }
    return renderNodes[0] ?? null;
  });

  let neighbors = $derived.by<NeighborLink[]>(() => {
    if (view.kind !== "ready" || !selectedNode) return [];
    const out: NeighborLink[] = [];
    for (const edge of view.graph.edges) {
      if (edge.source === selectedNode.id) {
        const other = nodesById.get(edge.target);
        out.push({ nodeId: edge.target, title: other?.title ?? edge.target, nodeKind: other?.kind ?? null, edgeKind: edge.kind, resolved: edge.resolved, direction: "out" });
      } else if (edge.target === selectedNode.id) {
        const other = nodesById.get(edge.source);
        out.push({ nodeId: edge.source, title: other?.title ?? edge.source, nodeKind: other?.kind ?? null, edgeKind: edge.kind, resolved: edge.resolved, direction: "in" });
      }
    }
    return out;
  });

  let stateTag = $derived.by(() => {
    if (!isOwner) return "owner-only";
    if (view.kind !== "ready") return view.kind;
    if (view.graph.nodes.length === 0) return "empty";
    return renderNodes.length === 0 ? "no-filter-matches" : "ready";
  });

  function toggleGroup(group: string) {
    hiddenGroups = hiddenGroups.includes(group)
      ? hiddenGroups.filter((item) => item !== group)
      : [...hiddenGroups, group];
  }

  function openNode(node: MemoryGraphNode) {
    if (node.path && onOpenFile) { onOpenFile(node.path); return; }
    selectedId = node.id;
  }

  function resetFilters() {
    kindFilter = "all";
    filterQuery = "";
    showGhosts = true;
    showTags = true;
    showOrphans = true;
    focusMode = false;
    hiddenGroups = [];
    selectedId = null;
  }

  export function refresh() {
    if (isOwner) void controller?.refresh();
  }

  $effect(() => {
    if (!isOwner) {
      controller?.dispose();
      controller = undefined;
      return;
    }
    const next = createMemoryGraphController((s) => { view = s; });
    controller = next;
    void next.refresh();
    return () => {
      next.dispose();
      if (controller === next) controller = undefined;
    };
  });
</script>

<section aria-labelledby="memory-graph-title" aria-busy={isOwner && view.kind === "loading"} data-memory-graph-state={stateTag}>
  <header class="feature-header">
    <h2 id="memory-graph-title">Memory Graph</h2>
    {#if isOwner}
      <div class="actions">
        <div class="mg-layout-picker" role="group" aria-label="Graph layout">
          {#each LAYOUTS as name (name)}
            <button type="button" class:primary={layout === name} aria-pressed={layout === name} onclick={() => { layout = name; }}>{name}</button>
          {/each}
        </div>
        <button type="button" disabled={view.kind === "loading"} onclick={refresh}>{view.kind === "loading" ? "Loading..." : "Refresh"}</button>
      </div>
    {/if}
  </header>

  {#if !isOwner}
    <p class="feedback pending" role="status">
      Owner role is required to inspect the memory graph. Sign in from an Owner device to browse notes, memories, and links.
    </p>
  {:else if view.kind === "loading"}
    <p role="status">Loading memory graph...</p>
  {:else if view.kind === "error"}
    <p class="feedback error" role="alert">{view.message}</p>
  {:else}
    <MemoryGraphSummary graph={view.graph} />

    <MemoryGraphFilters
      query={filterQuery}
      kind={kindFilter}
      kinds={KINDS}
      {showGhosts}
      {showTags}
      {showOrphans}
      {focusMode}
      {depth}
      {groups}
      {hiddenGroups}
      onquery={(value) => { filterQuery = value; }}
      onkind={(value) => { kindFilter = value; }}
      ontoggles={(next) => {
        if (next.ghosts !== undefined) showGhosts = next.ghosts;
        if (next.tags !== undefined) showTags = next.tags;
        if (next.orphans !== undefined) showOrphans = next.orphans;
        if (next.focus !== undefined) focusMode = next.focus;
      }}
      ondepth={(value) => { depth = Math.min(4, Math.max(1, value)); }}
      ontoggle={toggleGroup}
      onreset={resetFilters}
    />

    {#if view.graph.nodes.length === 0}
      <p>No memory graph nodes were found for this workspace.</p>
    {:else if renderNodes.length === 0}
      <p>No memory nodes match the current filters.</p>
    {:else}
      <div class="mg-workspace">
        <div class="mg-canvas-slot">
          <MemoryGraphCanvas
            nodes={renderNodes}
            edges={renderEdges}
            {layout}
            selectedId={selectedNode?.id ?? null}
            {hoverId}
            onselect={(id) => { selectedId = id; }}
            onhover={(id) => { hoverId = id; }}
            onopen={openNode}
          />
          <p class="mg-meta">
            Showing {renderNodes.length} of {view.graph.nodes.length} {view.graph.nodes.length === 1 ? "node" : "nodes"}.
            Drag nodes, scroll to zoom, arrow keys pan the canvas when it has focus.
          </p>
        </div>
        <MemoryGraphInspector
          node={selectedNode}
          {neighbors}
          onselect={(id) => { selectedId = id; }}
          onopen={onOpenFile}
        />
      </div>
    {/if}
  {/if}
</section>

<style>
  .mg-layout-picker { display: inline-flex; gap: 0.25rem; flex-wrap: wrap; }
  .mg-layout-picker button { text-transform: capitalize; }
  .mg-workspace { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(15rem, 1fr); gap: 0.75rem; align-items: start; }
  @media (max-width: 52rem) { .mg-workspace { grid-template-columns: 1fr; } }
  .mg-canvas-slot { display: grid; gap: 0.375rem; min-width: 0; }
  .mg-canvas-slot :global(.mg-canvas) { min-height: 24rem; height: min(58vh, 32rem); }
  @media (max-width: 52rem) { .mg-canvas-slot :global(.mg-canvas) { height: 18rem; } }
  .mg-meta { margin: 0; font-size: 0.8125rem; color: var(--muted); overflow-wrap: anywhere; }
</style>
