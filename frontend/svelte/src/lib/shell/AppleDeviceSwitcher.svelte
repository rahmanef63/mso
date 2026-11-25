<script lang="ts">
  import {
    APPLE_DEVICE_BY_ID,
    appleSwitchSegments,
    type AppleDeviceId,
  } from "./apple-devices.ts";

  let {
    modeOverride,
    resolvedDevice,
    isDark,
    visible = true,
    onSelectDevice,
    onSelectTheme,
  }: {
    modeOverride: "auto" | AppleDeviceId;
    resolvedDevice: AppleDeviceId;
    isDark: boolean;
    visible?: boolean;
    onSelectDevice: (id: "auto" | AppleDeviceId) => void;
    onSelectTheme: (mode: "light" | "dark") => void;
  } = $props();

  const segments = appleSwitchSegments();
  const themeButtons: readonly {
    readonly id: "light" | "dark";
    readonly label: string;
    readonly icon: string;
  }[] = [
    { id: "light", label: "Light", icon: "g-sun" },
    { id: "dark", label: "Dark", icon: "g-moon" },
  ];

  const effectiveDevice = $derived(
    modeOverride === "auto" ? resolvedDevice : modeOverride,
  );
  const effectiveOsLabel = $derived(
    APPLE_DEVICE_BY_ID[effectiveDevice]?.os ?? "macOS",
  );
</script>

