<script lang="ts">
  import { classifyMediaKind, resolveRawMediaUrl } from "../media/media-api.ts";
  import {
    clampClipDuration, createReelClip, formatTimecode, moveItem, resolveClipAtTime,
    totalDurationSec, type ReelClip,
  } from "./creative-state.ts";

  let clips = $state<ReelClip[]>([]);
  let scrubSec = $state(0);
  let titleInput = $state("");
  let pathInput = $state("");
  let durationInput = $state("5");
  let captionInput = $state("");
  let feedback = $state<string | null>(null);

  let totalSec = $derived(totalDurationSec(clips));
  let safeScrub = $derived(totalSec > 0 ? Math.min(totalSec, Math.max(0, scrubSec)) : 0);
  let active = $derived(resolveClipAtTime(clips, safeScrub));
  let activeKind = $derived(active?.clip.path ? classifyMediaKind(active.clip.path) : "unsupported");
  let activeUrl = $derived.by<string | null>(() => {
    if (!active?.clip.path) return null;
    if (activeKind !== "image" && activeKind !== "video") return null;
    try { return resolveRawMediaUrl(active.clip.path); } catch { return null; }
  });

  function addClip(event: SubmitEvent) {
    event.preventDefault();
    if (!titleInput.trim() && !pathInput.trim()) {
      feedback = "Enter a clip title or host media path.";
      return;
    }
    const created = createReelClip(
      titleInput,
      pathInput,
      clampClipDuration(Number(durationInput)),
      captionInput,
    );
    const startOfNew = totalSec;
    clips = [...clips, created];
    scrubSec = startOfNew;
    titleInput = "";
    pathInput = "";
    durationInput = "5";
    captionInput = "";
    feedback = null;
  }

  function reorderClip(index: number, delta: number) {
    clips = moveItem(clips, index, delta);
  }

  function removeClip(id: string) {
    clips = clips.filter((clip) => clip.id !== id);
    const nextTotal = totalDurationSec(clips);
    if (scrubSec > nextTotal) scrubSec = nextTotal;
  }

  function jumpToClip(targetIndex: number) {
    let offset = 0;
    for (let i = 0; i < targetIndex && i < clips.length; i += 1) {
      offset += clips[i]!.durationSec;
    }
    scrubSec = offset;
  }
</script>

