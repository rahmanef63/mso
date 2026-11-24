<script lang="ts">
  import { PLAYBACK_RATES, formatSeconds } from "./media-format.ts";

  let {
    src, name, kind, onError = () => {},
  }: {
    src: string;
    name: string;
    kind: "video" | "audio";
    onError?: (message: string) => void;
  } = $props();

  let element = $state<HTMLMediaElement | null>(null);
  let playing = $state(false);
  let duration = $state(0);
  let position = $state(0);
  let rate = $state(1);
  let loop = $state(false);
  let muted = $state(false);
  let volume = $state(1);

  let progress = $derived(duration > 0 ? Math.min(100, (position / duration) * 100) : 0);

  function toggle() {
    if (!element) return;
    if (element.paused) void element.play().catch(() => onError("Playback was blocked by the browser."));
    else element.pause();
  }

  function seek(next: number) {
    if (!element || !Number.isFinite(next)) return;
    element.currentTime = Math.max(0, Math.min(duration || next, next));
    position = element.currentTime;
  }

  function applyRate(next: number) {
    rate = next;
    if (element) element.playbackRate = next;
  }

  function applyLoop(next: boolean) {
    loop = next;
    if (element) element.loop = next;
  }

  function applyMute(next: boolean) {
    muted = next;
    if (element) element.muted = next;
  }

  function applyVolume(next: number) {
    volume = next;
    if (element) element.volume = next;
  }
</script>

<div class="playback" data-media-player={kind}>
  {#if kind === "video"}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video
      bind:this={element}
      {src}
      playsinline
      preload="metadata"
      aria-label={name}
      onplay={() => { playing = true; }}
      onpause={() => { playing = false; }}
      onended={() => { playing = false; }}
      ontimeupdate={() => { if (element) position = element.currentTime; }}
      ondurationchange={() => { if (element) duration = Number.isFinite(element.duration) ? element.duration : 0; }}
      onerror={() => onError("This browser could not decode the video. Check the path and container format.")}
    ></video>
  {:else}
    <div class="audio-stage" aria-hidden="true">
      <span class="audio-badge">AUDIO</span>
      <span class="audio-name">{name}</span>
    </div>
    <audio
      bind:this={element}
      {src}
      preload="metadata"
      aria-label={name}
      onplay={() => { playing = true; }}
      onpause={() => { playing = false; }}
      onended={() => { playing = false; }}
      ontimeupdate={() => { if (element) position = element.currentTime; }}
      ondurationchange={() => { if (element) duration = Number.isFinite(element.duration) ? element.duration : 0; }}
      onerror={() => onError("This browser could not decode the audio. Check the path and container format.")}
    ></audio>
  {/if}

  <div class="transport" role="group" aria-label={`${name} playback controls`}>
    <button type="button" class="play" onclick={toggle} aria-label={playing ? "Pause" : "Play"}>
      {playing ? "Pause" : "Play"}
    </button>
    <span class="clock">{formatSeconds(position)}</span>
    <input
      class="scrub"
      type="range"
      min="0"
      max={duration || 0}
      step="0.1"
      value={position}
      aria-label="Seek"
      oninput={(event) => seek(Number(event.currentTarget.value))}
    />
    <span class="clock">{formatSeconds(duration)}</span>
    <div class="toggles">
      <label class="toggle">
        <span>Speed</span>
        <select value={String(rate)} onchange={(event) => applyRate(Number(event.currentTarget.value))}>
          {#each PLAYBACK_RATES as option (option)}
            <option value={String(option)}>{option}x</option>
          {/each}
        </select>
      </label>
      <label class="toggle">
        <input type="checkbox" checked={loop} onchange={(event) => applyLoop(event.currentTarget.checked)} />
        <span>Loop</span>
      </label>
      <label class="toggle">
        <input type="checkbox" checked={muted} onchange={(event) => applyMute(event.currentTarget.checked)} />
        <span>Mute</span>
      </label>
      {#if kind === "audio"}
        <label class="toggle volume">
          <span>Volume</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            aria-label="Volume"
            oninput={(event) => applyVolume(Number(event.currentTarget.value))}
          />
        </label>
      {/if}
    </div>
  </div>
  <div class="progress-rail" aria-hidden="true"><span style={`width:${progress}%`}></span></div>
</div>

<style>
  .playback { display: grid; gap: 0.625rem; width: 100%; min-width: 0; }
  video { width: 100%; max-height: 24rem; border-radius: 0.5rem; background: #0c0d10; }
  .audio-stage {
    display: grid; gap: 0.25rem; place-items: center; padding: 2rem 1rem;
    border: 1px solid var(--border); border-radius: 0.5rem; background: var(--surface);
  }
  .audio-badge { font-size: 0.6875rem; letter-spacing: 0.12em; color: var(--muted); }
  .audio-name { font-size: 0.9375rem; font-weight: 600; overflow-wrap: anywhere; text-align: center; }
  .transport { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .play { min-width: 4.5rem; }
  .clock { font-family: var(--font-mono); font-size: 0.75rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  .scrub { flex: 1 1 10rem; min-width: 6rem; accent-color: var(--accent); }
  .toggles { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; width: 100%; }
  .toggle { display: inline-flex; align-items: center; gap: 0.375rem; font-size: 0.75rem; color: var(--muted); }
  .toggle select { min-height: 1.75rem; padding: 0 0.25rem; }
  .volume input { width: 6rem; accent-color: var(--accent); }
  .progress-rail { height: 3px; border-radius: 999px; background: var(--border); overflow: hidden; }
  .progress-rail span { display: block; height: 100%; background: var(--accent); transition: width 120ms linear; }
</style>
