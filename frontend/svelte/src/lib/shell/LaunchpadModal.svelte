<script lang="ts">
  import { tick } from "svelte";
  import { resolveAppIcon } from "./app-icons.ts";
  import type { ChromeProfile } from "./chrome-profile.ts";
  import type { DockAppDef } from "./shell-registry.ts";

  let {
    open,
    dockApps,
    chrome = "macos",
    onOpenApp,
    onClose,
  }: {
    open: boolean;
    dockApps: readonly DockAppDef[];
    chrome?: ChromeProfile;
    onOpenApp: (app: string, title: string, payload?: unknown, multi?: boolean) => void;
    onClose: () => void;
  } = $props();

  let query = $state("");
  let searchEl = $state<HTMLInputElement | null>(null);
  let brokenImages = $state<Record<string, boolean>>({});

  let filteredApps = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return dockApps;
    return dockApps.filter(
      (item) =>
        item.title.toLowerCase().includes(needle) ||
        item.label.toLowerCase().includes(needle) ||
        item.app.toLowerCase().includes(needle),
    );
  });

  $effect(() => {
    if (!open) return;
    query = "";
    void tick().then(() => {
      searchEl?.focus();
    });
  });

  function handleWindowKeydown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  function launchApp(item: DockAppDef) {
    onOpenApp(item.app, item.title, item.payload, item.multi);
    onClose();
  }

  function markBroken(app: string) {
    brokenImages = { ...brokenImages, [app]: true };
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if open}
  <div class="lp-layer" role="dialog" aria-modal="true" aria-label="Launchpad">
    <button
      type="button"
      class="lp-backdrop"
      aria-label="Close Launchpad"
      tabindex="-1"
      onclick={onClose}
    ></button>

    <div class="lp-content">
      <div class="lp-search-bar">
        <svg class="lp-search-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <circle cx="9" cy="9" r="5.5" />
          <path d="M13.5 13.5 17 17" stroke-linecap="round" />
        </svg>
        <input
          bind:this={searchEl}
          type="search"
          bind:value={query}
          placeholder="Search"
          aria-label="Search apps"
          class="lp-search-input"
          autocomplete="off"
          spellcheck={false}
        />
        {#if query.length > 0}
          <button
            type="button"
            class="lp-clear-btn"
            aria-label="Clear search"
            onclick={() => {
              query = "";
              searchEl?.focus();
            }}
          >
            Clear
          </button>
        {/if}
      </div>

      <div class="lp-grid" role="list" aria-label="Applications">
        {#if filteredApps.length === 0}
          <p class="lp-empty" role="status">No matching apps</p>
        {:else}
          {#each filteredApps as item (item.app)}
            {@const visual = resolveAppIcon(item.app, chrome)}
            {@const showImg = Boolean(visual.image) && !brokenImages[item.app]}
            <div class="lp-cell" role="listitem">
              <button
                type="button"
                class="lp-app-btn"
                aria-label={item.label}
                onclick={() => launchApp(item)}
              >
                <span class="lp-squircle" style:background={visual.gradient} aria-hidden="true">
                  {#if showImg && visual.image}
                    <img
                      src={visual.image}
                      alt=""
                      loading="lazy"
                      draggable="false"
                      onerror={() => markBroken(item.app)}
                    />
                  {:else}
                    <span class="lp-mono">{visual.monogram}</span>
                  {/if}
                </span>
                <span class="lp-title">{item.title}</span>
              </button>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .lp-layer {
    position: fixed;
    inset: 0;
    z-index: 8400;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2rem 1rem;
  }

  .lp-backdrop {
    position: fixed;
    inset: 0;
    min-height: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: rgba(10, 12, 22, 0.62);
    backdrop-filter: blur(28px) saturate(160%);
    -webkit-backdrop-filter: blur(28px) saturate(160%);
    cursor: default;
  }

  .lp-content {
    position: relative;
    z-index: 1;
    width: min(52rem, 100%);
    max-height: 86vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
    pointer-events: none;
  }

  .lp-search-bar {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: min(19rem, 100%);
    padding: 0.25rem 0.625rem;
    border-radius: 0.625rem;
    background: rgba(255, 255, 255, 0.16);
    border: 1px solid rgba(255, 255, 255, 0.28);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    color: #ffffff;
  }

  .lp-search-icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    opacity: 0.8;
  }

  .lp-search-input {
    width: 100%;
    min-height: 30px;
    padding: 0.2rem 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: #ffffff;
    font-size: 0.9375rem;
    outline: none;
  }

  .lp-search-input::placeholder {
    color: rgba(255, 255, 255, 0.68);
  }

  .lp-clear-btn {
    min-height: 24px;
    padding: 0.15rem 0.45rem;
    border: 0;
    border-radius: 0.375rem;
    background: rgba(255, 255, 255, 0.18);
    color: #ffffff;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .lp-grid {
    pointer-events: auto;
    width: 100%;
    max-height: 70vh;
    overflow-y: auto;
    padding: 0.75rem 1rem 1.5rem;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(5.75rem, 1fr));
    gap: 1.5rem 1rem;
    align-content: start;
  }

  .lp-empty {
    grid-column: 1 / -1;
    margin: 2rem 0;
    text-align: center;
    font-size: 0.9375rem;
    color: rgba(255, 255, 255, 0.78);
  }

  .lp-cell {
    display: flex;
    justify-content: center;
  }

  .lp-app-btn {
    min-height: 0;
    width: 100%;
    max-width: 6.75rem;
    padding: 0.375rem 0.25rem;
    border: 0;
    border-radius: 0.875rem;
    background: transparent;
    color: #ffffff;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }

  .lp-app-btn:hover .lp-squircle,
  .lp-app-btn:focus-visible .lp-squircle {
    transform: scale(1.07);
  }

  .lp-app-btn:focus-visible {
    outline: 2px solid #ffffff;
    outline-offset: 2px;
  }

  .lp-squircle {
    width: 4rem;
    height: 4rem;
    border-radius: 22%;
    overflow: hidden;
    display: grid;
    place-items: center;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.28),
      0 10px 26px rgba(0, 0, 0, 0.36);
    transition: transform 140ms ease;
    flex-shrink: 0;
  }

  .lp-squircle img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .lp-mono {
    font-size: 1.15rem;
    font-weight: 700;
    color: #ffffff;
    letter-spacing: 0.03em;
  }

  .lp-title {
    width: 100%;
    text-align: center;
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 1.25;
    color: #ffffff;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
</style>
