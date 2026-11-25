<script module lang="ts">
  export type AppleSliderProps = {
    value: number;
    min?: number;
    max?: number;
    step?: number;
    ariaLabel: string;
    leftIcon?: string;
    rightIcon?: string;
    disabled?: boolean;
    valueText?: string;
    onChange: (value: number) => void;
  };
</script>

<script lang="ts">
  const SPRITE_ALIASES: Readonly<Record<string, string>> = {
    brightness: "g-sun", sun: "g-sun", moon: "g-moon", volume: "g-speaker", speaker: "g-speaker",
    textsize: "g-textsize", sliders: "g-sliders", plus: "g-plus", photo: "g-photo", bell: "g-bell",
    wifi: "g-wifi", bluetooth: "g-bluetooth", gear: "g-gear", globe: "g-globe", clock: "g-clock",
    lock: "g-lock", share: "g-share", trash: "g-trash", info: "g-info", search: "g-search",
    check: "g-check", xmark: "g-xmark", play: "g-play", pause: "g-pause",
  };

  let {
    value,
    min = 0,
    max = 100,
    step = 1,
    ariaLabel,
    leftIcon,
    rightIcon,
    disabled = false,
    valueText,
    onChange,
  }: AppleSliderProps = $props();

  let safeMin = $derived(Number.isFinite(min) ? min : 0);
  let safeMax = $derived(Number.isFinite(max) && max > safeMin ? max : safeMin + 100);
  let safeStep = $derived(Number.isFinite(step) && step > 0 ? step : 1);
  let clamped = $derived(
    Number.isFinite(value) ? Math.max(safeMin, Math.min(safeMax, value)) : safeMin,
  );
  let ratio = $derived((clamped - safeMin) / (safeMax - safeMin));
  let pct = $derived(`${(ratio * 100).toFixed(2)}%`);

  function resolveSpriteId(icon?: string): string | null {
    if (!icon) return null;
    if (icon.startsWith("g-")) return icon;
    return SPRITE_ALIASES[icon.toLowerCase()] ?? null;
  }

  function handleRangeInput(event: Event) {
    if (disabled) return;
    const raw = Number((event.currentTarget as HTMLInputElement).value);
    if (!Number.isFinite(raw)) return;
    const next = Math.max(safeMin, Math.min(safeMax, raw));
    if (next !== clamped) onChange(next);
  }
</script>

<div class="aos-slider-wrap" class:is-disabled={disabled}>
  {#if leftIcon}
    {@const leftSprite = resolveSpriteId(leftIcon)}
    {#if leftSprite}
      <svg class="aos-slider-ico" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
        <use href={`#${leftSprite}`} />
      </svg>
    {:else}
      <span class="aos-slider-glyph" aria-hidden="true">{leftIcon}</span>
    {/if}
  {/if}

  <div class="aos-slider-control" style={`--ratio: ${ratio}; --pct: ${pct};`}>
    <div class="aos-slider-track" aria-hidden="true">
      <div class="aos-slider-fill"></div>
    </div>
    <span class="aos-slider-thumb" aria-hidden="true"></span>
    <input
      type="range"
      class="aos-slider-range"
      min={safeMin}
      max={safeMax}
      step={safeStep}
      value={clamped}
      {disabled}
      aria-label={ariaLabel}
      aria-valuetext={valueText}
      oninput={handleRangeInput}
    />
  </div>

  {#if rightIcon}
    {@const rightSprite = resolveSpriteId(rightIcon)}
    {#if rightSprite}
      <svg class="aos-slider-ico" width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
        <use href={`#${rightSprite}`} />
      </svg>
    {:else}
      <span class="aos-slider-glyph is-lg" aria-hidden="true">{rightIcon}</span>
    {/if}
  {/if}
</div>

<style>
  .aos-slider-wrap { display: flex; align-items: center; gap: 10px; width: 100%; min-width: 0; }
  .aos-slider-wrap.is-disabled { opacity: 0.48; }
  .aos-slider-ico { color: var(--label2); flex-shrink: 0; display: block; }
  .aos-slider-glyph { color: var(--label2); font-size: 12px; font-weight: 600; line-height: 1; flex-shrink: 0; user-select: none; }
  .aos-slider-glyph.is-lg { font-size: 15px; }

  .aos-slider-control {
    position: relative;
    flex: 1;
    height: 28px;
    display: flex;
    align-items: center;
    cursor: pointer;
  }

  .aos-slider-wrap.is-disabled .aos-slider-control { cursor: not-allowed; }

  .aos-slider-control:has(.aos-slider-range:focus-visible) {
    outline: 2px solid var(--tint);
    outline-offset: 4px;
    border-radius: 999px;
  }

  .aos-slider-track {
    position: relative;
    width: 100%;
    height: 6px;
    border-radius: 999px;
    background: var(--fill2);
    overflow: hidden;
    pointer-events: none;
  }

  .aos-slider-fill { height: 100%; width: var(--pct, 0%); border-radius: 999px; background: var(--tint); }

  .aos-slider-thumb {
    position: absolute;
    top: 50%;
    left: calc(13px + (100% - 26px) * var(--ratio, 0));
    width: 26px;
    height: 26px;
    border-radius: 999px;
    background: #ffffff;
    transform: translate(-50%, -50%);
    pointer-events: none;
    box-shadow: 0 2px 7px rgba(0, 0, 0, 0.25), 0 0.5px 1.5px rgba(0, 0, 0, 0.14);
  }

  .aos-slider-range {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    min-height: 0;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    opacity: 0;
    cursor: inherit;
    appearance: none;
  }
</style>
