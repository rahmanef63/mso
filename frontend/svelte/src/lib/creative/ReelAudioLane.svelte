<script lang="ts">
  import { resolveRawMediaUrl } from "../media/media-api.ts";
  import type { ReelAudioTrack } from "./reel-model.ts";

  type Props = {
    audio: ReelAudioTrack;
    playing: boolean;
    onAudioPatch: (patch: Partial<ReelAudioTrack>) => void;
  };

  let { audio, playing, onAudioPatch }: Props = $props();
  let audioEl = $state<HTMLAudioElement | null>(null);

  let audioSrc = $derived.by<string | null>(() => {
    if (!audio.path.trim()) return null;
    try { return resolveRawMediaUrl(audio.path); } catch { return null; }
  });

  $effect(() => {
    if (!audioEl) return;
    audioEl.volume = Math.min(1, Math.max(0, audio.volume / 100));
    audioEl.muted = audio.muted;
    if (playing && audioSrc) {
      void audioEl.play().catch(() => { /* autoplay guard */ });
    } else {
      audioEl.pause();
    }
  });
</script>

<div class="track-row">
  <div class="lane-label">Audio</div>
  <div class="lane-body audio-lane">
    <input
      type="text"
      class="audio-path"
      value={audio.path}
      placeholder="/path/to/music.mp3 (optional background track)"
      aria-label="Background audio path"
      oninput={(e) => onAudioPatch({ path: e.currentTarget.value })}
    />
    <label class="vol-wrap">
      <span>Vol {audio.muted ? "Muted" : `${audio.volume}%`}</span>
      <input
        type="range"
        min="0"
        max="100"
        value={audio.volume}
        aria-label="Audio track volume"
        oninput={(e) => onAudioPatch({ volume: Number(e.currentTarget.value), muted: false })}
      />
    </label>
    <button
      type="button"
      class:active-mute={audio.muted}
      aria-pressed={audio.muted}
      onclick={() => onAudioPatch({ muted: !audio.muted })}
    >
      {audio.muted ? "Unmute" : "Mute"}
    </button>
    {#if audioSrc}
      <audio bind:this={audioEl} src={audioSrc} loop class="sr-only"></audio>
    {/if}
  </div>
</div>

<style>
  .track-row { display: grid; grid-template-columns: 6.75rem minmax(0, 1fr); gap: 0.5rem; align-items: stretch; }
  .lane-label {
    display: flex; align-items: center; padding: 0.35rem 0.5rem; font-size: 0.75rem; font-weight: 600;
    color: var(--muted); border: 1px solid var(--border); border-radius: 0.4rem; background: var(--panel-solid);
  }
  .lane-body { position: relative; min-height: 2.75rem; border: 1px solid var(--border); border-radius: 0.4rem; background: var(--panel); overflow: hidden; }
  .audio-lane { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; padding: 0.35rem 0.5rem; }
  .audio-path { flex: 1 1 12rem; min-height: 2rem; font-size: 0.8rem; font-family: var(--font-mono); }
  .vol-wrap { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.75rem; color: var(--muted); }
  .vol-wrap input { width: 5.5rem; min-height: 1.5rem; padding: 0; border: 0; background: transparent; accent-color: var(--accent); }
  .active-mute { color: var(--danger); border-color: var(--danger); background: var(--danger-bg); }
</style>