{#if visible}
  <aside
    class="aos-switcher-wrap"
    aria-label="Device and appearance switcher"
    data-apple-device-switcher
  >
    <div class="aos-switcher-pill" role="toolbar" aria-orientation="vertical">
      {#each segments as seg (seg.id)}
        {@const active = modeOverride === seg.id}
        {@const subLabel = seg.id === "auto" ? `\u2002\u00b7\u2002${effectiveOsLabel}` : ""}
        {@const ariaText =
          seg.id === "auto" ? `Auto (${effectiveOsLabel})` : `${seg.label} (${seg.os})`}
        <button
          type="button"
          class="aos-pvbtn"
          class:is-active={active}
          aria-label={ariaText}
          aria-pressed={active}
          data-device-btn={seg.id}
          onclick={() => onSelectDevice(seg.id)}
        >
          <span class="aos-pvic" class:is-active={active}>
            <svg width="21" height="21" class="aos-pvsvg" aria-hidden="true">
              <use href={`#${seg.icon}`}></use>
            </svg>
          </span>
          <span class="aos-pvlbl" aria-hidden="true">
            {seg.label}{#if subLabel}<span class="aos-pvsub">{subLabel}</span>{/if}
          </span>
        </button>
      {/each}

      <div class="aos-switcher-sep" role="separator" aria-orientation="horizontal"></div>

      {#each themeButtons as t (t.id)}
        {@const active = t.id === "dark" ? isDark : !isDark}
        <button
          type="button"
          class="aos-pvbtn"
          class:is-active={active}
          aria-label={`${t.label} appearance`}
          aria-pressed={active}
          data-theme-btn={t.id}
          onclick={() => onSelectTheme(t.id)}
        >
          <span class="aos-pvic aos-pvic-theme" class:is-active={active}>
            <svg width="19" height="19" class="aos-pvsvg" aria-hidden="true">
              <use href={`#${t.icon}`}></use>
            </svg>
          </span>
          <span class="aos-pvlbl" aria-hidden="true">{t.label}</span>
        </button>
      {/each}
    </div>
  </aside>
{/if}

<style>
  .aos-switcher-wrap {
    position: fixed;
    left: 16px;
    bottom: 16px;
    z-index: 8150;
    font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif;
  }

  .aos-switcher-pill {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 7px;
    border-radius: 23px;
    background: rgba(24, 24, 28, 0.72);
    -webkit-backdrop-filter: blur(24px) saturate(170%);
    backdrop-filter: blur(24px) saturate(170%);
    border: 0.5px solid rgba(255, 255, 255, 0.14);
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.5);
  }

  .aos-switcher-sep {
    height: 0.5px;
    background: rgba(255, 255, 255, 0.13);
    margin: 1px 8px;
  }

  .aos-pvbtn {
    appearance: none;
    border: 0;
    background: transparent;
    padding: 0;
    margin: 0;
    position: relative;
    width: 42px;
    height: 42px;
    display: block;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .aos-pvbtn:focus-visible {
    outline: 2px solid #0a84ff;
    outline-offset: 2px;
    border-radius: 13px;
  }

  .aos-pvic {
    width: 42px;
    height: 42px;
    border-radius: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.09);
    color: rgba(255, 255, 255, 0.92);
    box-shadow: inset 0 0 0 0.5px rgba(255, 255, 255, 0.05);
    will-change: transform;
    transition:
      background 0.32s cubic-bezier(0.32, 0.72, 0, 1),
      color 0.32s cubic-bezier(0.32, 0.72, 0, 1),
      transform 0.32s cubic-bezier(0.32, 0.72, 0, 1);
  }

  .aos-pvic.aos-pvic-theme {
    box-shadow: none;
  }

  .aos-pvic.is-active {
    background: #f4f4f6;
    color: #101014;
    box-shadow: inset 0 0 0 0.5px rgba(0, 0, 0, 0.06);
  }

  .aos-pvic.aos-pvic-theme.is-active {
    box-shadow: none;
  }

  .aos-pvsvg {
    color: currentColor;
    display: block;
  }

  .aos-pvlbl {
    position: absolute;
    left: 52px;
    top: 50%;
    white-space: nowrap;
    padding: 8px 13px;
    border-radius: 12px;
    background: rgba(32, 32, 38, 0.97);
    color: #ffffff;
    font-size: 12.5px;
    font-weight: 600;
    letter-spacing: 0.01em;
    box-shadow: 0 10px 26px rgba(0, 0, 0, 0.5);
    border: 0.5px solid rgba(255, 255, 255, 0.08);
    opacity: 0;
    transform: translate(-8px, -50%) scale(0.94);
    pointer-events: none;
    transition:
      opacity 0.34s cubic-bezier(0.32, 0.72, 0, 1),
      transform 0.34s cubic-bezier(0.32, 0.72, 0, 1);
  }

  .aos-pvsub {
    color: rgba(255, 255, 255, 0.5);
    font-weight: 500;
  }

  .aos-pvbtn:hover .aos-pvlbl,
  .aos-pvbtn:focus-visible .aos-pvlbl {
    opacity: 1;
    transform: translate(0, -50%) scale(1);
  }

  .aos-pvbtn:hover .aos-pvic {
    transform: scale(1.07);
  }

  .aos-pvbtn:active .aos-pvic {
    transform: scale(0.93);
  }

  @media (max-width: 767px) {
    .aos-switcher-wrap {
      display: none;
    }
  }

  :global(:root[data-reduced-motion="true"]) .aos-pvic,
  :global(:root[data-reduced-motion="true"]) .aos-pvlbl {
    transition: none;
  }

  :global(:root[data-reduced-motion="true"]) .aos-pvbtn:hover .aos-pvic,
  :global(:root[data-reduced-motion="true"]) .aos-pvbtn:active .aos-pvic {
    transform: none;
  }

  :global(:root[data-reduced-motion="true"]) .aos-pvlbl {
    transform: translate(0, -50%) scale(1);
  }

  @media (prefers-reduced-motion: reduce) {
    .aos-pvic,
    .aos-pvlbl {
      transition: none;
    }
    .aos-pvbtn:hover .aos-pvic,
    .aos-pvbtn:active .aos-pvic {
      transform: none;
    }
    .aos-pvlbl {
      transform: translate(0, -50%) scale(1);
    }
  }

  :global(:root[data-reduce-glass="true"]) .aos-switcher-pill {
    background: #1e1e22;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    border-color: rgba(255, 255, 255, 0.24);
  }
</style>
