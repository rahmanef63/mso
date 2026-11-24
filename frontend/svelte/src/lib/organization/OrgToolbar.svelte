<script lang="ts">
  let {
    title, revision, mode, canEdit, hasUnits, loading, unitId, counts, onmode, onnewunit, onnewseat, onrefresh, onclearscope,
  }: {
    title: string;
    revision: string | null;
    mode: "chart" | "list";
    canEdit: boolean;
    hasUnits: boolean;
    loading: boolean;
    unitId: string;
    counts: { units: number; seats: number };
    onmode: (mode: "chart" | "list") => void;
    onnewunit: () => void;
    onnewseat: () => void;
    onrefresh: () => void;
    onclearscope: () => void;
  } = $props();
</script>

<header class="feature-header">
  <div class="org-title-wrap">
    <h2 id="org-title">{title}</h2>
    {#if revision}<code class="org-rev" title={revision}>rev {revision.slice(0, 12)}</code>{/if}
  </div>
  <div class="actions">
    <div class="org-mode" role="group" aria-label="Organization view mode">
      <button type="button" class:primary={mode === "chart"} aria-pressed={mode === "chart"} onclick={() => onmode("chart")}>Chart</button>
      <button type="button" class:primary={mode === "list"} aria-pressed={mode === "list"} onclick={() => onmode("list")}>List</button>
    </div>
    {#if canEdit && revision}
      <button type="button" onclick={onnewunit}>New unit</button>
      <button type="button" disabled={!hasUnits} onclick={onnewseat}>New seat</button>
    {/if}
    <button type="button" disabled={loading} onclick={onrefresh}>{loading ? "Loading..." : "Refresh"}</button>
  </div>
</header>

<div class="org-scope">
  {#if unitId}
    <span class="org-pill">Scoped to unit</span>
    <button type="button" onclick={onclearscope}>Back to all units</button>
  {:else}
    <span class="org-summary">
      {counts.units} {counts.units === 1 ? "unit" : "units"} · {counts.seats} {counts.seats === 1 ? "seat" : "seats"}
    </span>
  {/if}
</div>

<style>
  .org-title-wrap { display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap; }
  .org-rev { font-size: 0.75rem; color: var(--muted); padding: 0.125rem 0.375rem; border: 1px solid var(--border); border-radius: 0.25rem; }
  .org-mode { display: inline-flex; gap: 0.25rem; flex-wrap: wrap; }
  .org-scope { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin: 0.75rem 0 0.5rem; }
  .org-summary { font-size: 0.875rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  .org-pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
</style>
