<script lang="ts">
  import type { AgentVaultNote } from "./agent-vault-api.ts";
  import { buildTree, flattenTree, type FlatRow } from "./vault-tree.ts";

  let {
    notes, selectedPath, filter, kind, kinds, onfilter, onkind, onopen, onsync, syncing,
  }: {
    notes: AgentVaultNote[];
    selectedPath: string | null;
    filter: string;
    kind: string;
    kinds: string[];
    onfilter: (value: string) => void;
    onkind: (value: string) => void;
    onopen: (path: string) => void;
    onsync: () => void;
    syncing: boolean;
  } = $props();

  let collapsed = $state<string[]>([]);
  let searchOpen = $state(false);

  let filtered = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    return notes.filter((note) => {
      if (kind !== "all" && note.kind !== kind) return false;
      if (!q) return true;
      return `${note.title} ${note.path} ${note.kind} ${note.source}`.toLowerCase().includes(q);
    });
  });

  let rows = $derived.by<FlatRow[]>(() => {
    const tree = buildTree(filtered);
    // A search always reveals matches, collapsed folders included.
    return flattenTree(tree, filter.trim() ? [] : collapsed);
  });

  let dirCount = $derived(rows.filter((row) => row.kind === "dir").length);

  function toggle(path: string) {
    collapsed = collapsed.includes(path)
      ? collapsed.filter((item) => item !== path)
      : [...collapsed, path];
  }

  function collapseAll() {
    collapsed = rows.filter((row): row is Extract<FlatRow, { kind: "dir" }> => row.kind === "dir").map((row) => row.path);
  }
</script>

<aside class="vault-tree" aria-label="Vault notes">
  <div class="vault-tree-head">
    <div class="vault-tree-actions">
      <button type="button" onclick={() => { searchOpen = !searchOpen; }} aria-pressed={searchOpen}>
        {searchOpen ? "Hide search" : "Search"}
      </button>
      <button type="button" onclick={collapseAll} disabled={dirCount === 0}>Collapse</button>
      <button type="button" class="primary" disabled={syncing} onclick={onsync}>
        {syncing ? "Syncing..." : "Sync Vault"}
      </button>
    </div>
    {#if searchOpen}
      <div class="vault-tree-filters">
        <input
          type="search"
          aria-label="Search vault notes"
          placeholder="Search title, path, or source"
          value={filter}
          oninput={(event) => onfilter(event.currentTarget.value)}
        />
        <select aria-label="Note kind" value={kind} onchange={(event) => onkind(event.currentTarget.value)}>
          <option value="all">All notes</option>
          {#each kinds as value (value)}<option value={value}>{value}</option>{/each}
        </select>
      </div>
    {/if}
    <p class="vault-tree-count">{filtered.length} of {notes.length} {notes.length === 1 ? "note" : "notes"}</p>
  </div>

  {#if rows.length === 0}
    <p class="vault-tree-empty">No notes match this filter.</p>
  {:else}
    <ul class="vault-tree-list" role="tree" aria-label="Snapshot files">
      {#each rows as row (row.path)}
        <li role="treeitem" aria-expanded={row.kind === "dir" ? row.open : undefined} aria-selected={row.kind === "note" && selectedPath === row.path}>
          {#if row.kind === "dir"}
            <button
              type="button"
              class="vault-dir"
              style={`padding-left: ${0.4 + row.depth * 0.75}rem`}
              onclick={() => toggle(row.path)}
            >
              <span class="vault-caret" aria-hidden="true">{row.open ? "v" : ">"}</span>
              <span class="vault-dir-name">{row.name}</span>
              <span class="vault-dir-count">{row.count}</span>
            </button>
          {:else}
            <button
              type="button"
              class="vault-note"
              class:selected={selectedPath === row.path}
              aria-current={selectedPath === row.path ? "true" : undefined}
              style={`padding-left: ${0.4 + row.depth * 0.75}rem`}
              onclick={() => onopen(row.path)}
            >
              <span class="vault-note-name">{row.note.title}</span>
              <span class="vault-note-kind">{row.note.kind}</span>
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</aside>

<style>
  .vault-tree { display: flex; flex-direction: column; min-width: 0; min-height: 0; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--surface); overflow: hidden; }
  .vault-tree-head { display: grid; gap: 0.375rem; padding: 0.5rem; border-bottom: 1px solid var(--border); }
  .vault-tree-actions { display: flex; gap: 0.3rem; flex-wrap: wrap; }
  .vault-tree-actions button { font-size: 0.75rem; padding: 0.2rem 0.5rem; min-height: 1.9rem; }
  .vault-tree-filters { display: grid; gap: 0.3rem; }
  .vault-tree-filters input, .vault-tree-filters select { width: 100%; min-width: 0; font-size: 0.8125rem; min-height: 2rem; padding: 0.2rem 0.4rem; }
  .vault-tree-count { margin: 0; font-size: 0.7rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  .vault-tree-empty { margin: 0; padding: 0.75rem; font-size: 0.8125rem; color: var(--muted); }
  .vault-tree-list { list-style: none; margin: 0; padding: 0 0 0.4rem; overflow-y: auto; min-height: 0; flex: 1; }
  .vault-dir, .vault-note { width: 100%; display: flex; align-items: center; gap: 0.35rem; text-align: left; border: 0; border-radius: 0; background: none; font-size: 0.8125rem; min-height: 2rem; padding-block: 0.2rem; padding-right: 0.4rem; }
  .vault-dir:hover, .vault-note:hover { background: color-mix(in srgb, var(--muted) 12%, transparent); }
  .vault-note.selected { background: color-mix(in srgb, var(--accent) 16%, transparent); font-weight: 600; }
  .vault-caret { width: 0.75rem; flex: 0 0 auto; color: var(--muted); font-size: 0.7rem; }
  .vault-dir-name, .vault-note-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
  .vault-dir-count, .vault-note-kind { flex: 0 0 auto; font-size: 0.65rem; color: var(--muted); }
</style>
