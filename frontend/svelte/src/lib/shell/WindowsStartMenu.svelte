<script lang="ts">
  import { tick } from "svelte";
  import { resolveAppIcon } from "./app-icons.ts";
  import type { DockAppDef } from "./shell-registry.ts";

  let {
    open,
    dockApps,
    role = null,
    authenticated = true,
    signingOut = false,
    onOpenApp,
    onOpenRun,
    onLock,
    onSignOut,
    onClose,
  }: {
    open: boolean;
    dockApps: readonly DockAppDef[];
    role?: string | null;
    authenticated?: boolean;
    signingOut?: boolean;
    onOpenApp: (app: string, title: string, payload?: unknown, multi?: boolean) => void;
    onOpenRun: () => void;
    onLock: () => void;
    onSignOut: () => void;
    onClose: () => void;
  } = $props();

  let query = $state("");
  let showAllApps = $state(false);
  let searchEl = $state<HTMLInputElement | null>(null);
  let brokenImages = $state<Record<string, boolean>>({});

  let trimmedQuery = $derived(query.trim().toLowerCase());
  let searching = $derived(trimmedQuery.length > 0);
  let filteredApps = $derived.by(() => {
    if (!trimmedQuery) return dockApps;
    return dockApps.filter(
      (item) =>
        item.title.toLowerCase().includes(trimmedQuery) ||
        item.label.toLowerCase().includes(trimmedQuery) ||
        item.app.toLowerCase().includes(trimmedQuery),
    );
  });
  let sortedApps = $derived([...filteredApps].sort((a, b) => a.title.localeCompare(b.title)));
  let listMode = $derived(showAllApps && !searching);

  $effect(() => {
    if (!open) return;
    query = "";
    showAllApps = false;
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

  function openRunDialog() {
    onClose();
    onOpenRun();
  }

  function openSettings() {
    onOpenApp("settings", "Settings");
    onClose();
  }

  function triggerLock() {
    onClose();
    onLock();
  }

  function triggerSignOut() {
    onClose();
    onSignOut();
  }

  function markBroken(app: string) {
    brokenImages = { ...brokenImages, [app]: true };
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if open}
  <div class="wsm-layer">
    <button
      type="button"
      class="wsm-backdrop"
      aria-label="Close Start menu"
      tabindex="-1"
      onclick={onClose}
    ></button>

    <div class="wsm-panel" role="dialog" aria-modal="true" aria-label="Start menu">
      <div class="wsm-search">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <circle cx="9" cy="9" r="5.5" />
          <path d="M13.5 13.5 17 17" stroke-linecap="round" />
        </svg>
        <input
          bind:this={searchEl}
          type="search"
          bind:value={query}
          placeholder="Search for apps, settings, and tools"
          aria-label="Search apps"
          class="wsm-search-input"
          autocomplete="off"
          spellcheck={false}
        />
      </div>

      <div class="wsm-section-bar">
        <span class="wsm-section-title">
          {searching ? "Search results" : listMode ? "All apps" : "Pinned"}
        </span>
        <div class="wsm-section-actions">
          <button type="button" class="wsm-pill-btn" onclick={openRunDialog}>Run...</button>
          {#if !searching}
            <button
              type="button"
              class="wsm-pill-btn"
              onclick={() => {
                showAllApps = !showAllApps;
              }}
            >
              {listMode ? "Back to Pinned" : "All apps"}
            </button>
          {/if}
        </div>
      </div>

      {#if listMode}
        <div class="wsm-list" role="list" aria-label="All apps">
          {#each sortedApps as item (item.app)}
            {@const visual = resolveAppIcon(item.app, "windows")}
            {@const showImg = Boolean(visual.image) && !brokenImages[item.app]}
            <div role="listitem">
              <button type="button" class="wsm-list-item" onclick={() => launchApp(item)}>
                <span class="wsm-icon wsm-icon-sm" style:background={visual.gradient} aria-hidden="true">
                  {#if showImg && visual.image}
                    <img
                      src={visual.image}
                      alt=""
                      loading="lazy"
                      draggable="false"
                      onerror={() => markBroken(item.app)}
                    />
                  {:else}
                    <span>{visual.monogram}</span>
                  {/if}
                </span>
                <span class="wsm-list-title">{item.title}</span>
              </button>
            </div>
          {/each}
        </div>
      {:else}
        <div class="wsm-grid" role="list" aria-label="Pinned apps">
          {#if filteredApps.length === 0}
            <p class="wsm-empty" role="status">No matching apps</p>
          {:else}
            {#each filteredApps as item (item.app)}
              {@const visual = resolveAppIcon(item.app, "windows")}
              {@const showImg = Boolean(visual.image) && !brokenImages[item.app]}
              <div role="listitem">
                <button type="button" class="wsm-tile" onclick={() => launchApp(item)}>
                  <span
                    class="wsm-icon"
                    class:wsm-icon-sm={searching}
                    style:background={visual.gradient}
                    aria-hidden="true"
                  >
                    {#if showImg && visual.image}
                      <img
                        src={visual.image}
                        alt=""
                        loading="lazy"
                        draggable="false"
                        onerror={() => markBroken(item.app)}
                      />
                    {:else}
                      <span>{visual.monogram}</span>
                    {/if}
                  </span>
                  <span class="wsm-tile-title">{item.title}</span>
                </button>
              </div>
            {/each}
          {/if}
        </div>
      {/if}

      <footer class="wsm-footer">
        <div class="wsm-user">
          <span class="wsm-avatar" aria-hidden="true">
            {(role ?? "U").slice(0, 1).toUpperCase()}
          </span>
          <div class="wsm-user-meta">
            <span class="wsm-user-name">MSO Workspace</span>
            <span class="wsm-user-role">{role ?? "Signed out"}</span>
          </div>
        </div>
        <div class="wsm-footer-actions">
          <button type="button" class="wsm-footer-btn" onclick={openSettings}>Settings</button>
          <button type="button" class="wsm-footer-btn" onclick={triggerLock}>Lock</button>
          {#if authenticated}
            <button
              type="button"
              class="wsm-footer-btn"
              disabled={signingOut}
              onclick={triggerSignOut}
            >
              {signingOut ? "Signing out..." : "Sign out"}
            </button>
          {/if}
        </div>
      </footer>
    </div>
  </div>
{/if}

<style>
  .wsm-layer {
    position: fixed;
    inset: 0;
    z-index: 8300;
    pointer-events: none;
  }

  .wsm-backdrop {
    position: fixed;
    inset: 0;
    min-height: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    pointer-events: auto;
    cursor: default;
  }

  .wsm-panel {
    pointer-events: auto;
    position: fixed;
    left: 50%;
    bottom: 3.5rem;
    transform: translateX(-50%);
    width: min(35rem, calc(100vw - 1.5rem));
    max-height: calc(100dvh - 5rem);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1.125rem;
    border-radius: 0.75rem;
    background: rgba(246, 246, 250, 0.94);
    color: #1c1c1f;
    border: 1px solid rgba(0, 0, 0, 0.12);
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.28);
    backdrop-filter: blur(28px) saturate(180%);
    -webkit-backdrop-filter: blur(28px) saturate(180%);
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .wsm-panel {
      background: rgba(32, 32, 38, 0.94);
      color: #f3f3f5;
      border-color: rgba(255, 255, 255, 0.14);
      box-shadow: 0 26px 70px rgba(0, 0, 0, 0.62);
    }
  }

  :global(:root[data-theme="dark"]) .wsm-panel {
    background: rgba(32, 32, 38, 0.94);
    color: #f3f3f5;
    border-color: rgba(255, 255, 255, 0.14);
    box-shadow: 0 26px 70px rgba(0, 0, 0, 0.62);
  }

  .wsm-search {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.2rem 0.75rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--panel-solid);
  }

  .wsm-search svg {
    width: 16px;
    height: 16px;
    color: var(--muted);
    flex-shrink: 0;
  }

  .wsm-search-input {
    width: 100%;
    min-height: 32px;
    padding: 0.2rem 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: inherit;
    font-size: 0.875rem;
    outline: none;
  }

  .wsm-section-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .wsm-section-title {
    font-size: 0.8125rem;
    font-weight: 700;
    letter-spacing: 0.01em;
  }

  .wsm-section-actions {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }

  .wsm-pill-btn {
    min-height: 26px;
    padding: 0.2rem 0.6rem;
    border-radius: 0.375rem;
    border: 1px solid var(--border);
    background: var(--panel-solid);
    color: inherit;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .wsm-pill-btn:hover {
    filter: brightness(0.96);
  }

  .wsm-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(5.25rem, 1fr));
    gap: 0.45rem;
    max-height: 19rem;
    overflow-y: auto;
    padding-right: 0.2rem;
  }

  .wsm-empty {
    grid-column: 1 / -1;
    margin: 1.5rem 0;
    text-align: center;
    font-size: 0.875rem;
    color: var(--muted);
  }

  .wsm-tile {
    width: 100%;
    min-height: 0;
    padding: 0.5rem 0.35rem;
    border: 0;
    border-radius: 0.5rem;
    background: transparent;
    color: inherit;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
  }

  .wsm-tile:hover {
    background: rgba(128, 128, 140, 0.16);
  }

  .wsm-tile-title {
    width: 100%;
    text-align: center;
    font-size: 0.72rem;
    font-weight: 500;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .wsm-list {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    max-height: 19rem;
    overflow-y: auto;
    padding-right: 0.2rem;
  }

  .wsm-list-item {
    width: 100%;
    min-height: 36px;
    padding: 0.35rem 0.5rem;
    border: 0;
    border-radius: 0.45rem;
    background: transparent;
    color: inherit;
    display: flex;
    align-items: center;
    gap: 0.65rem;
    text-align: left;
  }

  .wsm-list-item:hover {
    background: rgba(128, 128, 140, 0.16);
  }

  .wsm-list-title {
    font-size: 0.875rem;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .wsm-icon {
    width: 32px;
    height: 32px;
    border-radius: 7px;
    overflow: hidden;
    display: grid;
    place-items: center;
    color: #ffffff;
    font-size: 0.72rem;
    font-weight: 700;
    flex-shrink: 0;
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.18);
  }

  .wsm-icon-sm {
    width: 24px;
    height: 24px;
    border-radius: 5px;
    font-size: 0.625rem;
  }

  .wsm-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .wsm-footer {
    margin-top: 0.25rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.625rem;
    flex-wrap: wrap;
  }

  .wsm-user {
    display: flex;
    align-items: center;
    gap: 0.55rem;
  }

  .wsm-avatar {
    width: 30px;
    height: 30px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-text);
    display: grid;
    place-items: center;
    font-size: 0.8125rem;
    font-weight: 700;
  }

  .wsm-user-meta {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
  }

  .wsm-user-name {
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .wsm-user-role {
    font-size: 0.72rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .wsm-footer-actions {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    flex-wrap: wrap;
  }

  .wsm-footer-btn {
    min-height: 30px;
    padding: 0.25rem 0.625rem;
    border-radius: 0.45rem;
    border: 1px solid var(--border);
    background: var(--panel-solid);
    color: inherit;
    font-size: 0.78rem;
    font-weight: 600;
  }

  .wsm-footer-btn:hover:not(:disabled) {
    filter: brightness(0.95);
  }
</style>
