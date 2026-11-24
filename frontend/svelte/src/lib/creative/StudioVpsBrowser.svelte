<script lang="ts">
  import { listDirectory, type FsList } from "../files/files-api.ts";
  import { resolveRawMediaUrl } from "../media/media-api.ts";
  import { formatBytesCompact, isImportableMediaFile, joinHostPath } from "./studio-model.ts";

  type Props = {
    onAddFile: (path: string, sizeBytes?: number) => void;
    onAddBatch: (files: { path: string; sizeBytes?: number }[]) => void;
  };

  let { onAddFile, onAddBatch }: Props = $props();

  let currentPath = $state("~");
  let listing = $state<FsList | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let abortCtrl: AbortController | null = null;

  let visibleDirs = $derived((listing?.entries ?? []).filter((e) => e.kind === "dir"));
  let mediaFiles = $derived(
    (listing?.entries ?? [])
      .filter((e) => e.kind === "file")
      .map((e) => ({ entry: e, kind: isImportableMediaFile(e.name, e.mime) }))
      .filter((item) => item.kind !== null),
  );

  async function loadFolder(targetPath: string) {
    abortCtrl?.abort();
    abortCtrl = new AbortController();
    loading = true;
    error = null;
    try {
      const data = await listDirectory(targetPath, abortCtrl.signal);
      listing = data;
      currentPath = data.path;
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        error = err instanceof Error ? err.message : "Could not list host directory.";
      }
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void loadFolder("~");
    return () => abortCtrl?.abort();
  });

  function importAllMedia() {
    if (!listing || mediaFiles.length === 0) return;
    onAddBatch(
      mediaFiles.map((item) => ({
        path: joinHostPath(listing!.path, item.entry.name),
        sizeBytes: item.entry.size,
      })),
    );
  }

  function safeThumb(filePath: string): string | null {
    try { return resolveRawMediaUrl(filePath); } catch { return null; }
  }
</script>

<div class="vps-browser" role="region" aria-label="VPS folder quick-browse">
  <div class="browser-top">
    <div class="nav-row">
      <button type="button" disabled={!listing?.parent || loading} onclick={() => listing?.parent && loadFolder(listing.parent)}>
        Up
      </button>
      <code class="path-crumb" title={currentPath}>{currentPath}</code>
      <button type="button" disabled={loading} onclick={() => loadFolder(currentPath)}>
        {loading ? "Loading..." : "Refresh"}
      </button>
      <button type="button" class="primary" disabled={mediaFiles.length === 0} onclick={importAllMedia}>
        Import all ({mediaFiles.length})
      </button>
    </div>

    {#if listing?.roots && listing.roots.length > 0}
      <div class="roots-row">
        {#each listing.roots as root (root.path)}
          <button type="button" class="root-chip" onclick={() => loadFolder(root.path)}>{root.label}</button>
        {/each}
      </div>
    {/if}
  </div>

  {#if error}
    <p class="feedback error" role="alert">{error}</p>
  {/if}

  <div class="browser-list">
    {#each visibleDirs as dir (dir.name)}
      <button
        type="button"
        class="dir-row"
        onclick={() => loadFolder(joinHostPath(currentPath, dir.name))}
      >
        <span class="kind-pill">DIR</span>
        <span class="entry-name">{dir.name}</span>
      </button>
    {/each}

    {#each mediaFiles as item (item.entry.name)}
      {@const fullPath = joinHostPath(currentPath, item.entry.name)}
      {@const thumb = item.kind === "image" ? safeThumb(fullPath) : null}
      <div class="media-row">
        <div class="media-thumb">
          {#if thumb}
            <img src={thumb} alt={item.entry.name} loading="lazy" />
          {:else}
            <span class="kind-pill">{(item.kind ?? "file").toUpperCase()}</span>
          {/if}
        </div>
        <div class="media-meta">
          <span class="entry-name">{item.entry.name}</span>
          <small>{item.kind} | {formatBytesCompact(item.entry.size)}</small>
        </div>
        <button type="button" onclick={() => onAddFile(fullPath, item.entry.size)}>+ Add</button>
      </div>
    {/each}

    {#if !loading && !error && visibleDirs.length === 0 && mediaFiles.length === 0}
      <p class="empty-msg">No folders or image/video/audio files in this directory.</p>
    {/if}
  </div>
</div>

<style>
  .vps-browser { display: grid; gap: 0.625rem; padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--surface); min-width: 0; }
  .browser-top { display: grid; gap: 0.5rem; }
  .nav-row, .roots-row { display: flex; align-items: center; gap: 0.375rem; flex-wrap: wrap; min-width: 0; }
  .path-crumb {
    flex: 1 1 10rem; min-width: 0; padding: 0.35rem 0.5rem; border: 1px solid var(--border); border-radius: 0.375rem;
    background: var(--panel-solid); font-family: var(--font-mono); font-size: 0.78rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .root-chip { min-height: 2rem; padding: 0.2rem 0.55rem; font-size: 0.78rem; }
  .browser-list { display: grid; gap: 0.375rem; max-height: 15rem; overflow-y: auto; }
  .dir-row, .media-row {
    display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.55rem;
    border: 1px solid var(--border); border-radius: 0.375rem; background: var(--panel-solid); text-align: left;
  }
  .media-thumb {
    width: 2.5rem; height: 2.5rem; flex-shrink: 0; display: grid; place-items: center;
    overflow: hidden; border-radius: 0.3rem; border: 1px solid var(--border); background: var(--surface);
  }
  .media-thumb img { width: 100%; height: 100%; object-fit: cover; }
  .media-meta { flex: 1 1 auto; min-width: 0; display: grid; }
  .entry-name { font-size: 0.84rem; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .media-meta small { font-size: 0.74rem; color: var(--muted); }
  .kind-pill { font-family: var(--font-mono); font-size: 0.65rem; font-weight: 700; color: var(--muted); }
  .empty-msg { margin: 0; font-size: 0.84rem; color: var(--muted); }
</style>