<section aria-labelledby="reel-editor-title">
  <header class="feature-header">
    <h2 id="reel-editor-title">Reel Editor</h2>
    <span class="role-badge">{formatTimecode(safeScrub)} / {formatTimecode(totalSec)}</span>
  </header>

  <div class="reel-layout">
    <div class="preview-col">
      <div class="reel-frame" role="region" aria-label="9 by 16 reel preview" aria-live="polite">
        {#if active}
          <div class="frame-badge">
            Clip {active.index + 1}/{clips.length}: {active.clip.title} ({formatTimecode(active.offsetSec)} / {formatTimecode(active.clip.durationSec)})
          </div>
          {#if activeKind === "image" && activeUrl}
            <img class="frame-media" src={activeUrl} alt={active.clip.title} />
          {:else if activeKind === "video" && activeUrl}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video class="frame-media" controls src={activeUrl}></video>
          {:else}
            <div class="frame-card">
              <strong>{active.clip.title}</strong>
              {#if active.clip.path}
                <code>{active.clip.path}</code>
              {/if}
            </div>
          {/if}
          {#if active.clip.caption}
            <p class="caption-overlay">{active.clip.caption}</p>
          {/if}
        {:else}
          <p class="frame-empty">Add clips to build a vertical 9:16 reel.</p>
        {/if}
      </div>

      <div class="field scrub-box">
        <label for="reel-scrub">Timeline scrub ({formatTimecode(safeScrub)} / {formatTimecode(totalSec)})</label>
        <input
          id="reel-scrub"
          type="range"
          min="0"
          max={Math.max(0, totalSec)}
          step="1"
          disabled={clips.length === 0}
          value={safeScrub}
          oninput={(e) => { scrubSec = Number(e.currentTarget.value); }}
        />
      </div>
    </div>

    <div class="editor-col">
      <form class="clip-form" onsubmit={addClip}>
        <h3>Add clip</h3>
        <div class="form-row">
          <div class="field grow">
            <label for="reel-title">Title</label>
            <input id="reel-title" type="text" bind:value={titleInput} placeholder="Intro hook" autocomplete="off" />
          </div>
          <div class="field dur">
            <label for="reel-dur">Seconds (1-60)</label>
            <input id="reel-dur" type="number" min="1" max="60" bind:value={durationInput} />
          </div>
        </div>
        <div class="field">
          <label for="reel-path">Host media path (optional)</label>
          <input id="reel-path" type="text" bind:value={pathInput} placeholder="/path/to/shot.mp4 or ~/cover.png" autocomplete="off" />
        </div>
        <div class="field">
          <label for="reel-caption">Caption overlay</label>
          <input id="reel-caption" type="text" bind:value={captionInput} placeholder="Live caption shown on screen" autocomplete="off" />
        </div>
        <button type="submit" class="primary">Add clip</button>
      </form>

      {#if feedback}
        <p class="feedback error" role="alert">{feedback}</p>
      {/if}

      <div class="timeline-box">
        <h3>Timeline ({clips.length} {clips.length === 1 ? "clip" : "clips"})</h3>
        {#if clips.length === 0}
          <p class="empty">No clips on the timeline yet.</p>
        {:else}
          <ol class="clip-list">
            {#each clips as clip, index (clip.id)}
              <li class="clip-row" class:active={active?.clip.id === clip.id}>
                <button type="button" class="clip-jump" onclick={() => jumpToClip(index)}>
                  <span class="clip-title">{index + 1}. {clip.title}</span>
                  <span class="clip-meta">{formatTimecode(clip.durationSec)}{clip.caption ? ` | ${clip.caption}` : ""}</span>
                </button>
                <div class="row-actions">
                  <button type="button" aria-label="Move {clip.title} up" disabled={index === 0} onclick={() => reorderClip(index, -1)}>Up</button>
                  <button type="button" aria-label="Move {clip.title} down" disabled={index === clips.length - 1} onclick={() => reorderClip(index, 1)}>Down</button>
                  <button type="button" class="danger" aria-label="Remove {clip.title}" onclick={() => removeClip(clip.id)}>Remove</button>
                </div>
              </li>
            {/each}
          </ol>
        {/if}
      </div>
    </div>
  </div>
</section>

<style>
  .reel-layout { display: grid; gap: 1rem; grid-template-columns: minmax(14rem, 17rem) minmax(0, 1fr); margin-top: 1rem; align-items: start; }
  @media (max-width: 44rem) { .reel-layout { grid-template-columns: 1fr; } }
  .preview-col, .editor-col { display: grid; gap: 0.75rem; }
  .reel-frame {
    position: relative; aspect-ratio: 9 / 16; width: 100%; max-width: 17rem; justify-self: center;
    display: grid; place-items: center; overflow: hidden; border-radius: 0.75rem;
    border: 1px solid var(--border); background: #141414; color: #f5f5f5;
  }
  .frame-media { width: 100%; height: 100%; object-fit: cover; }
  .frame-card { display: grid; gap: 0.375rem; padding: 1rem; text-align: center; overflow-wrap: anywhere; }
  .frame-empty { margin: 0; padding: 1rem; text-align: center; color: #d4d4d4; }
  .frame-badge {
    position: absolute; top: 0.5rem; left: 0.5rem; right: 0.5rem; padding: 0.375rem 0.5rem;
    border-radius: 0.375rem; background: rgba(0, 0, 0, 0.78); color: #ffffff; font-size: 0.75rem; z-index: 1;
  }
  .caption-overlay {
    position: absolute; bottom: 0.75rem; left: 0.5rem; right: 0.5rem; margin: 0; padding: 0.5rem 0.625rem;
    border-radius: 0.375rem; background: rgba(0, 0, 0, 0.82); color: #ffffff; text-align: center; font-size: 0.875rem;
  }
  .scrub-box input[type="range"] { min-height: 2rem; padding: 0; border: 0; background: transparent; accent-color: var(--accent); }
  .clip-form, .timeline-box {
    display: grid; gap: 0.625rem; padding: 0.875rem; border: 1px solid var(--border);
    border-radius: 0.5rem; background: var(--surface);
  }
  .form-row { display: flex; gap: 0.625rem; flex-wrap: wrap; }
  .grow { flex: 1 1 11rem; }
  .dur { flex: 0 1 7.5rem; }
  .clip-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
  .clip-row {
    display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap;
    padding: 0.5rem; border: 1px solid var(--border); border-radius: 0.375rem; background: var(--panel);
  }
  .clip-row.active { border-color: var(--accent); }
  .clip-jump { flex: 1 1 10rem; display: grid; text-align: left; border: 0; background: transparent; padding: 0.25rem; }
  .clip-title { font-weight: 600; color: var(--text); }
  .clip-meta { font-size: 0.8125rem; color: var(--muted); overflow-wrap: anywhere; }
  .row-actions { display: flex; gap: 0.375rem; flex-wrap: wrap; }
  .empty { margin: 0; font-size: 0.875rem; }
</style>
