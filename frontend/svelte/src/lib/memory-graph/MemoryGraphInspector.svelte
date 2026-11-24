<script lang="ts">
  import type { MemoryNodeKind } from "./memory-graph-api.ts";
  import type { NeighborLink } from "./memory-graph-layout.ts";

  let { node, neighbors, onselect, onopen }: {
    node: { title: string; kind: MemoryNodeKind; group: string; degree: number; origin?: string; path?: string; excerpt?: string } | null;
    neighbors: NeighborLink[];
    onselect: (id: string) => void;
    onopen?: (path: string) => void;
  } = $props();

  function kindTone(kind: MemoryNodeKind): "ok" | "warn" | "neutral" {
    if (kind === "note" || kind === "knowledge") return "ok";
    if (kind === "ghost") return "warn";
    return "neutral";
  }

  let outgoing = $derived(neighbors.filter((link) => link.direction === "out"));
  let incoming = $derived(neighbors.filter((link) => link.direction === "in"));
</script>

<aside class="mg-inspector" aria-label="Selected memory node">
  {#if node}
    {@const activePath = node.path}
    <div class="mg-detail-head">
      <h3>{node.title}</h3>
      <span class="pill" data-tone={kindTone(node.kind)}>{node.kind}</span>
    </div>
    <dl class="mg-meta-grid">
      <div><dt>Group</dt><dd>{node.group}</dd></div>
      <div><dt>Degree</dt><dd>{node.degree}</dd></div>
      {#if node.origin}<div><dt>Origin</dt><dd>{node.origin}</dd></div>{/if}
    </dl>
    {#if activePath}<p class="mg-meta">Path: <code>{activePath}</code></p>{/if}
    {#if node.kind === "ghost"}
      <p class="mg-meta">Unresolved wikilink. No note in this graph uses that title yet.</p>
    {/if}
    {#if node.excerpt}<p class="mg-excerpt">{node.excerpt}</p>{/if}
    {#if activePath && onopen}
      <button type="button" class="primary" onclick={() => onopen?.(activePath)}>Open in Code Editor</button>
    {/if}

    <h4>Outgoing ({outgoing.length})</h4>
    {#if outgoing.length === 0}
      <p class="mg-meta">No outgoing links from this node.</p>
    {:else}
      <ul class="mg-neighbors" aria-label="Outgoing links">
        {#each outgoing as link, i (`out:${link.edgeKind}:${link.nodeId}:${i}`)}
          <li>
            <button type="button" class="mg-edge-btn" onclick={() => onselect(link.nodeId)}>
              <span class="mg-edge-label">{link.title}</span>
              <span class="pill" data-tone={link.resolved ? "neutral" : "warn"}>{link.edgeKind}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    <h4>Incoming ({incoming.length})</h4>
    {#if incoming.length === 0}
      <p class="mg-meta">No incoming links to this node.</p>
    {:else}
      <ul class="mg-neighbors" aria-label="Incoming links">
        {#each incoming as link, i (`in:${link.edgeKind}:${link.nodeId}:${i}`)}
          <li>
            <button type="button" class="mg-edge-btn" onclick={() => onselect(link.nodeId)}>
              <span class="mg-edge-label">{link.title}</span>
              <span class="pill" data-tone={link.resolved ? "neutral" : "warn"}>{link.edgeKind}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {:else}
    <p class="mg-meta">Select a node to inspect its metadata and links.</p>
  {/if}
</aside>

<style>
  .mg-inspector { padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--surface); display: grid; gap: 0.5rem; min-width: 0; }
  .mg-detail-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
  .mg-meta-grid { margin: 0; grid-template-columns: repeat(auto-fit, minmax(min(6rem, 100%), 1fr)); }
  .mg-inspector h3 { overflow-wrap: anywhere; }
  .mg-inspector h4 { margin: 0.25rem 0 0; font-size: 0.875rem; }
  .mg-meta { margin: 0; font-size: 0.8125rem; color: var(--muted); overflow-wrap: anywhere; }
  .mg-excerpt { margin: 0; font-size: 0.875rem; color: var(--text); white-space: pre-wrap; overflow-wrap: anywhere; }
  .mg-neighbors { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.375rem; max-height: 12rem; overflow-y: auto; }
  .mg-edge-btn { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; text-align: left; font-size: 0.8125rem; }
  .mg-edge-label { overflow-wrap: anywhere; }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
</style>
