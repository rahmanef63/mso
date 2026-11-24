<script lang="ts">
  import "./MediaStudioApp.css";
  import { formatTimecode, moveItem } from "./creative-state.ts";
  import { downloadJsonFile, slugifyFilename } from "./reel-snapshot.ts";
  import {
    addTagToAsset,
    buildStudioManifest,
    computeQueueOffsets,
    createProjectAsset,
    duplicateStudioAsset,
    filterStudioAssets,
    removeTagFromAsset,
    summarizeStudioBatch,
    type StudioKindFilter,
    type StudioProjectAsset,
    type StudioViewMode,
  } from "./studio-model.ts";
  import StudioAssetBin from "./StudioAssetBin.svelte";
  import StudioInspector from "./StudioInspector.svelte";
  import StudioVpsBrowser from "./StudioVpsBrowser.svelte";

  const KIND_FILTERS: readonly { id: StudioKindFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "image", label: "Image" },
    { id: "video", label: "Video" },
    { id: "audio", label: "Audio" },
  ];

  let projectTitle = $state("Media Studio Project");
  let assets = $state<StudioProjectAsset[]>([]);
  let selectedId = $state<string | null>(null);
  let kindFilter = $state<StudioKindFilter>("all");
  let searchQuery = $state("");
  let viewMode = $state<StudioViewMode>("grid");
  let showVpsBrowser = $state(false);
  let pathInput = $state("");
  let durationInput = $state("5");
  let notice = $state<{ tone: "ok" | "error"; text: string } | null>(null);

  let summary = $derived(summarizeStudioBatch(assets));
  let offsets = $derived(computeQueueOffsets(assets));
  let filteredAssets = $derived(filterStudioAssets(assets, kindFilter, searchQuery));
  let selectedAsset = $derived(assets.find((a) => a.id === selectedId) ?? filteredAssets[0] ?? assets[0] ?? null);
  let selectedIndex = $derived(selectedAsset ? assets.findIndex((a) => a.id === selectedAsset.id) : -1);

  function addManualAsset(event: SubmitEvent) {
    event.preventDefault();
    const trimmed = pathInput.trim();
    if (!trimmed) {
      notice = { tone: "error", text: "Enter a host media path to add to the project." };
      return;
    }
    const parsed = durationInput.trim() === "" ? undefined : Number(durationInput);
    try {
      const created = createProjectAsset(trimmed, parsed);
      assets = [...assets, created];
      selectedId = created.id;
      pathInput = "";
      notice = { tone: "ok", text: `Added "${created.label}" to queue.` };
    } catch (err) {
      notice = { tone: "error", text: err instanceof Error ? err.message : "Could not add media asset." };
    }
  }

  function addFromVps(filePath: string, sizeBytes?: number) {
    try {
      const created = createProjectAsset(filePath, undefined, sizeBytes);
      assets = [...assets, created];
      selectedId = created.id;
      notice = { tone: "ok", text: `Imported "${created.label}" from VPS.` };
    } catch (err) {
      notice = { tone: "error", text: err instanceof Error ? err.message : "Could not import file." };
    }
  }

  function addBatchFromVps(items: { path: string; sizeBytes?: number }[]) {
    const added: StudioProjectAsset[] = [];
    for (const item of items) {
      try { added.push(createProjectAsset(item.path, undefined, item.sizeBytes)); } catch { /* skip invalid */ }
    }
    if (added.length === 0) return;
    assets = [...assets, ...added];
    selectedId = added[0]!.id;
    notice = { tone: "ok", text: `Imported ${added.length} media assets from VPS folder.` };
  }

  function reorderAsset(index: number, delta: number) {
    assets = moveItem(assets, index, delta);
  }

  function duplicateAsset(id: string) {
    const idx = assets.findIndex((a) => a.id === id);
    if (idx < 0) return;
    const copy = duplicateStudioAsset(assets[idx]!);
    const next = [...assets];
    next.splice(idx + 1, 0, copy);
    assets = next;
    selectedId = copy.id;
  }

  function removeAsset(id: string) {
    const next = assets.filter((a) => a.id !== id);
    assets = next;
    if (selectedId === id) selectedId = next[0]?.id ?? null;
  }

  function patchAsset(id: string, updater: (asset: StudioProjectAsset) => StudioProjectAsset) {
    assets = assets.map((a) => (a.id === id ? updater(a) : a));
  }

  function exportManifest() {
    const filename = `${slugifyFilename(projectTitle, "media-studio")}-manifest.json`;
    const ok = downloadJsonFile(filename, buildStudioManifest(projectTitle, assets));
    notice = ok
      ? { tone: "ok", text: `Exported ${filename}.` }
      : { tone: "error", text: "Manifest export is unavailable in this environment." };
  }
