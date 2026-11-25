<script module lang="ts">
  export type AppleSwitchProps = {
    id?: string;
    checked: boolean;
    disabled?: boolean;
    ariaLabel?: string;
    onChange: (checked: boolean) => void;
  };
</script>

<script lang="ts">
  let {
    id,
    checked,
    disabled = false,
    ariaLabel,
    onChange,
  }: AppleSwitchProps = $props();
</script>

<label class="aos-switch" class:is-on={checked} class:is-disabled={disabled}>
  <input
    type="checkbox"
    {id}
    {checked}
    {disabled}
    aria-label={ariaLabel}
    role="switch"
    aria-checked={checked}
    onchange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)}
    class="aos-switch-input"
  />
  <span class="aos-switch-knob" aria-hidden="true"></span>
</label>

<style>
  .aos-switch {
    position: relative;
    display: inline-flex;
    align-items: center;
    width: 47px;
    height: 29px;
    min-height: 29px;
    padding: 2px;
    border-radius: 999px;
    background: var(--fill2);
    cursor: pointer;
    flex-shrink: 0;
    transition: background-color 0.22s cubic-bezier(0.3, 0.9, 0.3, 1);
  }

  .aos-switch.is-on {
    background: var(--tint);
  }

  .aos-switch.is-disabled {
    opacity: 0.48;
    cursor: not-allowed;
  }

  .aos-switch:has(.aos-switch-input:focus-visible) {
    outline: 2px solid var(--tint);
    outline-offset: 2px;
  }

  .aos-switch-input {
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

  .aos-switch-knob {
    width: 25px;
    height: 25px;
    border-radius: 999px;
    background: #ffffff;
    pointer-events: none;
    box-shadow:
      0 2px 6px rgba(0, 0, 0, 0.24),
      0 0.5px 1px rgba(0, 0, 0, 0.14);
    transform: translateX(0);
    transition: transform 0.24s cubic-bezier(0.3, 0.9, 0.3, 1);
  }

  .aos-switch.is-on .aos-switch-knob {
    transform: translateX(18px);
  }
</style>
