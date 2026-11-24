<script lang="ts">
  import { onMount } from "svelte";
  import {
    createPackagesController,
    type PackageUpdate,
    type PackagesState,
  } from "./managed-apps-api";
  import {
    filterPackages, nextDirection, packageCounts, packageStatus, STATUS_FILTERS,
    ariaSort, type PackageSortKey, type PackageStatusFilter, type SortDirection,
  } from "./packages-view";

  let view = $state<PackagesState>({ kind: "loading" });
  let filterQuery = $state("");
  let status = $state<PackageStatusFilter>("all");
  let sortKey = $state<PackageSortKey>("name");
  let direction = $state<SortDirection>("asc");
  let controller: ReturnType<typeof createPackagesController> | undefined;

  let summary = $derived(view.kind === "ready" || view.kind === "unavailable" ? view.summary : null);
  let counts = $derived(summary ? packageCounts(summary) : null);
  let visible = $derived(
    summary ? filterPackages(summary.updates, status, filterQuery, sortKey, direction) : [],
  );
  let stateTag = $derived.by(() => {
    if (view.kind !== "ready") return view.kind;
    if (view.summary.updates.length === 0) return "empty";
    return visible.length === 0 ? "no-filter-matches" : "ready";
  });

  export function refresh() {
    void controller?.refresh();
  }

  function toggleSort(key: PackageSortKey) {
    if (sortKey === key) direction = nextDirection(direction);
    else {
      sortKey = key;
      direction = "asc";
    }
  }

  function rowKey(pkg: PackageUpdate): string {
    return `${pkg.name}:${pkg.architecture ?? ""}`;
  }

  const COLUMNS: { key: PackageSortKey; label: string }[] = [
    { key: "name", label: "Package" },
    { key: "current", label: "Installed" },
    { key: "candidate", label: "Candidate" },
    { key: "architecture", label: "Arch" },
  ];

  onMount(() => {
    controller = createPackagesController((next) => { view = next; });
    void controller.refresh();
    return () => controller?.dispose();
  });
</script>

