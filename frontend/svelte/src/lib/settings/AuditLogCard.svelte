<script lang="ts">
  import {
    createAuditLogController,
    type AuditEntry,
    type AuditLogState,
  } from "./host-ops-api.ts";

  let { role = null }: { role?: "viewer" | "operator" | "owner" | null } = $props();

  let view = $state<AuditLogState>({ kind: "loading" });
  let filterQuery = $state("");
  let outcomeFilter = $state<"all" | "ok" | "failed">("all");
  let controller: ReturnType<typeof createAuditLogController> | undefined;

  let isOwner = $derived(role === "owner");

  let visibleEntries = $derived.by<AuditEntry[]>(() => {
    if (view.kind !== "ready") return [];
    const q = filterQuery.trim().toLowerCase();
    return view.entries.filter((entry) => {
      if (outcomeFilter === "ok" && entry.ok === false) return false;
      if (outcomeFilter === "failed" && entry.ok !== false) return false;
      if (!q) return true;
      const haystack = `${entry.action} ${entry.actor ?? ""} ${entry.target ?? ""} ${entry.detail ?? ""} ${entry.ip ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  });

  let stateTag = $derived.by(() => {
    if (!isOwner) return "owner-only";
    if (view.kind !== "ready") return view.kind;
    if (view.entries.length === 0) return "empty";
    return visibleEntries.length === 0 ? "no-filter-matches" : "ready";
  });

  function formatTimestamp(ts?: string): string {
    if (!ts) return "-";
    const parsed = Date.parse(ts);
    return Number.isNaN(parsed) ? ts : new Date(parsed).toLocaleString();
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
    const next = createAuditLogController((s) => { view = s; });
    controller = next;
    void next.refresh();
    return () => {
      next.dispose();
      if (controller === next) controller = undefined;
    };
  });
</script>

<section aria-labelledby="audit-log-title" aria-busy={isOwner && view.kind === "loading"} data-audit-log-state={stateTag}>
  <header class="feature-header">
    <div class="audit-title-group">
      <h2 id="audit-log-title">Host audit log</h2>
      {#if isOwner && view.kind === "ready"}
        <span class="audit-count">{visibleEntries.length} of {view.entries.length}</span>
      {/if}
    </div>
    {#if isOwner}
      <button type="button" disabled={view.kind === "loading"} onclick={refresh}>
        {view.kind === "loading" ? "Loading..." : "Refresh"}
      </button>
    {/if}
  </header>

  {#if !isOwner}
    <p class="feedback pending" role="status">
      Owner role is required to inspect the host audit log. Sign in from an Owner device to review recent actions.
    </p>
  {:else}
    <div class="audit-controls">
      <div class="field audit-search">
        <label for="audit-filter-input">Filter audit events</label>
        <input
          id="audit-filter-input"
          type="search"
          bind:value={filterQuery}
          placeholder="Action, actor, target, detail, or IP"
        />
      </div>
      <div class="field audit-outcome">
        <label for="audit-outcome-select">Outcome</label>
        <select id="audit-outcome-select" bind:value={outcomeFilter}>
          <option value="all">All events</option>
          <option value="ok">Succeeded</option>
          <option value="failed">Failed</option>
        </select>
      </div>
    </div>

    <div role="status" aria-live="polite">
      {#if view.kind === "loading"}
        <p>Loading recent host audit events...</p>
      {:else if view.kind === "error"}
        <p class="feedback error" role="alert">{view.message}</p>
      {:else if view.entries.length === 0}
        <p>No recent host audit events recorded.</p>
      {:else if visibleEntries.length === 0}
        <p>No audit events match the current filter.</p>
      {:else}
        <div class="audit-table-wrap">
          <table class="audit-table" aria-label="Recent host audit events">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Action</th>
                <th scope="col">Actor</th>
                <th scope="col">Target</th>
                <th scope="col">Outcome</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {#each visibleEntries as entry, index (`${entry.ts ?? ""}-${entry.action}-${index}`)}
                <tr>
                  <td class="audit-time">{formatTimestamp(entry.ts)}</td>
                  <td><code>{entry.action}</code></td>
                  <td>{entry.actor ?? "-"}</td>
                  <td class="audit-wrap">{entry.target ?? "-"}</td>
                  <td>
                    {#if entry.ok === false}
                      <span class="outcome-pill" data-tone="error">Failed</span>
                    {:else if entry.ok === true}
                      <span class="outcome-pill" data-tone="ok">OK</span>
                    {:else}
                      <span class="outcome-pill" data-tone="neutral">Recorded</span>
                    {/if}
                  </td>
                  <td class="audit-wrap">{entry.detail ?? "-"}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  .audit-title-group { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .audit-count { font-size: 0.8125rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  .audit-controls { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: end; margin: 1rem 0; }
  .audit-search { flex: 1 1 14rem; }
  .audit-outcome { flex: 0 1 10rem; }
  .audit-table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 0.375rem; }
  .audit-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; text-align: left; }
  .audit-table th, .audit-table td { padding: 0.5rem 0.625rem; border-bottom: 1px solid var(--border); vertical-align: top; }
  .audit-table thead th { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); background: var(--surface); }
  .audit-table tbody tr:last-child td { border-bottom: none; }
  .audit-time { white-space: nowrap; font-variant-numeric: tabular-nums; color: var(--muted); }
  .audit-wrap { overflow-wrap: anywhere; max-width: 18rem; }
  .outcome-pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
  .outcome-pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .outcome-pill[data-tone="error"] { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
</style>
