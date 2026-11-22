<script lang="ts">
  import {
    createMemoryGraphController,
    type MemoryEdgeKind,
    type MemoryGraphNode,
    type MemoryGraphState,
    type MemoryNodeKind,
  } from "./memory-graph-api.ts";

  let { role = null, onOpenFile }: {
    role?: "viewer" | "operator" | "owner" | null;
    onOpenFile?: (path: string) => void;
  } = $props();

  type KindFilter = "all" | MemoryNodeKind;
  type NeighborLink = { nodeId: string; title: string; nodeKind: MemoryNodeKind | null; edgeKind: MemoryEdgeKind; resolved: boolean; direction: "out" | "in" };

  let view = $state<MemoryGraphState>({ kind: "loading" });
  let kindFilter = $state<KindFilter>("all");
  let filterQuery = $state("");
  let selectedId = $state<string | null>(null);
  let controller: ReturnType<typeof createMemoryGraphController> | undefined;

  let isOwner = $derived(role === "owner");

  let nodesById = $derived.by(() => {
    if (view.kind !== "ready") return new Map<string, MemoryGraphNode>();
    return new Map(view.graph.nodes.map((node) => [node.id, node]));
  });

  let visibleNodes = $derived.by<MemoryGraphNode[]>(() => {
    if (view.kind !== "ready") return [];
    const q = filterQuery.trim().toLowerCase();
    return view.graph.nodes.filter((node) => {
      if (kindFilter !== "all" && node.kind !== kindFilter) return false;
      if (!q) return true;
      return `${node.title} ${node.id} ${node.group} ${node.kind} ${node.excerpt ?? ""} ${node.path ?? ""}`.toLowerCase().includes(q);
    });
  });

  let selectedNode = $derived.by<MemoryGraphNode | null>(() => {
    if (view.kind !== "ready") return null;
    if (selectedId) {
      const exact = nodesById.get(selectedId);
      if (exact) return exact;
    }
    return visibleNodes[0] ?? null;
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
    return visibleNodes.length === 0 ? "no-filter-matches" : "ready";
  });

  function kindTone(kind: MemoryNodeKind): "ok" | "warn" | "neutral" {
    if (kind === "note" || kind === "knowledge") return "ok";
    if (kind === "ghost") return "warn";
    return "neutral";
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
      <button type="button" disabled={view.kind === "loading"} onclick={refresh}>
        {view.kind === "loading" ? "Loading..." : "Refresh"}
      </button>
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
    <div class="mg-counts" aria-label="Memory graph counts">
      <span class="pill" data-tone="ok">{view.graph.counts.notes} notes</span>
      <span class="pill">{view.graph.counts.memories} memories</span>
      <span class="pill" data-tone={view.graph.counts.ghosts > 0 ? "warn" : "neutral"}>{view.graph.counts.ghosts} ghosts</span>
      {#if view.graph.truncated}<span class="pill" data-tone="warn">truncated</span>{/if}
    </div>
    {#if view.graph.root}<p class="mg-meta">Root: <code>{view.graph.root}</code></p>{/if}
    {#if view.graph.warnings.length > 0}<p class="feedback pending" role="status">{view.graph.warnings.join(" | ")}</p>{/if}

    <div class="mg-controls">
      <div class="field">
        <label for="mg-kind">Kind</label>
        <select id="mg-kind" bind:value={kindFilter}>
          <option value="all">All kinds</option>
          <option value="note">Note</option>
          <option value="knowledge">Knowledge</option>
          <option value="memory">Memory</option>
          <option value="agent">Agent</option>
          <option value="folder">Folder</option>
          <option value="ghost">Ghost</option>
          <option value="tag">Tag</option>
        </select>
      </div>
      <div class="field">
        <label for="mg-search">Search nodes</label>
        <input id="mg-search" type="search" bind:value={filterQuery} placeholder="Title, group, excerpt, or path" />
      </div>
    </div>

    {#if view.graph.nodes.length === 0}
      <p>No memory graph nodes were found for this workspace.</p>
    {:else if visibleNodes.length === 0}
      <p>No memory nodes match the current filters.</p>
    {:else}
      <div class="mg-layout">
        <ul class="mg-list" aria-label="Memory graph nodes">
          {#each visibleNodes as node (node.id)}
            <li>
              <button type="button" class="mg-node-btn" class:selected={selectedNode?.id === node.id} aria-pressed={selectedNode?.id === node.id} onclick={() => { selectedId = node.id; }}>
                <span class="mg-node-title">{node.title}</span>
                <span class="mg-node-tags">
                  <span class="pill" data-tone={kindTone(node.kind)}>{node.kind}</span>
                  <span class="pill">{node.degree} links</span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
        {#if selectedNode}
          {@const activePath = selectedNode.path}
          <div class="mg-detail" aria-label="Selected memory node">
            <div class="mg-detail-head">
              <h3>{selectedNode.title}</h3>
              <span class="pill" data-tone={kindTone(selectedNode.kind)}>{selectedNode.kind}</span>
              {#if activePath && onOpenFile}
                <button type="button" class="primary" onclick={() => onOpenFile?.(activePath)}>Open in Editor</button>
              {/if}
            </div>
            <p class="mg-meta">Group: {selectedNode.group} | Degree: {selectedNode.degree}{#if selectedNode.origin} | Origin: {selectedNode.origin}{/if}</p>
            {#if activePath}<p class="mg-meta">Path: <code>{activePath}</code></p>{/if}
            {#if selectedNode.excerpt}<p class="mg-excerpt">{selectedNode.excerpt}</p>{/if}
            <h4>Linked neighbors ({neighbors.length})</h4>
            {#if neighbors.length === 0}
              <p class="mg-meta">No linked neighbors for this node.</p>
            {:else}
              <ul class="mg-neighbors" aria-label="Linked neighbor edges">
                {#each neighbors as link, i (`${link.direction}:${link.edgeKind}:${link.nodeId}:${i}`)}
                  <li>
                    <button type="button" class="mg-edge-btn" onclick={() => { selectedId = link.nodeId; }}>
                      <span>{link.direction === "out" ? "->" : "<-"} {link.title}</span>
                      <span class="pill" data-tone={link.resolved ? "neutral" : "warn"}>{link.edgeKind}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</section>

<style>
  .mg-counts { display: flex; flex-wrap: wrap; gap: 0.375rem; margin: 0.75rem 0 0.5rem; }
  .mg-controls { display: grid; grid-template-columns: minmax(9rem, 12rem) 1fr; gap: 0.75rem; margin: 0.75rem 0 1rem; }
  @media (max-width: 34rem) { .mg-controls { grid-template-columns: 1fr; } }
  .mg-layout { display: grid; grid-template-columns: minmax(14rem, 1fr) minmax(16rem, 1.2fr); gap: 0.75rem; align-items: start; }
  @media (max-width: 44rem) { .mg-layout { grid-template-columns: 1fr; } }
  .mg-list, .mg-neighbors { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.375rem; max-height: 22rem; overflow-y: auto; }
  .mg-node-btn, .mg-edge-btn { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; text-align: left; }
  .mg-node-btn.selected { border-color: var(--accent); background: var(--surface); }
  .mg-node-title { font-weight: 600; overflow-wrap: anywhere; }
  .mg-node-tags { display: inline-flex; gap: 0.25rem; flex-shrink: 0; }
  .mg-detail { padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--surface); display: grid; gap: 0.5rem; }
  .mg-detail-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
  .mg-detail h4 { margin: 0.25rem 0 0; font-size: 0.875rem; }
  .mg-meta { margin: 0; font-size: 0.8125rem; color: var(--muted); overflow-wrap: anywhere; }
  .mg-excerpt { margin: 0; font-size: 0.875rem; color: var(--text); white-space: pre-wrap; overflow-wrap: anywhere; }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
</style>
