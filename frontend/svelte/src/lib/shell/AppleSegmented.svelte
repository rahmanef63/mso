<script module lang="ts">
  export type AppleSegmentedOption = { value: string; label: string };
  export type AppleSegmentedProps = {
    options: ReadonlyArray<AppleSegmentedOption>;
    value: string;
    ariaLabel: string;
    disabled?: boolean;
    onChange: (value: string) => void;
  };
</script>

<script lang="ts">
  let { options, value, ariaLabel, disabled = false, onChange }: AppleSegmentedProps = $props();

  function selectValue(next: string) {
    if (disabled || next === value) return;
    onChange(next);
  }

  function handleKeydown(event: KeyboardEvent, index: number) {
    if (disabled || options.length === 0) return;
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % options.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + options.length) % options.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = options.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const target = options[nextIndex];
    if (target) {
      selectValue(target.value);
    }
  }
</script>

<div class="aos-seg" class:is-disabled={disabled} role="radiogroup" aria-label={ariaLabel}>
  {#each options as option, index (option.value)}
    <button
      type="button"
      role="radio"
      class="aos-seg-btn"
      class:is-active={option.value === value}
      aria-checked={option.value === value}
      {disabled}
      onclick={() => selectValue(option.value)}
      onkeydown={(event) => handleKeydown(event, index)}
    >
      {option.label}
    </button>
  {/each}
</div>

<style>
  .aos-seg {
    display: inline-flex;
    align-items: center;
    background: var(--fill);
    border-radius: 9px;
    padding: 2px;
    gap: 2px;
    max-width: 100%;
    overflow-x: auto;
  }

  .aos-seg.is-disabled {
    opacity: 0.52;
  }

  .aos-seg-btn {
    flex: 1 0 auto;
    min-height: 28px;
    padding: 4px 11px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--label2);
    font-size: 13px;
    font-weight: 500;
    line-height: 1.25;
    white-space: nowrap;
    box-shadow: none;
    transition:
      background-color 0.18s ease,
      color 0.18s ease,
      box-shadow 0.18s ease;
  }

  .aos-seg-btn:hover:not(:disabled):not(.is-active) {
    color: var(--label);
  }

  .aos-seg-btn.is-active {
    background: var(--elev);
    color: var(--label);
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
  }

  .aos-seg-btn:disabled {
    cursor: not-allowed;
  }
</style>
