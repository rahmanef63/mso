<script lang="ts">
  import { classifyMediaKind, isSafeHttpUrl, resolveRawMediaUrl } from "../media/media-api.ts";
  import {
    filterCssForPreset,
    formatTimecodePrecise,
    getAspectPreset,
    type ActiveTimelineClip,
    type AspectRatioId,
    type ReelCaption,
  } from "./reel-model.ts";

  type Props = {
    aspect: AspectRatioId;
    active: ActiveTimelineClip | null;
    clipCount: number;
    activeCaption: ReelCaption | null;
    playheadSec: number;
    totalSec: number;
    playing: boolean;
    looping: boolean;
    showSafeZone: boolean;
    onTogglePlay: () => void;
    onPrevClip: () => void;
    onNextClip: () => void;
    onToggleLoop: () => void;
    onToggleSafeZone: () => void;
    onMediaRef?: (el: HTMLImageElement | HTMLVideoElement | null) => void;
  };

  let {
    aspect,
    active,
    clipCount,
    activeCaption,
    playheadSec,
    totalSec,
    playing,
    looping,
    showSafeZone,
    onTogglePlay,
    onPrevClip,
    onNextClip,
    onToggleLoop,
    onToggleSafeZone,
    onMediaRef,
  }: Props = $props();

  let imgEl = $state<HTMLImageElement | null>(null);
  let videoEl = $state<HTMLVideoElement | null>(null);

  let preset = $derived(getAspectPreset(aspect));
  let mediaSrc = $derived.by<string | null>(() => {
    const clip = active?.clip;
    if (!clip) return null;
    if (clip.externalUrl && isSafeHttpUrl(clip.externalUrl)) return clip.externalUrl;
    if (!clip.path) return null;
    try { return resolveRawMediaUrl(clip.path); } catch { return null; }
  });

  let mediaKind = $derived.by<"image" | "video" | "card">(() => {
    const clip = active?.clip;
    if (!clip || !mediaSrc) return "card";
    if (clip.externalUrl && isSafeHttpUrl(clip.externalUrl)) return "image";
    const kind = classifyMediaKind(clip.path);
    return kind === "image" || kind === "video" ? kind : "card";
  });

  let transitionStyle = $derived.by<string>(() => {
    if (!active || !active.inTransition) return "";
    const p = active.transitionProgress;
    if (active.clip.transition === "fade") return `opacity: ${p.toFixed(2)};`;
    if (active.clip.transition === "slide") return `transform: translateX(${Math.round((1 - p) * 24)}px); opacity: ${(0.4 + p * 0.6).toFixed(2)};`;
    if (active.clip.transition === "zoom") return `transform: scale(${(1.12 - p * 0.12).toFixed(3)}); opacity: ${(0.5 + p * 0.5).toFixed(2)};`;
    return "";
  });

  let fallbackText = $derived(activeCaption?.text || active?.clip.caption || "");
  let captionPos = $derived(activeCaption?.position ?? "bottom");
  let captionStyle = $derived(activeCaption?.style ?? "classic");
  let captionSize = $derived(activeCaption?.fontSizePx ?? 16);
  let captionPill = $derived(activeCaption ? activeCaption.bgPill : true);

  $effect(() => {
    onMediaRef?.(mediaKind === "video" ? videoEl : mediaKind === "image" ? imgEl : null);
  });
</script>

