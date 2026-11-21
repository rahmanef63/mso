<script lang="ts">
  import { onMount } from "svelte";
  import {
    createPackagesController,
    type PackagesState,
    type PackageUpdate,
  } from "./managed-apps-api";

  let view = $state<PackagesState>({ kind: "loading" });
  let filterQuery = $state("");
  let controller: ReturnType<typeof createPackagesController> | undefined;

  let visibleUpdates = $derived.by<PackageUpdate[]>(() => {
    if (view.kind !== "ready") return [];
    const q = filterQuery.trim().toLowerCase();
    if (!q) return view.summary.updates;
    return view.summary.updates.filter((item) =>
      `${item.name} ${item.current ?? ""} ${item.candidate} ${item.architecture ?? ""}`.toLowerCase().includes(q));
  });

  let stateTag = $derived.by(() => {
    if (view.kind !== "ready") return view.kind;
    if (view.summary.updates.length === 0) return "empty";
    return visibleUpdates.length === 0 ? "no-filter-matches" : "ready";
  });

  export function refresh() {
    void controller?.refresh();
  }

  onMount(() => {
    controller = createPackagesController((next) => { view = next; });
    void controller.refresh();
    return () => controller?.dispose();
  });
</script>

<section aria-labelledby="packages-cache-title" aria-busy={view.kind === "loading"} data-packages-state={stateTag}>
  <header class="feature-header">
    <h2 id="packages-cache-title">Packages (Cache)</h2>
    <button disabled={view.kind === "loading"} onclick={refresh}>
      {view.kind === "loading" ? "Loading..." : "Refresh packages"}
    </button>
  </header>

  <p class="pkg-note">
    Read-only local package cache visibility. Package refresh, install, and upgrade actions are disabled in this panel.
  </p>

  <div class="pkg-filter-wrap">
    <label for="packages-cache-filter">Filter cached updates</label>
    <input id="packages-cache-filter" type="search" bind:value={filterQuery} placeholder="Package name, version, or architecture" />
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
        <span><strong>{view.summary.updates.length}</strong> cached updates</span>
        <span class="pill">{view.summary.manager ?? "unknown"}</span>
        <span class="pill">{view.summary.source}</span>
      </div>
      {#if view.summary.truncated}
        <p class="pkg-note">Listing capped for safety. Filter results or inspect the host directly for the full set.</p>
      {/if}
      {#if view.summary.updates.length === 0}
        <p>No cached package updates reported by the host.</p>
      {:else if visibleUpdates.length === 0}
        <p>No cached packages match "{filterQuery.trim()}".</p>
      {:else}
        <div class="pkg-scroll" role="region" aria-label="Cached package updates">
          <table class="pkg-table">
            <thead>
              <tr>
                <th scope="col">Package</th>
                <th scope="col">Installed</th>
                <th scope="col">Candidate</th>
              </tr>
            </thead>
            <tbody>
              {#each visibleUpdates as pkg (`${pkg.name}:${pkg.architecture ?? ""}`)}
                <tr>
                  <td>
                    <code>{pkg.name}</code>
                    {#if pkg.architecture}<span class="pkg-arch">{pkg.architecture}</span>{/if}
                  </td>
                  <td><code>{pkg.current ?? "unknown"}</code></td>
                  <td><code>{pkg.candidate}</code></td>
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
  .pkg-filter-wrap { display: grid; gap: 0.375rem; margin: 1rem 0; }
  .pkg-filter-wrap label { font-size: 0.875rem; font-weight: 600; color: var(--text); }
  .pkg-filter-wrap input { width: 100%; min-width: 0; min-height: var(--ui-control-height); }
  .pkg-meta { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; font-size: 0.875rem; margin-bottom: 0.5rem; }
  .pill {
    display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border);
    border-radius: 999px; font-size: 0.75rem; color: var(--muted);
  }
  .pkg-scroll {
    width: 100%; max-width: 100%; overflow: auto; max-height: 20rem; margin-top: 0.5rem;
    border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel);
  }
  .pkg-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; color: var(--text); }
  .pkg-table th, .pkg-table td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid var(--border); }
  .pkg-table thead th { position: sticky; top: 0; z-index: 1; background: var(--panel); color: var(--muted); font-weight: 600; }
  .pkg-table tbody tr:last-child td { border-bottom: 0; }
  .pkg-arch { margin-left: 0.375rem; font-size: 0.75rem; color: var(--muted); }
</style>
