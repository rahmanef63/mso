<script lang="ts">
  import { tick } from "svelte";
  import { resolveAppIcon } from "./app-icons.ts";
  import type { ChromeProfile } from "./chrome-profile.ts";
  import type { WindowState } from "./window-store.ts";

  let {
    open,
    windows,
    focusedWinId = null,
    chrome = "macos",
    label = "Mission Control",
    onFocusWindow,
    onCloseWindow,
    onMinimizeAll,
    onTileWindows,
    onClose,
  }: {
    open: boolean;
    windows: readonly WindowState[];
    focusedWinId?: string | null;
    chrome?: ChromeProfile;
    label?: string;
    onFocusWindow: (id: string) => void;
    onCloseWindow: (id: string) => void;
    onMinimizeAll: () => void;
    onTileWindows: () => void;
    onClose: () => void;
  } = $props();

  let closeBtn = $state<HTMLButtonElement | null>(null);
  let brokenImages = $state<Record<string, boolean>>({});

  $effect(() => {
    if (!open) return;
    void tick().then(() => {
      closeBtn?.focus();
    });
  });

  function handleWindowKeydown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  function revealWindow(id: string) {
    onFocusWindow(id);
    onClose();
  }

  function statusBadge(win: WindowState): string {
    if (win.minimized) return "Minimized";
    if (win.id === focusedWinId) return "Focused";
    if (win.maximized) return "Maximized";
    return "Open";
  }

  function markBroken(key: string) {
    brokenImages = { ...brokenImages, [key]: true };
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if open}
  <div class="mc-layer" role="dialog" aria-modal="true" aria-label={label}>
    <button
      type="button"
      class="mc-backdrop"
      aria-label={`Close ${label}`}
      tabindex="-1"
      onclick={onClose}
    ></button>

    <div class="mc-shell">
      <header class="mc-header">
        <div class="mc-heading">
          <h2>{label}</h2>
          <span class="mc-count">{windows.length} {windows.length === 1 ? "window" : "windows"}</span>
        </div>
        <div class="mc-actions">
          <button
            type="button"
            class="mc-action-btn"
            disabled={windows.length === 0}
            onclick={() => {
              onTileWindows();
              onClose();
            }}
          >
            Tile Windows
          </button>
          <button
            type="button"
            class="mc-action-btn"
            disabled={windows.length === 0}
            onclick={() => {
              onMinimizeAll();
              onClose();
            }}
          >
            Minimize All
          </button>
          <button type="button" class="mc-action-btn mc-done-btn" bind:this={closeBtn} onclick={onClose}>
            Done
          </button>
        </div>
      </header>

      {#if windows.length === 0}
        <div class="mc-empty" role="status">
          <p>No open windows</p>
        </div>
      {:else}
        <div class="mc-grid" role="list" aria-label="Open windows">
          {#each windows as win (win.id)}
            {@const visual = resolveAppIcon(win.app, chrome)}
            {@const showImg = Boolean(visual.image) && !brokenImages[win.app]}
            {@const isFocused = win.id === focusedWinId && !win.minimized}
            <article class="mc-card" class:focused={isFocused} role="listitem">
              <button
                type="button"
                class="mc-preview"
                aria-label={`Focus ${win.title}`}
                onclick={() => revealWindow(win.id)}
              >
                <div class="mc-preview-bar" style:background={visual.gradient} aria-hidden="true">
                  <span class="mc-dots">
                    <span class="mc-dot"></span>
                    <span class="mc-dot"></span>
                    <span class="mc-dot"></span>
                  </span>
                </div>
                <div class="mc-preview-body" aria-hidden="true">
                  <span class="mc-preview-icon" style:background={visual.gradient}>
                    {#if showImg && visual.image}
                      <img
                        src={visual.image}
                        alt=""
                        loading="lazy"
                        draggable="false"
                        onerror={() => markBroken(win.app)}
                      />
                    {:else}
                      <span class="mc-preview-mono">{visual.monogram}</span>
                    {/if}
                  </span>
                </div>
                <span class="mc-status-badge" class:minimized={win.minimized}>
                  {statusBadge(win)}
                </span>
              </button>

              <div class="mc-card-footer">
                <span class="mc-mini-icon" style:background={visual.gradient} aria-hidden="true">
                  {#if showImg && visual.image}
                    <img src={visual.image} alt="" loading="lazy" draggable="false" />
                  {:else}
                    <span>{visual.monogram}</span>
                  {/if}
                </span>
                <span class="mc-card-title">{win.title}</span>
                <button
                  type="button"
                  class="mc-close-btn"
                  aria-label={`Close ${win.title}`}
                  onclick={() => onCloseWindow(win.id)}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                    <path d="M4 4l8 8M12 4l-8 8" stroke-linecap="round" />
                  </svg>
                </button>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .mc-layer {
    position: fixed;
    inset: 0;
    z-index: 8400;
    display: flex;
    flex-direction: column;
    padding: 1.25rem;
  }

  .mc-backdrop {
    position: fixed;
    inset: 0;
    min-height: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: rgba(8, 10, 18, 0.66);
    -webkit-backdrop-filter: blur(28px) saturate(160%);
    backdrop-filter: blur(28px) saturate(160%);
    cursor: default;
  }

  .mc-shell {
    position: relative;
    z-index: 1;
    width: min(72rem, 100%);
    height: 100%;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    pointer-events: none;
  }

  .mc-header {
    pointer-events: auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
    padding: 0.5rem 0.75rem;
    border-radius: 0.875rem;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.18);
    color: #ffffff;
  }

  .mc-heading {
    display: flex;
    align-items: center;
    gap: 0.625rem;
  }

  .mc-heading h2 {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #ffffff;
  }

  .mc-count {
    padding: 0.125rem 0.5rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.14);
    font-size: 0.75rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
  }

  .mc-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .mc-action-btn {
    min-height: 30px;
    padding: 0.25rem 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.24);
    background: rgba(255, 255, 255, 0.12);
    color: #ffffff;
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .mc-action-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.24);
  }

  .mc-done-btn {
    background: rgba(37, 99, 235, 0.82);
    border-color: rgba(96, 165, 250, 0.65);
  }

  .mc-done-btn:hover {
    background: rgba(37, 99, 235, 0.96);
  }

  .mc-empty {
    pointer-events: auto;
    flex: 1;
    display: grid;
    place-items: center;
  }

  .mc-empty p {
    margin: 0;
    padding: 1rem 1.5rem;
    border-radius: 0.875rem;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.16);
    color: rgba(255, 255, 255, 0.86);
    font-size: 0.9375rem;
  }

  .mc-grid {
    pointer-events: auto;
    flex: 1;
    overflow-y: auto;
    padding: 0.25rem;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(15.5rem, 100%), 1fr));
    gap: 1.25rem;
    align-content: start;
  }

  .mc-card {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .mc-preview {
    position: relative;
    width: 100%;
    min-height: 0;
    aspect-ratio: 4 / 3;
    padding: 0;
    border-radius: 0.875rem;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.22);
    background: rgba(24, 26, 36, 0.82);
    box-shadow: 0 14px 34px rgba(0, 0, 0, 0.42);
    display: flex;
    flex-direction: column;
    text-align: left;
    transition: transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
  }

  .mc-card.focused .mc-preview {
    border-color: rgba(96, 165, 250, 0.9);
    box-shadow:
      0 0 0 2px rgba(96, 165, 250, 0.55),
      0 18px 40px rgba(0, 0, 0, 0.5);
  }

  .mc-preview:hover,
  .mc-preview:focus-visible {
    transform: translateY(-2px);
    border-color: rgba(255, 255, 255, 0.78);
    outline: none;
  }

  .mc-preview-bar {
    height: 1.75rem;
    width: 100%;
    padding: 0 0.625rem;
    display: flex;
    align-items: center;
    opacity: 0.92;
  }

  .mc-dots {
    display: inline-flex;
    gap: 0.3rem;
  }

  .mc-dot {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.7);
  }

  .mc-preview-body {
    flex: 1;
    width: 100%;
    display: grid;
    place-items: center;
    background: rgba(255, 255, 255, 0.04);
  }

  .mc-preview-icon {
    width: 3.25rem;
    height: 3.25rem;
    border-radius: 22%;
    overflow: hidden;
    display: grid;
    place-items: center;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
  }

  .mc-preview-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .mc-preview-mono {
    font-size: 1rem;
    font-weight: 700;
    color: #ffffff;
  }

  .mc-status-badge {
    position: absolute;
    right: 0.5rem;
    bottom: 0.5rem;
    padding: 0.15rem 0.45rem;
    border-radius: 0.375rem;
    background: rgba(15, 23, 42, 0.82);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: #ffffff;
    font-size: 0.6875rem;
    font-weight: 600;
  }

  .mc-status-badge.minimized {
    background: rgba(146, 64, 14, 0.88);
  }

  .mc-card-footer {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0 0.25rem;
    color: #ffffff;
  }

  .mc-mini-icon {
    width: 1.15rem;
    height: 1.15rem;
    border-radius: 22%;
    overflow: hidden;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    font-size: 0.55rem;
    font-weight: 700;
    color: #ffffff;
  }

  .mc-mini-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .mc-card-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.8125rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.94);
  }

  .mc-close-btn {
    min-height: 24px;
    width: 24px;
    height: 24px;
    padding: 0;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.22);
    background: rgba(255, 255, 255, 0.14);
    color: #ffffff;
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }

  .mc-close-btn svg {
    width: 12px;
    height: 12px;
  }

  .mc-close-btn:hover {
    background: #dc2626;
    border-color: #ef4444;
  }
</style>
