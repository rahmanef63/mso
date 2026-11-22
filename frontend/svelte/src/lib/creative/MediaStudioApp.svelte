<script lang="ts">
  import { resolveRawMediaUrl } from "../media/media-api.ts";
  import {
    createStudioAsset, formatTimecode, moveItem, totalDurationSec, type StudioAsset,
  } from "./creative-state.ts";

  let assets = $state<StudioAsset[]>([]);
  let selectedId = $state<string | null>(null);
  let pathInput = $state("");
  let durationInput = $state("5");
  let feedback = $state<string | null>(null);
  let previewError = $state<string | null>(null);

  let selectedAsset = $derived(assets.find((item) => item.id === selectedId) ?? assets[0] ?? null);
  let totalSec = $derived(totalDurationSec(assets));
  let previewUrl = $derived.by<string | null>(() => {
    if (!selectedAsset) return null;
    if (selectedAsset.kind !== "image" && selectedAsset.kind !== "audio" && selectedAsset.kind !== "video") {
      return null;
    }
    try { return resolveRawMediaUrl(selectedAsset.path); } catch { return null; }
  });

  function addAsset(event: SubmitEvent) {
    event.preventDefault();
    const trimmed = pathInput.trim();
    if (!trimmed) {
      feedback = "Enter a host media path to add to the project.";
      return;
    }
    const parsed = durationInput.trim() === "" ? undefined : Number(durationInput);
    try {
      const created = createStudioAsset(trimmed, parsed);
      assets = [...assets, created];
      selectedId = created.id;
      pathInput = "";
      feedback = null;
      previewError = null;
    } catch (err) {
      feedback = err instanceof Error ? err.message : "Could not add media asset.";
    }
  }

  function reorderAsset(index: number, delta: number) {
    assets = moveItem(assets, index, delta);
  }

  function removeAsset(id: string) {
    const next = assets.filter((item) => item.id !== id);
    assets = next;
    if (selectedId === id) {
      selectedId = next[0]?.id ?? null;
      previewError = null;
    }
  }

  function selectAsset(id: string) {
    selectedId = id;
    previewError = null;
  }
</script>

<section aria-labelledby="media-studio-title">
  <header class="feature-header">
    <h2 id="media-studio-title">Media Studio</h2>
    <div class="studio-meta">
      <span class="role-badge">{assets.length} {assets.length === 1 ? "asset" : "assets"}</span>
      <span class="role-badge">Total {formatTimecode(totalSec)} ({totalSec}s)</span>
    </div>
  </header>

  <form class="studio-form" onsubmit={addAsset}>
    <div class="field grow">
      <label for="studio-path">Host media path</label>
      <input
        id="studio-path"
        type="text"
        bind:value={pathInput}
        placeholder="/path/to/clip.mp4 or ~/photo.png"
        autocomplete="off"
      />
    </div>
    <div class="field dur-field">
      <label for="studio-duration">Duration (s)</label>
      <input id="studio-duration" type="number" min="0" max="3600" bind:value={durationInput} />
    </div>
    <button type="submit" class="primary">Add asset</button>
  </form>

  {#if feedback}
    <p class="feedback error" role="alert">{feedback}</p>
  {/if}

  <div class="studio-grid">
    <div class="asset-pane">
      <h3>Project assets</h3>
      {#if assets.length === 0}
        <p class="empty">No assets added yet. Add image, audio, or video paths above.</p>
      {:else}
        <ul class="asset-list">
          {#each assets as asset, index (asset.id)}
            <li class="asset-row" class:active={selectedAsset?.id === asset.id}>
              <button
                type="button"
                class="asset-select"
                aria-current={selectedAsset?.id === asset.id ? "true" : undefined}
                onclick={() => selectAsset(asset.id)}
              >
                <span class="asset-name">{asset.label}</span>
                <span class="asset-sub">{asset.kind} | {asset.durationSec}s</span>
              </button>
              <div class="row-actions">
                <button
                  type="button"
                  aria-label="Move {asset.label} up"
                  disabled={index === 0}
                  onclick={() => reorderAsset(index, -1)}
                >Up</button>
                <button
                  type="button"
                  aria-label="Move {asset.label} down"
                  disabled={index === assets.length - 1}
                  onclick={() => reorderAsset(index, 1)}
                >Down</button>
                <button
                  type="button"
                  class="danger"
                  aria-label="Remove {asset.label}"
                  onclick={() => removeAsset(asset.id)}
                >Remove</button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="preview-pane" role="region" aria-label="Asset preview" aria-live="polite">
      <h3>Live preview</h3>
      {#if !selectedAsset}
        <p class="empty">Select or add a project asset to inspect it here.</p>
      {:else}
        <p class="asset-path"><code>{selectedAsset.path}</code></p>
        {#if previewError}
          <p class="feedback error" role="alert">{previewError}</p>
        {/if}
        {#if selectedAsset.kind === "image" && previewUrl}
          <img
            src={previewUrl}
            alt={selectedAsset.label}
            onerror={() => { previewError = "Could not load image preview from host path."; }}
          />
        {:else if selectedAsset.kind === "audio" && previewUrl}
          <audio
            controls
            src={previewUrl}
            onerror={() => { previewError = "Could not load audio stream from host path."; }}
          ></audio>
        {:else if selectedAsset.kind === "video" && previewUrl}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video
            controls
            src={previewUrl}
            onerror={() => { previewError = "Could not load video stream from host path."; }}
          ></video>
        {:else}
          <p class="feedback pending">
            Format "{selectedAsset.kind}" does not have an inline media player in Media Studio.
          </p>
        {/if}
      {/if}
    </div>
  </div>
</section>

<style>
  .studio-meta { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .studio-form { display: flex; align-items: flex-end; gap: 0.625rem; flex-wrap: wrap; margin: 1rem 0; }
  .grow { flex: 1 1 14rem; }
  .dur-field { flex: 0 1 7rem; }
  .studio-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(min(18rem, 100%), 1fr)); margin-top: 1rem; }
  .asset-pane, .preview-pane {
    display: grid; gap: 0.75rem; align-content: start; padding: 1rem;
    border: 1px solid var(--border); border-radius: 0.5rem; background: var(--surface);
  }
  .asset-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
  .asset-row {
    display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap;
    padding: 0.5rem; border: 1px solid var(--border); border-radius: 0.375rem; background: var(--panel);
  }
  .asset-row.active { border-color: var(--accent); }
  .asset-select {
    flex: 1 1 9rem; display: grid; text-align: left; border: 0; background: transparent; padding: 0.25rem;
  }
  .asset-name { font-weight: 600; color: var(--text); overflow-wrap: anywhere; }
  .asset-sub { font-size: 0.8125rem; color: var(--muted); }
  .row-actions { display: flex; gap: 0.375rem; flex-wrap: wrap; }
  .asset-path, .empty { margin: 0; font-size: 0.875rem; overflow-wrap: anywhere; }
  .preview-pane img, .preview-pane video, .preview-pane audio { width: 100%; max-height: 18rem; border-radius: 0.375rem; object-fit: contain; }
</style>
