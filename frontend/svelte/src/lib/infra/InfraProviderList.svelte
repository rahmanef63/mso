<script lang="ts">
  import type { ConvexProjectKind, DoctorResult, InfraProviderRow } from "./infra-workspace-api.ts";

  let {
    rows,
    doctorById,
    filterQuery = $bindable(""),
    onSelect,
  }: {
    rows: InfraProviderRow[];
    doctorById: Map<string, DoctorResult>;
    filterQuery?: string;
    onSelect: (id: string) => void;
  } = $props();

  export function convexKindLabel(kind: ConvexProjectKind | null): string {
    return kind === "self-hosted" ? "self-hosted project" : kind === "cloud" ? "cloud project" : "project";
  }

  export function doctorTone(result: DoctorResult | undefined): "ok" | "warn" | "danger" | "neutral" {
    if (!result) return "neutral";
    if (result.ok === true) return "ok";
    if (result.ok === false) return "danger";
    return "warn";
  }

  export function doctorLabel(result: DoctorResult | undefined): string {
    if (!result) return "not run";
    if (result.ok === true) return "healthy";
    if (result.ok === false) return "failing";
    return "not configured";
  }

  let all = $derived(rows);
  let visible = $derived.by<InfraProviderRow[]>(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return all;
    return all.filter((row) =>
      `${row.id} ${row.label} ${row.configured ? "configured" : "unconfigured"} ${row.convexKind ?? ""} ${row.fields.join(" ")} ${row.missing.join(" ")}`
        .toLowerCase().includes(q));
  });
</script>

<div class="infra-filter-wrap">
  <label for="infra-filter">Filter providers</label>
  <input id="infra-filter" type="search" bind:value={filterQuery} placeholder="Provider, project kind, required field, or status" />
</div>

{#if all.length === 0}
  <p>No infrastructure providers are registered for this installation.</p>
{:else if visible.length === 0}
  <p>No providers match "{filterQuery.trim()}".</p>
{:else}
  <ul class="infra-list" aria-label="Infrastructure providers">
    {#each visible as row (row.id)}
      {@const result = doctorById.get(row.id)}
      <li class="infra-row">
        <div class="infra-info">
          <div class="infra-heading">
            <strong>{row.label}</strong>
            <code>{row.id}</code>
            <span class="pill" data-tone={row.configured ? "ok" : "warn"}>{row.configured ? "configured" : "unconfigured"}</span>
            {#if row.convexKind}<span class="pill">{convexKindLabel(row.convexKind)}</span>{/if}
            <span class="pill" data-tone={doctorTone(result)}>{doctorLabel(result)}</span>
          </div>
          {#if row.convexKind}
            <p class="infra-meta">
              One Convex provider, two deployment kinds. Switch the project rather than adding a second provider.
            </p>
          {/if}
          {#if row.fields.length > 0}<p class="infra-meta">Fields: {row.fields.join(", ")}</p>{/if}
          {#if row.missing.length > 0}<p class="infra-warn">Missing: {row.missing.join(", ")}</p>{/if}
          {#if result}<p class="infra-meta">{result.detail}</p>{/if}
        </div>
        <div class="infra-row-actions">
          <button type="button" onclick={() => onSelect(row.id)}>{row.configured ? "Reconfigure" : "Configure"}</button>
        </div>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .infra-filter-wrap { display: grid; gap: 0.375rem; margin: 0.75rem 0; }
  .infra-filter-wrap label { font-size: 0.875rem; font-weight: 600; color: var(--text); }
  .infra-filter-wrap input { width: 100%; min-width: 0; min-height: var(--ui-control-height); }
  .infra-list { list-style: none; padding: 0; margin: 0.5rem 0 0; display: grid; gap: 0.625rem; }
  .infra-row { display: flex; gap: 0.625rem; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel); }
  .infra-info { display: grid; gap: 0.25rem; min-width: 0; flex: 1 1 14rem; }
  .infra-heading { display: flex; align-items: center; gap: 0.375rem; flex-wrap: wrap; }
  .infra-heading code { font-size: 0.75rem; color: var(--muted); }
  .infra-meta { margin: 0; font-size: 0.8125rem; color: var(--muted); overflow-wrap: anywhere; }
  .infra-warn { margin: 0; font-size: 0.8125rem; color: var(--warn); }
  .infra-row-actions { display: flex; gap: 0.375rem; flex-wrap: wrap; }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.7rem; color: var(--muted); }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
  .pill[data-tone="danger"] { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
  @media (max-width: 420px) { .infra-row-actions button { flex: 1 1 100%; } }
</style>
