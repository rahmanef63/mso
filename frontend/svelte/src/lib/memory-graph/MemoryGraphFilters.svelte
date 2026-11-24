<script lang="ts">
  import type { MemoryNodeKind } from "./memory-graph-api.ts";
  import { groupColor } from "./memory-graph-layout.ts";

  let {
    query, kind, kinds, showGhosts, showTags, showOrphans, focusMode, depth, groups, hiddenGroups,
    onquery, onkind, ontoggles, ondepth, ontoggle, onreset,
  }: {
    query: string;
    kind: "all" | MemoryNodeKind;
    kinds: MemoryNodeKind[];
    showGhosts: boolean;
    showTags: boolean;
    showOrphans: boolean;
    focusMode: boolean;
    depth: number;
    groups: string[];
    hiddenGroups: string[];
    onquery: (value: string) => void;
    onkind: (value: "all" | MemoryNodeKind) => void;
    ontoggles: (next: { ghosts?: boolean; tags?: boolean; orphans?: boolean; focus?: boolean }) => void;
    ondepth: (value: number) => void;
    ontoggle: (group: string) => void;
    onreset: () => void;
  } = $props();
</script>

<div class="mg-controls">
  <div class="field mg-search">
    <label for="mg-search">Search nodes</label>
    <input
      id="mg-search"
      type="search"
      value={query}
      placeholder="Title, group, excerpt, or path"
      oninput={(event) => onquery(event.currentTarget.value)}
    />
  </div>
  <div class="field mg-kind">
    <label for="mg-kind">Kind</label>
    <select id="mg-kind" value={kind} onchange={(event) => onkind(event.currentTarget.value as "all" | MemoryNodeKind)}>
      <option value="all">All kinds</option>
      {#each kinds as value (value)}<option value={value}>{value}</option>{/each}
    </select>
  </div>
</div>

<div class="mg-filters" role="group" aria-label="Graph filters">
  <label class="mg-toggle"><input type="checkbox" checked={showGhosts} onchange={() => ontoggles({ ghosts: !showGhosts })} /> Ghosts</label>
  <label class="mg-toggle"><input type="checkbox" checked={showTags} onchange={() => ontoggles({ tags: !showTags })} /> Tags</label>
  <label class="mg-toggle"><input type="checkbox" checked={showOrphans} onchange={() => ontoggles({ orphans: !showOrphans })} /> Orphans</label>
  <label class="mg-toggle"><input type="checkbox" checked={focusMode} onchange={() => ontoggles({ focus: !focusMode })} /> Focus neighbourhood</label>
  {#if focusMode}
    <label class="mg-toggle mg-depth">
      Hops
      <input type="number" min="1" max="4" value={depth} aria-label="Neighbourhood hops" oninput={(event) => ondepth(Number(event.currentTarget.value) || 1)} />
    </label>
  {/if}
  <button type="button" onclick={onreset}>Reset filters</button>
</div>

{#if groups.length > 0}
  <div class="mg-groups" role="group" aria-label="Group visibility">
    {#each groups as group (group)}
      {@const hidden = hiddenGroups.includes(group)}
      <button
        type="button"
        class="mg-group-pill"
        aria-pressed={!hidden}
        style={`border-color: ${groupColor(group, groups)}`}
        onclick={() => ontoggle(group)}
      >{group}</button>
    {/each}
  </div>
{/if}

<style>
  .mg-controls { display: grid; grid-template-columns: minmax(9rem, 12rem) minmax(0, 1fr); gap: 0.75rem; margin: 0.75rem 0 0.5rem; }
  @media (max-width: 34rem) { .mg-controls { grid-template-columns: 1fr; } }
  .mg-filters, .mg-groups { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem; }
  .mg-toggle { display: inline-flex; align-items: center; gap: 0.375rem; font-size: 0.8125rem; color: var(--muted); min-height: var(--ui-control-height); }
  .mg-toggle input[type="checkbox"] { min-height: 0; padding: 0; width: 1rem; height: 1rem; }
  .mg-depth input { width: 3.5rem; min-height: 1.9rem; padding: 0.1rem 0.375rem; }
  .mg-group-pill { border-radius: 999px; font-size: 0.75rem; padding: 0.125rem 0.625rem; min-height: 1.9rem; color: var(--muted); }
  .mg-group-pill[aria-pressed="true"] { color: var(--text); font-weight: 600; }
  .mg-group-pill[aria-pressed="false"] { opacity: 0.5; text-decoration: line-through; }
</style>
