<script lang="ts">
  import type { MemoryGraphDocument } from "./memory-graph-api.ts";

  let { graph }: { graph: MemoryGraphDocument } = $props();
</script>

<div class="mg-counts" aria-label="Memory graph counts">
  <span class="pill" data-tone="ok">{graph.counts.notes} notes</span>
  <span class="pill">{graph.counts.memories} memories</span>
  <span class="pill" data-tone={graph.counts.ghosts > 0 ? "warn" : "neutral"}>{graph.counts.ghosts} ghosts</span>
  <span class="pill">{graph.nodes.length} nodes</span>
  <span class="pill">{graph.edges.length} links</span>
  {#if graph.truncated}<span class="pill" data-tone="warn">truncated</span>{/if}
</div>
{#if graph.root}<p class="mg-meta">Root: <code>{graph.root}</code></p>{/if}
{#if graph.warnings.length > 0}<p class="feedback pending" role="status">{graph.warnings.join(" | ")}</p>{/if}

<style>
  .mg-counts { display: flex; flex-wrap: wrap; gap: 0.375rem; margin: 0.75rem 0 0.5rem; }
  .mg-meta { margin: 0; font-size: 0.8125rem; color: var(--muted); overflow-wrap: anywhere; }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
</style>
