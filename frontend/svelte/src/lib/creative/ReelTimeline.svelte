<script lang="ts">
  import {
    effectiveClipDuration,
    formatTimecodePrecise,
    TRANSITION_OPTIONS,
    type ClipTransition,
    type ReelAudioTrack,
    type ReelCaption,
    type ReelTimelineClip,
  } from "./reel-model.ts";
  import ReelAudioLane from "./ReelAudioLane.svelte";

  type Props = {
    clips: readonly ReelTimelineClip[];
    captions: readonly ReelCaption[];
    audio: ReelAudioTrack;
    playing: boolean;
    totalSec: number;
    playheadSec: number;
    selectedClipId: string | null;
    selectedCaptionId: string | null;
    onSeek: (sec: number) => void;
    onSelectClip: (id: string) => void;
    onSelectCaption: (id: string) => void;
    onSplitClip: (id: string) => void;
    onDuplicateClip: (id: string) => void;
    onReorderClip: (index: number, delta: number) => void;
    onDeleteClip: (id: string) => void;
    onTransitionChange: (id: string, transition: ClipTransition) => void;
    onAddCaptionAtPlayhead: () => void;
    onDeleteCaption: (id: string) => void;
    onAudioPatch: (patch: Partial<ReelAudioTrack>) => void;
  };

  let {
    clips,
    captions,
    audio,
    playing,
    totalSec,
    playheadSec,
    selectedClipId,
    selectedCaptionId,
    onSeek,
    onSelectClip,
    onSelectCaption,
    onSplitClip,
    onDuplicateClip,
    onReorderClip,
    onDeleteClip,
    onTransitionChange,
    onAddCaptionAtPlayhead,
    onDeleteCaption,
    onAudioPatch,
  }: Props = $props();

  let playheadPct = $derived(totalSec > 0 ? Math.min(100, Math.max(0, (playheadSec / totalSec) * 100)) : 0);

  let ticks = $derived.by<number[]>(() => {
    const dur = Math.max(1, Math.ceil(totalSec));
    const step = dur > 30 ? 5 : dur > 12 ? 2 : 1;
    const out: number[] = [];
    for (let s = 0; s <= dur; s += step) out.push(s);
    return out;
  });

  function scrubFromClick(event: MouseEvent) {
    if (totalSec <= 0) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    onSeek(Math.round(ratio * totalSec * 10) / 10);
  }
</script>