<div class="stage-wrap">
  <div class="stage-well">
    <div
      class="stage-frame"
      class:portrait={aspect === "9:16"}
      class:square={aspect === "1:1"}
      style:aspect-ratio={preset.cssRatio}
      style:background={active?.clip.backdropColor ?? "#11131a"}
      role="region"
      aria-label="Stage preview ({preset.label})"
      aria-live="polite"
    >
      {#if active}
        <div class="stage-hud">
          <span>Clip {active.index + 1}/{clipCount}: {active.clip.title}</span>
          <span class="mono">{active.clip.transition.toUpperCase()}</span>
        </div>

        <div class="media-layer" style={transitionStyle}>
          {#if mediaKind === "image" && mediaSrc}
            <img
              bind:this={imgEl}
              class="stage-media"
              src={mediaSrc}
              alt={active.clip.title}
              style:object-fit={active.clip.fit}
              style:filter={filterCssForPreset(active.clip.filter)}
            />
          {:else if mediaKind === "video" && mediaSrc}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video
              bind:this={videoEl}
              class="stage-media"
              src={mediaSrc}
              controls
              style:object-fit={active.clip.fit}
              style:filter={filterCssForPreset(active.clip.filter)}
            ></video>
          {:else}
            <div class="stage-card" style:filter={filterCssForPreset(active.clip.filter)}>
              <strong>{active.clip.title}</strong>
              <span class="card-meta">{formatTimecodePrecise(active.offsetSec)} / {formatTimecodePrecise(active.durationSec)}</span>
              {#if active.clip.path}
                <code>{active.clip.path}</code>
              {/if}
            </div>
          {/if}
        </div>

        {#if fallbackText}
          <p
            class="stage-caption pos-{captionPos} style-{captionStyle}"
            class:no-pill={!captionPill}
            style:font-size="{captionSize}px"
          >
            {fallbackText}
          </p>
        {/if}

        {#if showSafeZone}
          <div class="safe-zone" aria-hidden="true">
            <span class="safe-label">Title Safe</span>
          </div>
        {/if}
      {:else}
        <p class="stage-empty">Add clips from the Asset Bin to start editing.</p>
      {/if}
    </div>
  </div>

  <div class="transport-bar" role="toolbar" aria-label="Playback transport">
    <div class="transport-group">
      <button type="button" onclick={onPrevClip} disabled={clipCount === 0} aria-label="Previous clip">Prev</button>
      <button
        type="button"
        class="primary"
        onclick={onTogglePlay}
        disabled={clipCount === 0}
        aria-pressed={playing}
      >
        {playing ? "Pause" : "Play"}
      </button>
      <button type="button" onclick={onNextClip} disabled={clipCount === 0} aria-label="Next clip">Next</button>
    </div>

    <span class="timecode mono" aria-label="Current timecode">
      {formatTimecodePrecise(playheadSec)} / {formatTimecodePrecise(totalSec)}
    </span>

    <div class="transport-group">
      <button type="button" class:active-toggle={looping} aria-pressed={looping} onclick={onToggleLoop}>
        Loop
      </button>
      <button type="button" class:active-toggle={showSafeZone} aria-pressed={showSafeZone} onclick={onToggleSafeZone}>
        Safe Zone
      </button>
    </div>
  </div>
</div>

<style>
  .stage-wrap { display: grid; gap: 0.625rem; min-width: 0; }
  .stage-well {
    display: grid; place-items: center; padding: 0.75rem; min-height: 15rem;
    border: 1px solid var(--border); border-radius: 0.625rem; background: var(--surface);
  }
  .stage-frame {
    position: relative; width: 100%; max-width: 28rem; max-height: 22rem;
    display: grid; place-items: center; overflow: hidden; border-radius: 0.625rem;
    border: 1px solid var(--border); color: #f5f5f7;
  }
  .stage-frame.portrait { max-width: 13.5rem; }
  .stage-frame.square { max-width: 19rem; }
  .media-layer { position: absolute; inset: 0; display: grid; place-items: center; transition: opacity 120ms ease, transform 120ms ease; }
  .stage-media { width: 100%; height: 100%; }
  .stage-card { display: grid; gap: 0.35rem; padding: 1.25rem; text-align: center; overflow-wrap: anywhere; }
  .stage-card strong { font-size: 1.05rem; color: #ffffff; }
  .card-meta { font-family: var(--font-mono); font-size: 0.75rem; color: #d4d4dc; }
  .stage-empty { margin: 0; padding: 1rem; text-align: center; color: #d4d4dc; font-size: 0.875rem; }
  .stage-hud {
    position: absolute; top: 0.45rem; left: 0.45rem; right: 0.45rem; z-index: 2;
    display: flex; justify-content: space-between; gap: 0.5rem; padding: 0.25rem 0.5rem;
    border-radius: 0.375rem; background: rgba(0, 0, 0, 0.72); color: #ffffff; font-size: 0.72rem;
  }
  .stage-caption {
    position: absolute; left: 0.6rem; right: 0.6rem; z-index: 3; margin: 0; padding: 0.35rem 0.6rem;
    border-radius: 0.4rem; text-align: center; color: #ffffff; background: rgba(0, 0, 0, 0.78);
    font-weight: 600; line-height: 1.25; pointer-events: none; transition: opacity 150ms ease, transform 150ms ease;
  }
  .stage-caption.pos-top { top: 2.35rem; }
  .stage-caption.pos-center { top: 50%; transform: translateY(-50%); }
  .stage-caption.pos-bottom { bottom: 0.75rem; }
  .stage-caption.style-bold { font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; }
  .stage-caption.style-highlight { background: #1f6df0; color: #ffffff; }
  .stage-caption.style-minimal { font-weight: 500; background: rgba(15, 17, 24, 0.55); }
  .stage-caption.no-pill { background: transparent; text-shadow: 0 2px 6px rgba(0, 0, 0, 0.92); }
  .safe-zone {
    position: absolute; inset: 10% 8%; z-index: 4; pointer-events: none;
    border: 1px dashed rgba(255, 255, 255, 0.65); border-radius: 0.25rem;
  }
  .safe-label {
    position: absolute; top: 0.2rem; right: 0.35rem; font-size: 0.625rem;
    font-family: var(--font-mono); color: rgba(255, 255, 255, 0.85);
  }
  .transport-bar {
    display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap;
    padding: 0.5rem 0.625rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--surface);
  }
  .transport-group { display: flex; gap: 0.375rem; flex-wrap: wrap; }
  .timecode { font-size: 0.8125rem; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--text); }
  .mono { font-family: var(--font-mono); }
  .active-toggle { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
</style>