<section aria-labelledby="packages-cache-title" aria-busy={view.kind === "loading"} data-packages-state={stateTag}>
  <header class="feature-header">
    <h2 id="packages-cache-title">Packages (cache)</h2>
    <button disabled={view.kind === "loading"} onclick={refresh}>
      {view.kind === "loading" ? "Loading..." : "Refresh cache view"}
    </button>
  </header>

  <p class="pkg-note">
    Read-only view of the local package cache. MSO does not refresh, install, or upgrade packages from this panel.
  </p>

  {#if counts}
    <ul class="summaries" aria-label="Package cache summary">
      <li><span class="num">{counts.total}</span><span class="label">Cached entries</span></li>
      <li data-tone="warn"><span class="num">{counts.upgradable}</span><span class="label">Upgradable</span></li>
      <li><span class="num">{counts.installed}</span><span class="label">Already current</span></li>
      <li data-tone="muted"><span class="num">{counts.unknown}</span><span class="label">Version unknown</span></li>
    </ul>
  {/if}

  <div class="filters">
    <div class="tabs" role="tablist" aria-label="Filter cached packages by status">
      {#each STATUS_FILTERS as item (item.id)}
        <button
          role="tab"
          id={`pkg-tab-${item.id}`}
          aria-selected={status === item.id}
          class={status === item.id ? "active" : ""}
          onclick={() => { status = item.id; }}
        >
          {item.label}
        </button>
      {/each}
    </div>
    <div class="search">
      <label for="packages-cache-filter">Search cached packages</label>
      <input id="packages-cache-filter" type="search" bind:value={filterQuery} placeholder="Package name, version, or architecture" />
    </div>
  </div>

  <div role="status" aria-live="polite">
    {#if view.kind === "loading"}
      <p>Reading local package cache...</p>
    {:else if view.kind === "unavailable"}
      <p class="feedback pending">{view.message}</p>
    {:else if view.kind === "error"}
      <p class="feedback error" role="alert">{view.message}</p>
    {:else}
      <div class="pkg-meta">
        <span class="pill">{view.summary.manager ?? "unknown manager"}</span>
        <span class="pill">{view.summary.source}</span>
        <span class="stamp">Snapshot from {view.summary.checkedAt}</span>
      </div>
      {#if view.summary.truncated}
        <p class="pkg-note">Listing capped for safety. Narrow the filter or inspect the host for the full set.</p>
      {/if}
      {#if view.summary.updates.length === 0}
        <p>No cached package updates reported by the host.</p>
      {:else if visible.length === 0}
        <p>No cached packages match this view.</p>
      {:else}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex: the table scrolls, so it must take focus -->
        <div class="pkg-scroll" role="region" aria-label="Cached package updates" tabindex="0">
          <table class="pkg-table">
            <caption class="sr-only">Cached package updates reported by the local package manager</caption>
            <thead>
              <tr>
                {#each COLUMNS as column (column.key)}
                  <th scope="col" aria-sort={ariaSort(sortKey === column.key, direction)}>
                    <button class="sort" onclick={() => toggleSort(column.key)}>
                      {column.label}
                      <span aria-hidden="true">{sortKey === column.key ? (direction === "asc" ? "▲" : "▼") : "↕"}</span>
                    </button>
                  </th>
                {/each}
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {#each visible as pkg (rowKey(pkg))}
                <tr>
                  <td><code>{pkg.name}</code></td>
                  <td><code>{pkg.current ?? "unknown"}</code></td>
                  <td><code>{pkg.candidate}</code></td>
                  <td>{pkg.architecture ?? "-"}</td>
                  <td>
                    <span class="pill" data-tone={packageStatus(pkg) === "upgradable" ? "warn" : "neutral"}>
                      {packageStatus(pkg) === "upgradable" ? "upgradable" : packageStatus(pkg) === "installed" ? "current" : "unknown"}
                    </span>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {/if}
  </div>
</section>

<style>
  .pkg-note { margin: 0.5rem 0 0; font-size: 0.875rem; color: var(--muted); }
  .summaries { list-style: none; display: grid; gap: 0.5rem; margin: 0.75rem 0; padding: 0; grid-template-columns: repeat(auto-fit, minmax(min(100%, 8rem), 1fr)); }
  .summaries li {
    display: grid; gap: 0.125rem; min-width: 0; padding: 0.625rem;
    border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel);
  }
  .summaries .num { font-size: 1.25rem; font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; }
  .summaries .label { font-size: 0.75rem; color: var(--muted); }
  .summaries li[data-tone="warn"] .num { color: var(--warn); }
  .summaries li[data-tone="muted"] .num { color: var(--muted); }
  .filters { display: grid; gap: 0.75rem; margin: 1rem 0; }
  .tabs { display: flex; gap: 0.25rem; flex-wrap: wrap; }
  .tabs button {
    min-height: 2rem; padding: 0 0.75rem; border: 1px solid var(--border); border-radius: 999px;
    background: var(--panel-solid); color: var(--muted); font-size: 0.8125rem; font-weight: 600; cursor: pointer;
  }
  .tabs button.active { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
  .search { display: grid; gap: 0.375rem; }
  .search label { font-size: 0.875rem; font-weight: 600; color: var(--text); }
  .search input { width: 100%; min-width: 0; min-height: var(--ui-control-height); }
  .pkg-meta { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; font-size: 0.875rem; margin-bottom: 0.5rem; }
  .stamp { font-size: 0.75rem; color: var(--muted); overflow-wrap: anywhere; }
  .pill {
    display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border);
    border-radius: 999px; font-size: 0.75rem; color: var(--muted);
  }
  .pill[data-tone="warn"] { color: var(--warn); border-color: var(--warn); background: var(--warn-bg); }
  .pkg-scroll {
    width: 100%; max-width: 100%; overflow: auto; max-height: 22rem; margin-top: 0.5rem;
    border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel);
  }
  .pkg-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; color: var(--text); }
  .pkg-table th, .pkg-table td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid var(--border); }
  .pkg-table thead th { position: sticky; top: 0; z-index: 1; background: var(--panel); color: var(--muted); font-weight: 600; }
  .pkg-table tbody tr:last-child td { border-bottom: 0; }
  .sort {
    display: inline-flex; align-items: center; gap: 0.25rem; padding: 0; border: 0;
    background: transparent; color: inherit; font: inherit; font-weight: 600; cursor: pointer;
  }
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
  }
  @media (max-width: 400px) {
    .tabs button { flex: 1 1 auto; justify-content: center; }
  }
</style>
