<script lang="ts">
  import { onDestroy } from "svelte";
  import { ApiError, copyFsEntry, moveFsEntry, searchFs, type FsHit } from "./files-ops-api.ts";

  let { currentPath, onOpenResult, onMutated }: {
    currentPath: string;
    onOpenResult: (path: string, kind?: "dir" | "file") => void;
    onMutated: () => void;
  } = $props();

  const uid = $props.id();
  let query = $state("");
  let searching = $state(false);
  let searched = $state(false);
  let hits = $state<FsHit[]>([]);
  let searchError = $state<string | null>(null);
  let showTransfer = $state(false);
  let mode = $state<"copy" | "move">("copy");
  let sourcePath = $state("");
  let destPath = $state("");
  let transferring = $state(false);
  let transferNotice = $state<string | null>(null);
  let transferError = $state<string | null>(null);
  let searchAbort: AbortController | undefined;
  let transferAbort: AbortController | undefined;

  onDestroy(() => { searchAbort?.abort(); transferAbort?.abort(); });

  async function runSearch(event: SubmitEvent) {
    event.preventDefault();
    const clean = query.trim();
    searchAbort?.abort();
    searchError = null;
    if (!clean) { hits = []; searched = false; return; }
    const ctrl = (searchAbort = new AbortController());
    searching = true;
    try {
      const next = await searchFs(clean, currentPath, ctrl.signal);
      if (ctrl.signal.aborted) return;
      hits = next;
      searched = true;
    } catch (err) {
      if (ctrl.signal.aborted) return;
      hits = [];
      searched = false;
      searchError = err instanceof ApiError ? err.message : "Could not search files. Check the backend and retry.";
    } finally {
      if (!ctrl.signal.aborted) searching = false;
    }
  }

  function clearSearch() {
    searchAbort?.abort();
    query = ""; hits = []; searched = false; searchError = null; searching = false;
  }

  function toggleTransfer() {
    showTransfer = !showTransfer;
    transferError = null;
    transferNotice = null;
  }

  async function runTransfer(event: SubmitEvent) {
    event.preventDefault();
    if (transferring) return;
    transferAbort?.abort();
    const ctrl = (transferAbort = new AbortController());
    transferring = true;
    transferError = null;
    transferNotice = null;
    try {
      const src = sourcePath.trim();
      const dst = destPath.trim();
      if (mode === "copy") {
        await copyFsEntry(sourcePath, destPath, ctrl.signal);
        if (ctrl.signal.aborted) return;
        transferNotice = `Copied "${src}" to "${dst}".`;
      } else {
        await moveFsEntry(sourcePath, destPath, ctrl.signal);
        if (ctrl.signal.aborted) return;
        transferNotice = `Moved "${src}" to "${dst}".`;
      }
      sourcePath = ""; destPath = "";
      onMutated();
    } catch (err) {
      if (ctrl.signal.aborted) return;
      transferError = err instanceof ApiError ? err.message : `Could not ${mode} entry. Check the backend and retry.`;
    } finally {
      if (!ctrl.signal.aborted) transferring = false;
    }
  }
</script>

<div class="ops-bar" data-files-ops>
  <form class="ops-search" onsubmit={(e) => void runSearch(e)}>
    <label class="sr-only" for={`${uid}-search`}>Search files in {currentPath}</label>
    <input id={`${uid}-search`} type="search" bind:value={query} disabled={searching} placeholder={`Search in ${currentPath}`} autocomplete="off" />
    <button type="submit" disabled={searching}>{searching ? "Searching..." : "Search"}</button>
    {#if query || searched || searchError}
      <button type="button" onclick={clearSearch}>Clear</button>
    {/if}
    <button type="button" aria-expanded={showTransfer} class:primary={showTransfer} onclick={toggleTransfer}>
      Copy / Move
    </button>
  </form>

  {#if searchError}
    <p class="feedback error" role="alert">{searchError}</p>
  {:else if searched}
    <div class="ops-results" role="status" aria-live="polite">
      {#if hits.length === 0}
        <p class="ops-muted">No matching files or folders.</p>
      {:else}
        <p class="ops-muted">{hits.length} {hits.length === 1 ? "match" : "matches"}:</p>
        <ul class="hit-list">
          {#each hits as hit (hit.path)}
            <li>
              <button type="button" class="hit-btn" onclick={() => onOpenResult(hit.path, hit.kind)}>
                <span class="hit-kind">{hit.kind === "dir" ? "DIR" : "FILE"}</span>
                <span class="hit-path">{hit.path}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}

  {#if transferNotice}<p class="feedback ok" role="status" aria-live="polite">{transferNotice}</p>{/if}
  {#if transferError}<p class="feedback error" role="alert">{transferError}</p>{/if}

  {#if showTransfer}
    <form class="transfer-panel" onsubmit={(e) => void runTransfer(e)}>
      <div class="transfer-grid">
        <div class="field">
          <label for={`${uid}-src`}>Source path</label>
          <input id={`${uid}-src`} type="text" bind:value={sourcePath} disabled={transferring} placeholder={`${currentPath}/source.txt`} autocomplete="off" />
        </div>
        <div class="field">
          <label for={`${uid}-dst`}>Destination path</label>
          <input id={`${uid}-dst`} type="text" bind:value={destPath} disabled={transferring} placeholder={`${currentPath}/target.txt`} autocomplete="off" />
        </div>
        <div class="field">
          <label for={`${uid}-mode`}>Mode</label>
          <select id={`${uid}-mode`} bind:value={mode} disabled={transferring}>
            <option value="copy">Copy</option>
            <option value="move">Move</option>
          </select>
        </div>
      </div>
      <div class="actions">
        <button type="submit" class="primary" disabled={transferring}>
          {transferring ? (mode === "copy" ? "Copying..." : "Moving...") : "Run"}
        </button>
        <button type="button" disabled={transferring} onclick={toggleTransfer}>Close</button>
      </div>
    </form>
  {/if}
</div>

<style>
  .ops-bar { display: grid; gap: .625rem; min-width: 0; padding: .75rem; background: var(--surface); border: 1px solid var(--border); border-radius: .5rem; }
  .ops-search { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; min-width: 0; }
  .ops-search input { flex: 1 1 12rem; min-width: 0; }
  .ops-results { display: grid; gap: .375rem; min-width: 0; }
  .ops-muted { margin: 0; font-size: .8125rem; color: var(--muted); }
  .hit-list { list-style: none; padding: 0; margin: 0; display: grid; gap: .375rem; max-height: 11rem; overflow-y: auto; }
  .hit-btn { width: 100%; display: flex; align-items: center; gap: .5rem; text-align: left; font-size: .875rem; min-width: 0; }
  .hit-kind { flex-shrink: 0; font-size: .7rem; padding: .1rem .4rem; border: 1px solid var(--border); border-radius: 999px; color: var(--muted); }
  .hit-path { overflow-wrap: anywhere; }
  .transfer-panel { display: grid; gap: .625rem; padding-top: .5rem; border-top: 1px solid var(--border); min-width: 0; }
  .transfer-grid { display: grid; gap: .5rem; grid-template-columns: repeat(auto-fit, minmax(min(11rem, 100%), 1fr)); }
</style>
