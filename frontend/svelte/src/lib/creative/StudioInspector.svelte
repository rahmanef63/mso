<script lang="ts">
  import { resolveRawMediaUrl } from "../media/media-api.ts";
  import { formatTimecode } from "./creative-state.ts";
  import { formatBytesCompact, type StudioProjectAsset, type StudioQueueOffset } from "./studio-model.ts";

  type Props = {
    asset: StudioProjectAsset | null;
    queueIndex: number;
    queueLength: number;
    offset: StudioQueueOffset | null;
    onUpdateDuration: (id: string, sec: number) => void;
    onUpdateNotes: (id: string, notes: string) => void;
    onAddTag: (id: string, rawTag: string) => void;
    onRemoveTag: (id: string, tag: string) => void;
    onReorder: (index: number, delta: number) => void;
    onDuplicate: (id: string) => void;
    onRemove: (id: string) => void;
  };

  let {
    asset,
    queueIndex,
    queueLength,
    offset,
    onUpdateDuration,
    onUpdateNotes,
    onAddTag,
    onRemoveTag,
    onReorder,
    onDuplicate,
    onRemove,
  }: Props = $props();

  let tagInput = $state("");
  let previewError = $state<string | null>(null);

  let previewUrl = $derived.by<string | null>(() => {
    if (!asset) return null;
    if (asset.kind !== "image" && asset.kind !== "audio" && asset.kind !== "video") return null;
    try { return resolveRawMediaUrl(asset.path); } catch { return null; }
  });

  $effect(() => {
    asset?.id;
    previewError = null;
  });

  function submitTag(event: SubmitEvent) {
    event.preventDefault();
    if (!asset || !tagInput.trim()) return;
    onAddTag(asset.id, tagInput);
    tagInput = "";
  }
</script>

<aside class="inspector-pane" role="region" aria-label="Active asset inspector" aria-live="polite">
  <h3>Asset Inspector</h3>

  {#if !asset}
    <p class="empty-msg">Select an asset from the bin to preview media, inspect metadata, and add notes or tags.</p>
  {:else}
    <div class="player-box">
      {#if previewError}
        <p class="feedback error" role="alert">{previewError}</p>
      {/if}
      {#if asset.kind === "image" && previewUrl}
        <img
          src={previewUrl}
          alt={asset.label}
          onerror={() => { previewError = "Could not load image preview from host path."; }}
        />
      {:else if asset.kind === "video" && previewUrl}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video
          controls
          src={previewUrl}
          onerror={() => { previewError = "Could not load video stream from host path."; }}
        ></video>
      {:else if asset.kind === "audio" && previewUrl}
        <audio
          controls
          src={previewUrl}
          onerror={() => { previewError = "Could not load audio stream from host path."; }}
        ></audio>
      {:else}
        <p class="feedback pending">Format "{asset.kind}" has no inline player in Media Studio.</p>
      {/if}
    </div>

    <p class="path-line"><code>{asset.path}</code></p>

    <dl>
      <div><dt>Kind</dt><dd>{asset.kind}</dd></div>
      <div><dt>Queue</dt><dd>{queueIndex + 1} / {queueLength}</dd></div>
      <div><dt>Offset</dt><dd>{offset ? `${formatTimecode(offset.startSec)} - ${formatTimecode(offset.endSec)}` : "00:00"}</dd></div>
      <div><dt>Size</dt><dd>{formatBytesCompact(asset.sizeBytes)}</dd></div>
    </dl>

    <div class="queue-controls">
      <label class="dur-inline">
        <span>Duration (s)</span>
        <input
          type="number"
          min="0"
          max="3600"
          value={asset.durationSec}
          oninput={(e) => onUpdateDuration(asset.id, Math.max(0, Math.round(Number(e.currentTarget.value) || 0)))}
        />
      </label>
      <div class="btn-row">
        <button type="button" disabled={queueIndex <= 0} onclick={() => onReorder(queueIndex, -1)}>Up</button>
        <button type="button" disabled={queueIndex >= queueLength - 1} onclick={() => onReorder(queueIndex, 1)}>Down</button>
        <button type="button" onclick={() => onDuplicate(asset.id)}>Duplicate</button>
        <button type="button" class="danger" onclick={() => onRemove(asset.id)}>Remove</button>
      </div>
    </div>

    <div class="field">
      <label for="studio-notes">Quick notes</label>
      <textarea
        id="studio-notes"
        rows="3"
        value={asset.notes}
        placeholder="Shot notes, edit cues, or usage rights..."
        oninput={(e) => onUpdateNotes(asset.id, e.currentTarget.value)}
      ></textarea>
    </div>

    <div class="tags-block">
      <form class="tag-form" onsubmit={submitTag}>
        <label for="studio-tag-input" class="sr-only">Add tag</label>
        <input id="studio-tag-input" type="text" bind:value={tagInput} placeholder="Add tag (e.g. hero, b-roll)" />
        <button type="submit">Add tag</button>
      </form>
      {#if asset.tags.length > 0}
        <div class="tag-list">
          {#each asset.tags as tag (tag)}
            <span class="tag-chip">
              #{tag}
              <button type="button" aria-label="Remove tag {tag}" onclick={() => onRemoveTag(asset.id, tag)}>x</button>
            </span>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</aside>

<style>
  .inspector-pane { display: grid; gap: 0.75rem; align-content: start; padding: 0.875rem; border: 1px solid var(--border); border-radius: 0.625rem; background: var(--surface); min-width: 0; }
  .player-box { display: grid; place-items: center; padding: 0.5rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel-solid); }
  .player-box img, .player-box video, .player-box audio { width: 100%; max-height: 15rem; border-radius: 0.375rem; object-fit: contain; }
  .path-line { margin: 0; font-size: 0.8rem; font-family: var(--font-mono); overflow-wrap: anywhere; }
  .queue-controls { display: flex; align-items: flex-end; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
  .dur-inline { display: grid; gap: 0.25rem; font-size: 0.8rem; font-weight: 600; color: var(--text); }
  .dur-inline input { width: 6rem; }
  .btn-row { display: flex; gap: 0.35rem; flex-wrap: wrap; }
  textarea {
    width: 100%; padding: 0.5rem 0.65rem; border: 1px solid var(--border); border-radius: 0.5rem;
    background: var(--panel-solid); color: var(--text); font: inherit; resize: vertical;
  }
  .tags-block { display: grid; gap: 0.5rem; }
  .tag-form { display: flex; gap: 0.4rem; }
  .tag-form input { flex: 1 1 auto; min-width: 0; }
  .tag-list { display: flex; gap: 0.35rem; flex-wrap: wrap; }
  .tag-chip {
    display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.2rem 0.5rem;
    border: 1px solid var(--border); border-radius: 999px; background: var(--panel-solid); font-size: 0.78rem;
  }
  .tag-chip button { min-height: 1.25rem; padding: 0 0.25rem; border: 0; background: transparent; color: var(--danger); font-size: 0.75rem; }
  .empty-msg { margin: 0; font-size: 0.875rem; color: var(--muted); }
</style>