<div class="timeline-shell" role="region" aria-label="Multi-track timeline">
  <div class="timeline-head">
    <h3>Multi-Track Timeline</h3>
    <div class="timeline-tools">
      <button type="button" disabled={!selectedClipId} onclick={() => selectedClipId && onSplitClip(selectedClipId)}>Split</button>
      <button type="button" disabled={!selectedClipId} onclick={() => selectedClipId && onDuplicateClip(selectedClipId)}>Duplicate</button>
      <button type="button" onclick={onAddCaptionAtPlayhead}>+ Caption</button>
    </div>
  </div>

  <div class="scrub-row">
    <label for="reel-timeline-scrub" class="sr-only">Scrub playhead</label>
    <input
      id="reel-timeline-scrub"
      type="range"
      min="0"
      max={Math.max(0, totalSec)}
      step="0.1"
      disabled={totalSec <= 0}
      value={playheadSec}
      oninput={(e) => onSeek(Number(e.currentTarget.value))}
    />
  </div>

  <div class="tracks-scroll">
    <div class="tracks-stage">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="ruler-row" onclick={scrubFromClick} title="Click ruler to scrub playhead">
        <div class="lane-label">Ruler</div>
        <div class="lane-body ruler-body">
          {#each ticks as sec (sec)}
            <span class="tick" style:left="{totalSec > 0 ? Math.min(100, (sec / totalSec) * 100) : 0}%">{sec}s</span>
          {/each}
        </div>
      </div>

      <div class="track-row">
        <div class="lane-label">Video ({clips.length})</div>
        <div class="lane-body video-lane">
          {#if clips.length === 0}
            <p class="lane-empty">No visual clips yet.</p>
          {:else}
            {#each clips as clip, index (clip.id)}
              {@const dur = effectiveClipDuration(clip)}
              {@const pct = totalSec > 0 ? Math.max(8, (dur / totalSec) * 100) : 100}
              <div class="clip-slot" style:flex="0 0 {pct}%">
                {#if index > 0}
                  <select
                    class="transition-pill"
                    aria-label="Transition before {clip.title}"
                    value={clip.transition}
                    onchange={(e) => onTransitionChange(clip.id, e.currentTarget.value as ClipTransition)}
                  >
                    {#each TRANSITION_OPTIONS as opt (opt.id)}
                      <option value={opt.id}>{opt.label}</option>
                    {/each}
                  </select>
                {/if}
                <div class="clip-block" class:selected={selectedClipId === clip.id}>
                  <button type="button" class="clip-select" onclick={() => onSelectClip(clip.id)}>
                    <span class="clip-name">{index + 1}. {clip.title}</span>
                    <span class="clip-dur">{dur}s{clip.trimInSec || clip.trimOutSec ? " trimmed" : ""}</span>
                  </button>
                  <div class="clip-mini-actions">
                    <button type="button" aria-label="Move {clip.title} left" disabled={index === 0} onclick={() => onReorderClip(index, -1)}>&lt;</button>
                    <button type="button" aria-label="Move {clip.title} right" disabled={index === clips.length - 1} onclick={() => onReorderClip(index, 1)}>&gt;</button>
                    <button type="button" class="danger" aria-label="Delete {clip.title}" onclick={() => onDeleteClip(clip.id)}>x</button>
                  </div>
                </div>
              </div>
            {/each}
          {/if}
          {#if totalSec > 0}
            <div class="playhead-needle" style:left="{playheadPct}%" aria-hidden="true"></div>
          {/if}
        </div>
      </div>

      <div class="track-row">
        <div class="lane-label">Captions ({captions.length})</div>
        <div class="lane-body caption-lane">
          {#if captions.length === 0}
            <p class="lane-empty">Click "+ Caption" to add a timed subtitle.</p>
          {:else}
            {#each captions as cap (cap.id)}
              {@const left = totalSec > 0 ? Math.min(95, (cap.startSec / totalSec) * 100) : 0}
              {@const width = totalSec > 0 ? Math.max(8, ((cap.endSec - cap.startSec) / totalSec) * 100) : 25}
              <div
                class="caption-pill"
                class:selected={selectedCaptionId === cap.id}
                style:left="{left}%"
                style:width="{Math.min(100 - left, width)}%"
              >
                <button type="button" class="caption-btn" onclick={() => onSelectCaption(cap.id)}>
                  <span>{cap.text}</span>
                  <small>{formatTimecodePrecise(cap.startSec)}</small>
                </button>
                <button type="button" class="cap-del" aria-label="Delete caption {cap.text}" onclick={() => onDeleteCaption(cap.id)}>x</button>
              </div>
            {/each}
          {/if}
          {#if totalSec > 0}
            <div class="playhead-needle" style:left="{playheadPct}%" aria-hidden="true"></div>
          {/if}
        </div>
      </div>

      <ReelAudioLane {audio} {playing} {onAudioPatch} />
    </div>
  </div>
</div>

<style>
  .timeline-shell { display: grid; gap: 0.5rem; padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.625rem; background: var(--surface); min-width: 0; }
  .timeline-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
  .timeline-tools { display: flex; gap: 0.375rem; flex-wrap: wrap; }
  .scrub-row input[type="range"] { width: 100%; min-height: 1.75rem; padding: 0; border: 0; background: transparent; accent-color: var(--accent); }
  .tracks-scroll { overflow-x: auto; min-width: 0; }
  .tracks-stage { display: grid; gap: 0.45rem; min-width: 30rem; }
  .ruler-row, .track-row { display: grid; grid-template-columns: 6.75rem minmax(0, 1fr); gap: 0.5rem; align-items: stretch; }
  .lane-label { display: flex; align-items: center; padding: 0.35rem 0.5rem; font-size: 0.75rem; font-weight: 600; color: var(--muted); border: 1px solid var(--border); border-radius: 0.4rem; background: var(--panel-solid); }
  .lane-body { position: relative; min-height: 2.75rem; border: 1px solid var(--border); border-radius: 0.4rem; background: var(--panel); overflow: hidden; }
  .ruler-body { min-height: 1.65rem; cursor: pointer; background: var(--panel-solid); }
  .tick { position: absolute; top: 0.2rem; transform: translateX(-50%); font-family: var(--font-mono); font-size: 0.68rem; color: var(--muted); pointer-events: none; }
  .video-lane { display: flex; align-items: stretch; padding: 0.25rem; gap: 0.25rem; }
  .clip-slot { display: flex; align-items: center; gap: 0.2rem; min-width: 5.5rem; }
  .transition-pill { min-height: 1.75rem; padding: 0.1rem 0.25rem; font-size: 0.68rem; width: 3.7rem; flex-shrink: 0; }
  .clip-block { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 0.25rem; padding: 0.25rem 0.4rem; border: 1px solid var(--border); border-radius: 0.375rem; background: var(--panel-solid); }
  .clip-block.selected { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  .clip-select { flex: 1 1 auto; min-width: 0; display: grid; text-align: left; border: 0; background: transparent; padding: 0.15rem; min-height: 2rem; }
  .clip-name { font-size: 0.78rem; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .clip-dur { font-size: 0.68rem; font-family: var(--font-mono); color: var(--muted); }
  .clip-mini-actions { display: flex; gap: 0.2rem; }
  .clip-mini-actions button { min-height: 1.75rem; padding: 0.15rem 0.35rem; font-size: 0.72rem; }
  .caption-lane { min-height: 2.6rem; padding: 0.25rem; }
  .caption-pill { position: absolute; top: 0.25rem; bottom: 0.25rem; display: flex; align-items: center; border: 1px solid var(--border); border-radius: 0.35rem; background: var(--panel-solid); overflow: hidden; }
  .caption-pill.selected { border-color: var(--accent); }
  .caption-btn { flex: 1 1 auto; min-width: 0; min-height: 1.8rem; display: flex; align-items: center; gap: 0.35rem; border: 0; background: transparent; padding: 0 0.35rem; font-size: 0.74rem; }
  .caption-btn span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .caption-btn small { font-family: var(--font-mono); font-size: 0.65rem; color: var(--muted); }
  .cap-del { min-height: 1.6rem; padding: 0 0.35rem; border: 0; background: transparent; color: var(--danger); font-size: 0.72rem; }
  .lane-empty { margin: 0.5rem; font-size: 0.78rem; color: var(--muted); }
  .playhead-needle { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--danger); pointer-events: none; z-index: 5; }
</style>
