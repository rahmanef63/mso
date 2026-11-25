<script module lang="ts">
  export type AppleAccentPickerProps = {
    value: string;
    disabled?: boolean;
    onChange: (hex: string) => void;
  };
</script>

<script lang="ts">
  import { APPLE_ACCENTS } from "./apple-theme.ts";
  import { eqAppleColor } from "./apple-utils.ts";

  const ACCENT_LABELS: Readonly<Record<string, string>> = {
    "#0a84ff": "Blue",
    "#5e5ce6": "Indigo",
    "#bf5af2": "Purple",
    "#ff375f": "Pink",
    "#ff9f0a": "Orange",
    "#30d158": "Green",
    "#8e8e93": "Graphite",
  };

  let { value, disabled = false, onChange }: AppleAccentPickerProps = $props();

  function labelFor(hex: string): string {
    return ACCENT_LABELS[hex.toLowerCase()] ?? hex;
  }

  function handleSelect(hex: string) {
    if (disabled) return;
    onChange(hex);
  }
</script>

<div class="aos-accent-picker" class:is-disabled={disabled} role="radiogroup" aria-label="Accent color">
  {#each APPLE_ACCENTS as hex (hex)}
    {@const active = eqAppleColor(value, hex)}
    <button
      type="button"
      role="radio"
      class="aos-swatch"
      class:is-active={active}
      style={`--swatch: ${hex};`}
      aria-checked={active}
      aria-label={labelFor(hex)}
      title={labelFor(hex)}
      {disabled}
      onclick={() => handleSelect(hex)}
    ></button>
  {/each}
</div>

<style>
  .aos-accent-picker {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    padding: 4px 2px;
  }

  .aos-accent-picker.is-disabled {
    opacity: 0.5;
  }

  .aos-swatch {
    width: 26px;
    height: 26px;
    min-width: 26px;
    min-height: 26px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: var(--swatch);
    box-shadow: inset 0 0 0 0.5px rgba(0, 0, 0, 0.16);
    cursor: pointer;
    flex-shrink: 0;
    transition:
      transform 0.18s cubic-bezier(0.3, 0.9, 0.3, 1),
      box-shadow 0.18s ease;
  }

  .aos-swatch:hover:not(:disabled):not(.is-active) {
    transform: scale(1.06);
  }

  .aos-swatch.is-active {
    box-shadow:
      0 0 0 2px var(--card),
      0 0 0 4px var(--swatch);
    transform: scale(1.12);
  }

  .aos-swatch:disabled {
    cursor: not-allowed;
  }
</style>