</script>

<section class="studio-root" aria-labelledby="media-studio-title">
  <header class="feature-header">
    <div class="title-wrap">
      <h2 id="media-studio-title" class="sr-only">Media Studio</h2>
      <input type="text" class="project-title" aria-label="Studio project title" bind:value={projectTitle} />
      <div class="summary-badges" aria-label="Batch duration summary">
        <span class="role-badge">{summary.totalCount} {summary.totalCount === 1 ? "asset" : "assets"}</span>
        <span class="role-badge">Total {formatTimecode(summary.totalDurationSec)} ({summary.totalDurationSec}s)</span>
        <span class="role-badge">Img {summary.counts.image} | Vid {summary.counts.video} | Aud {summary.counts.audio}</span>
      </div>
    </div>
    <div class="header-actions">
      <button type="button" class:active={showVpsBrowser} aria-pressed={showVpsBrowser} onclick={() => { showVpsBrowser = !showVpsBrowser; }}>
        {showVpsBrowser ? "Hide VPS Browser" : "Browse VPS"}
      </button>
      <button type="button" class="primary" onclick={exportManifest}>Export Manifest JSON</button>
    </div>
  </header>

  <form class="studio-form" onsubmit={addManualAsset}>
    <div class="field grow">
      <label for="studio-path">Host media path</label>
      <input id="studio-path" type="text" bind:value={pathInput} placeholder="/path/to/clip.mp4 or ~/photo.png" autocomplete="off" />
    </div>
    <div class="field dur-field">
      <label for="studio-duration">Duration (s)</label>
      <input id="studio-duration" type="number" min="0" max="3600" bind:value={durationInput} />
    </div>
    <button type="submit" class="primary">Add asset</button>
  </form>

  {#if showVpsBrowser}
    <StudioVpsBrowser onAddFile={addFromVps} onAddBatch={addBatchFromVps} />
  {/if}

  {#if notice}
    <p class="feedback {notice.tone}" role="status">{notice.text}</p>
  {/if}

  <div class="filter-bar">
    <div class="kind-tabs" role="group" aria-label="Filter by media kind">
      {#each KIND_FILTERS as f (f.id)}
        <button type="button" class:active={kindFilter === f.id} aria-pressed={kindFilter === f.id} onclick={() => { kindFilter = f.id; }}>
          {f.label}
        </button>
      {/each}
    </div>
    <input type="search" class="search-box" bind:value={searchQuery} placeholder="Filter by name, tag, or note" aria-label="Filter assets" />
    <div class="view-toggle" role="group" aria-label="Asset layout">
      <button type="button" class:active={viewMode === "grid"} aria-pressed={viewMode === "grid"} onclick={() => { viewMode = "grid"; }}>Grid</button>
      <button type="button" class:active={viewMode === "list"} aria-pressed={viewMode === "list"} onclick={() => { viewMode = "list"; }}>List</button>
    </div>
  </div>

  <div class="studio-workspace">
    <StudioAssetBin
      allAssets={assets}
      {filteredAssets}
      selectedId={selectedAsset?.id ?? null}
      {viewMode}
      onSelect={(id) => { selectedId = id; }}
      onReorder={reorderAsset}
      onRemove={removeAsset}
    />
    <StudioInspector
      asset={selectedAsset}
      queueIndex={selectedIndex}
      queueLength={assets.length}
      offset={selectedAsset ? (offsets.get(selectedAsset.id) ?? null) : null}
      onUpdateDuration={(id, durationSec) => patchAsset(id, (a) => ({ ...a, durationSec }))}
      onUpdateNotes={(id, notes) => patchAsset(id, (a) => ({ ...a, notes }))}
      onAddTag={(id, rawTag) => patchAsset(id, (a) => addTagToAsset(a, rawTag))}
      onRemoveTag={(id, tag) => patchAsset(id, (a) => removeTagFromAsset(a, tag))}
      onReorder={reorderAsset}
      onDuplicate={duplicateAsset}
      onRemove={removeAsset}
    />
  </div>
</section>
