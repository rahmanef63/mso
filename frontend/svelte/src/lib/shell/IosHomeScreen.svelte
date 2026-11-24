<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import { resolveAppIcon } from "./app-icons.ts";
  import {
    CHROME_PROFILES,
    isChromeChoice,
    type ChromeChoice,
    type ChromeProfile,
  } from "./chrome-profile.ts";
  import type { DockAppDef } from "./shell-registry.ts";
  import type { WindowState } from "./window-store.ts";

  let {
    authenticated = false,
    role = null,
    focusedTitle = "Home",
    chromeChoice,
    resolvedChrome,
    dockApps,
    openWindows = [],
    clockNow,
    signingOut = false,
    wallpaperUrl = "/wallpapers/ios.webp",
    onOpenApp,
    onRestoreWindow,
    onMinimizeWindow,
    onMinimizeAll,
    onFocusWindow,
    onOpenPalette,
    onOpenControl,
    onOpenShortcuts,
    onChromeChange,
    onSignOut,
    monitorSlot,
    windowsSlot,
    widgetsSlot,
  }: {
    authenticated?: boolean;
    role?: string | null;
    focusedTitle?: string;
    chromeChoice: ChromeChoice;
    resolvedChrome: ChromeProfile;
    dockApps: readonly DockAppDef[];
    openWindows?: readonly WindowState[];
    clockNow?: Date;
    signingOut?: boolean;
    wallpaperUrl?: string | null;
    onOpenApp: (app: string, title: string, payload?: unknown, multi?: boolean) => void;
    onRestoreWindow?: (id: string) => void;
    onMinimizeWindow?: (id: string) => void;
    onMinimizeAll?: () => void;
    onFocusWindow?: (id: string) => void;
    onOpenPalette: () => void;
    onOpenControl: () => void;
    onOpenShortcuts: () => void;
    onChromeChange: (choice: ChromeChoice) => void;
    onSignOut: () => void;
    monitorSlot: Snippet;
    windowsSlot?: Snippet;
    widgetsSlot?: Snippet;
  } = $props();

  let internalNow = $state(new Date());
  let localHome = $state(false);
  let libraryOpen = $state(false);
  let libraryQuery = $state("");

  let activeNow = $derived(clockNow ?? internalNow);
  let statusTime = $derived(
    activeNow.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
  );
  let activeWindows = $derived(openWindows.filter((win) => !win.minimized));
  let minimizedWindows = $derived(openWindows.filter((win) => win.minimized));
  let openAppSet = $derived(new Set(openWindows.map((win) => win.app)));
  let showingWindows = $derived(authenticated && activeWindows.length > 0 && !localHome);

  let filteredLibrary = $derived.by(() => {
    const q = libraryQuery.trim().toLowerCase();
    if (!q) return dockApps;
    return dockApps.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.label.toLowerCase().includes(q) ||
        item.app.toLowerCase().includes(q),
    );
  });

  let backgroundImage = $derived(
    wallpaperUrl
      ? `url("${wallpaperUrl}"), linear-gradient(155deg, #1d4ed8 0%, #6d28d9 48%, #0f172a 100%)`
      : "linear-gradient(155deg, #1d4ed8 0%, #6d28d9 48%, #0f172a 100%)",
  );

  $effect(() => {
    if (activeWindows.length === 0) {
      localHome = false;
    }
  });

  onMount(() => {
    if (clockNow) return;
    const timer = setInterval(() => {
      internalNow = new Date();
    }, 30_000);
    return () => clearInterval(timer);
  });

  function launchApp(item: DockAppDef) {
    localHome = false;
    libraryOpen = false;
    onOpenApp(item.app, item.title, item.payload, item.multi);
  }

  function goHome() {
    libraryOpen = false;
    if (onMinimizeAll) {
      onMinimizeAll();
      return;
    }
    if (onMinimizeWindow && activeWindows.length > 0) {
      for (const win of activeWindows) {
        onMinimizeWindow(win.id);
      }
      return;
    }
    localHome = true;
  }

  function restoreAndShow(id: string) {
    localHome = false;
    libraryOpen = false;
    onRestoreWindow?.(id);
  }

  function handleChromeSelect(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (isChromeChoice(value)) {
      onChromeChange(value);
    }
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && libraryOpen) {
      event.preventDefault();
      libraryOpen = false;
    }
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div
  class="ios-shell"
  class:signed-out={!authenticated}
  style:background-image={backgroundImage}
  data-shell-view={showingWindows ? "sheet" : "home"}
>
  <header class="workspace-header ios-status-bar">
    <div class="ios-status-left">
      <time class="header-clock ios-time" datetime={activeNow.toISOString()}>{statusTime}</time>
      <span class="ios-brand-pill">
        <img src="/icon.svg" alt="" class="ios-brand-mark" width="16" height="16" />
        <span class="ios-brand-name">MSO</span>
      </span>
      {#if authenticated && showingWindows}
        <span class="header-subtitle ios-active-title">{focusedTitle}</span>
      {/if}
    </div>

    <div class="session-actions ios-status-actions">
      <button type="button" onclick={onOpenPalette}>Commands</button>
      <button type="button" onclick={onOpenControl}>Controls</button>
      <button type="button" onclick={onOpenShortcuts}>Shortcuts</button>
      <select aria-label="Shell chrome" value={chromeChoice} onchange={handleChromeSelect}>
        <option value="auto">Auto ({resolvedChrome})</option>
        {#each CHROME_PROFILES as profile (profile.id)}
          <option value={profile.id}>{profile.label}</option>
        {/each}
      </select>
      {#if authenticated}
        {#if role}
          <span class="role-badge">{role}</span>
        {/if}
        <button type="button" disabled={signingOut} onclick={onSignOut}>
          {signingOut ? "Signing out..." : "Sign out"}
        </button>
      {/if}
    </div>
  </header>

  <main id="main-content" tabindex="-1" data-shell={resolvedChrome} class="ios-main">
    <div class="ios-home-stage" hidden={showingWindows}>
      <div class="ios-widget-surface" class:ios-login-wrap={!authenticated}>
        {@render monitorSlot()}
      </div>

      {#if authenticated}
        {#if widgetsSlot}
          <div class="ios-extra-widgets">
            {@render widgetsSlot()}
          </div>
        {/if}

        <section class="ios-grid-section" aria-label="Home screen apps">
          <div class="ios-app-grid">
            {#each dockApps as item (item.app)}
              {@const visual = resolveAppIcon(item.app, "ios")}
              <button
                type="button"
                class="ios-app-tile"
                aria-label={item.label}
                title={item.title}
                onclick={() => launchApp(item)}
              >
                <span class="ios-squircle" style:background={visual.gradient} aria-hidden="true">
                  {#if visual.image}
                    <img src={visual.image} alt="" loading="lazy" width="56" height="56" />
                  {:else}
                    <span class="ios-squircle-mono">{visual.monogram}</span>
                  {/if}
                </span>
                <span class="ios-app-label">{item.title}</span>
                {#if openAppSet.has(item.app)}
                  <span class="ios-app-dot" aria-hidden="true"></span>
                {/if}
              </button>
            {/each}
          </div>
        </section>

        <div class="ios-home-pills">
          <button type="button" class="ios-glass-pill" onclick={onOpenPalette}>
            <svg class="ios-pill-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="8.75" cy="8.75" r="5.5" stroke="currentColor" stroke-width="1.8" />
              <path d="M13 13L17 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            </svg>
            <span>Search</span>
          </button>
          <button
            type="button"
            class="ios-glass-pill"
            aria-expanded={libraryOpen}
            aria-controls="ios-app-library"
            onclick={() => { libraryOpen = !libraryOpen; }}
          >
            <span>App Library</span>
          </button>
        </div>
      {/if}
    </div>

    {#if showingWindows}
      <div class="ios-sheet-stage" data-open-windows={activeWindows.length}>
        <div class="ios-sheet-bar">
          <button type="button" class="ios-home-btn" onclick={goHome}>
            Home
          </button>
          <div class="ios-sheet-tabs" role="tablist" aria-label="Open sheets">
            {#each activeWindows as win (win.id)}
              <button
                type="button"
                role="tab"
                class="ios-sheet-tab"
                aria-selected={win.title === focusedTitle}
                onclick={() => onFocusWindow?.(win.id)}
              >
                {win.title}
              </button>
            {/each}
          </div>
        </div>

        {#if windowsSlot}
          <div class="window-area ios-sheet-windows">
            {@render windowsSlot()}
          </div>
        {/if}
      </div>
    {/if}
  </main>

  {#if authenticated}
    <div class="ios-dock-wrap">
      <nav class="app-dock ios-dock" aria-label="Workspace apps">
        {#each dockApps as item (item.app)}
          {@const visual = resolveAppIcon(item.app, "ios")}
          <button
            type="button"
            class="dock-item ios-dock-item"
            aria-label={item.label}
            title={item.title}
            onclick={() => launchApp(item)}
          >
            <span class="dock-icon-box ios-dock-icon" style:background={visual.gradient} aria-hidden="true">
              {#if visual.image}
                <img src={visual.image} alt="" loading="lazy" width="42" height="42" />
              {:else}
                <span class="dock-icon-mono">{visual.monogram}</span>
              {/if}
            </span>
            <span class="dock-label ios-dock-label" aria-hidden="true">{item.title}</span>
            {#if openAppSet.has(item.app)}
              <span class="dock-running-dot" aria-hidden="true"></span>
            {/if}
          </button>
        {/each}

        {#each minimizedWindows as win (win.id)}
          <button
            type="button"
            class="minimized-chip ios-min-chip"
            onclick={() => restoreAndShow(win.id)}
          >
            Restore {win.title}
          </button>
        {/each}

        <button
          type="button"
          class="dock-item ios-dock-item ios-all-apps-btn"
          aria-expanded={libraryOpen}
          aria-controls="ios-app-library"
          onclick={() => { libraryOpen = !libraryOpen; }}
        >
          <span class="dock-icon-box ios-dock-icon ios-all-apps-glyph" aria-hidden="true">
            <span class="ios-dots-grid">
              <span></span><span></span><span></span><span></span>
            </span>
          </span>
          <span class="dock-label ios-dock-label">All Apps</span>
        </button>
      </nav>

      <button
        type="button"
        class="ios-home-indicator"
        aria-label="Return to Home screen"
        onclick={goHome}
      >
        <span class="ios-home-pill" aria-hidden="true"></span>
      </button>
    </div>
  {/if}

  {#if libraryOpen && authenticated}
    <div class="ios-library-backdrop" role="presentation" onclick={() => { libraryOpen = false; }}>
      <div
        id="ios-app-library"
        class="ios-library-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ios-library-title"
        tabindex="-1"
        onclick={(e) => e.stopPropagation()}
        onkeydown={handleWindowKeydown}
      >
        <header class="ios-library-head">
          <h2 id="ios-library-title">App Library</h2>
          <button type="button" class="ios-library-close" onclick={() => { libraryOpen = false; }}>
            Done
          </button>
        </header>

        <div class="ios-library-search-wrap">
          <input
            type="search"
            class="ios-library-search"
            aria-label="Filter App Library"
            placeholder="Search App Library"
            bind:value={libraryQuery}
          />
        </div>

        <div class="ios-library-grid">
          {#each filteredLibrary as item (item.app)}
            {@const visual = resolveAppIcon(item.app, "ios")}
            <button
              type="button"
              class="ios-library-tile"
              aria-label={item.label}
              onclick={() => launchApp(item)}
            >
              <span class="ios-squircle" style:background={visual.gradient} aria-hidden="true">
                {#if visual.image}
                  <img src={visual.image} alt="" loading="lazy" width="52" height="52" />
                {:else}
                  <span class="ios-squircle-mono">{visual.monogram}</span>
                {/if}
              </span>
              <span class="ios-library-label">{item.title}</span>
            </button>
          {/each}
          {#if filteredLibrary.length === 0}
            <p class="ios-library-empty">No matching apps</p>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .ios-shell {
    position: relative;
    min-height: 100dvh;
    width: 100%;
    max-width: 100%;
    display: flex;
    flex-direction: column;
    overflow-x: clip;
    background-size: cover;
    background-position: center;
    background-attachment: fixed;
    padding-top: env(safe-area-inset-top);
    padding-right: env(safe-area-inset-right);
    padding-bottom: env(safe-area-inset-bottom);
    padding-left: env(safe-area-inset-left);
  }

  .ios-shell .ios-status-bar.workspace-header {
    position: sticky;
    top: 0;
    z-index: 40;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    flex-wrap: wrap;
    padding: 6px 10px;
    background: rgba(15, 18, 28, 0.72);
    border-bottom: 1px solid rgba(255, 255, 255, 0.16);
    color: #f8fafc;
    backdrop-filter: blur(22px) saturate(180%);
    -webkit-backdrop-filter: blur(22px) saturate(180%);
    min-width: 0;
    max-width: 100%;
  }

  .ios-status-left {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    max-width: 100%;
    flex-wrap: wrap;
  }

  .ios-time {
    font-size: 0.875rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
    color: #ffffff;
    padding: 0 2px;
  }

  .ios-brand-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.14);
    border: 1px solid rgba(255, 255, 255, 0.18);
    font-size: 0.75rem;
    font-weight: 600;
    color: #ffffff;
  }

  .ios-brand-mark {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .ios-active-title {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ios-status-actions {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
    min-width: 0;
    max-width: 100%;
  }

  .ios-shell .ios-status-bar button,
  .ios-shell .ios-status-bar select {
    min-height: 30px;
    padding: 4px 8px;
    font-size: 0.75rem;
    color: #f8fafc;
    background: rgba(255, 255, 255, 0.14);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 999px;
    max-width: 100%;
    min-width: 0;
  }

  .ios-shell .ios-status-bar select option {
    background: #141724;
    color: #f8fafc;
  }

  .ios-main {
    flex: 1 0 auto;
    width: 100%;
    max-width: 56rem;
    margin: 0 auto;
    padding: 12px clamp(8px, 3vw, 20px) 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
  }

  .ios-shell.signed-out .ios-main {
    justify-content: center;
    align-items: center;
    min-height: calc(100dvh - 64px);
  }

  .ios-home-stage {
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: 100%;
    min-width: 0;
  }

  .ios-home-stage[hidden] {
    display: none;
  }

  .ios-widget-surface {
    width: 100%;
    min-width: 0;
    border-radius: 22px;
    overflow: hidden;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
  }

  .ios-widget-surface.ios-login-wrap {
    box-shadow: none;
    overflow: visible;
    display: flex;
    justify-content: center;
  }

  .ios-extra-widgets {
    width: 100%;
    min-width: 0;
  }

  .ios-grid-section {
    background: rgba(12, 16, 28, 0.34);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 24px;
    padding: 12px 8px;
    backdrop-filter: blur(18px) saturate(160%);
    -webkit-backdrop-filter: blur(18px) saturate(160%);
    min-width: 0;
    max-width: 100%;
  }

  .ios-app-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px 6px;
    width: 100%;
    min-width: 0;
  }

  @media (min-width: 48rem) {
    .ios-app-grid {
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 16px 12px;
    }
  }

  .ios-app-tile {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 4px;
    width: 100%;
    min-width: 0;
    min-height: 0;
    padding: 4px 2px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 16px;
    color: #ffffff;
    text-align: center;
  }

  .ios-app-tile:hover {
    background: rgba(255, 255, 255, 0.14);
  }

  .ios-app-tile:active .ios-squircle {
    transform: scale(0.92);
  }

  .ios-squircle {
    width: min(56px, 100%);
    max-width: 56px;
    aspect-ratio: 1;
    border-radius: 22.5%;
    overflow: hidden;
    display: grid;
    place-items: center;
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.28);
    transition: transform 140ms ease;
    flex-shrink: 0;
  }

  .ios-squircle img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .ios-squircle-mono {
    font-size: 0.875rem;
    font-weight: 700;
    color: #ffffff;
    letter-spacing: 0.02em;
  }

  .ios-app-label {
    display: block;
    width: 100%;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.72rem;
    font-weight: 500;
    line-height: 1.25;
    color: #ffffff;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.85);
  }

  .ios-app-dot {
    width: 5px;
    height: 5px;
    border-radius: 999px;
    background: #ffffff;
    box-shadow: 0 0 6px rgba(255, 255, 255, 0.9);
  }

  .ios-home-pills {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 2px 0 4px;
    min-width: 0;
  }

  .ios-glass-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 36px;
    padding: 6px 14px;
    border-radius: 999px;
    background: rgba(15, 20, 34, 0.62);
    border: 1px solid rgba(255, 255, 255, 0.24);
    color: #ffffff;
    font-size: 0.8125rem;
    font-weight: 500;
    backdrop-filter: blur(18px) saturate(180%);
    -webkit-backdrop-filter: blur(18px) saturate(180%);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.22);
    max-width: 100%;
  }

  .ios-glass-pill:hover {
    background: rgba(25, 32, 52, 0.78);
  }

  .ios-pill-icon {
    width: 15px;
    height: 15px;
    flex-shrink: 0;
  }

  .ios-sheet-stage {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
    min-width: 0;
  }

  .ios-sheet-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 8px 10px;
    border-radius: 18px;
    background: rgba(15, 20, 34, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.2);
    backdrop-filter: blur(20px) saturate(170%);
    -webkit-backdrop-filter: blur(20px) saturate(170%);
    min-width: 0;
  }

  .ios-home-btn {
    min-height: 34px;
    padding: 5px 12px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.16);
    border: 1px solid rgba(255, 255, 255, 0.24);
    color: #ffffff;
    font-size: 0.8125rem;
    font-weight: 600;
    flex-shrink: 0;
  }

  .ios-home-btn:hover {
    background: rgba(255, 255, 255, 0.26);
  }

  .ios-sheet-tabs {
    display: flex;
    align-items: center;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: none;
    min-width: 0;
    flex: 1 1 auto;
  }

  .ios-sheet-tabs::-webkit-scrollbar {
    display: none;
  }

  .ios-sheet-tab {
    flex: 0 0 auto;
    min-height: 32px;
    padding: 4px 10px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.16);
    color: rgba(248, 250, 252, 0.86);
    font-size: 0.78rem;
  }

  .ios-sheet-tab[aria-selected="true"] {
    background: #ffffff;
    color: #0f172a;
    border-color: #ffffff;
    font-weight: 600;
  }

  .ios-sheet-windows {
    width: 100%;
    min-width: 0;
  }

  .ios-dock-wrap {
    position: sticky;
    bottom: 0;
    z-index: 35;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 6px 8px max(6px, env(safe-area-inset-bottom));
    pointer-events: none;
    width: 100%;
    max-width: 100%;
  }

  .ios-shell .ios-dock.app-dock {
    pointer-events: auto;
    display: flex;
    align-items: flex-end;
    gap: 6px;
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    width: auto;
    max-width: min(100%, 44rem);
    padding: 8px 10px;
    border-radius: 26px;
    background: rgba(18, 22, 34, 0.68);
    border: 1px solid rgba(255, 255, 255, 0.24);
    box-shadow: 0 14px 36px rgba(0, 0, 0, 0.36);
    backdrop-filter: blur(26px) saturate(180%);
    -webkit-backdrop-filter: blur(26px) saturate(180%);
  }

  .ios-shell .ios-dock.app-dock::-webkit-scrollbar {
    display: none;
  }

  .ios-dock-item {
    min-width: 48px;
    min-height: 48px;
    padding: 4px;
    border-radius: 14px;
    color: #ffffff;
  }

  .ios-dock-icon {
    width: 40px;
    height: 40px;
    border-radius: 22.5%;
  }

  .ios-dock-label {
    font-size: 0.65rem;
    max-width: 56px;
    color: #ffffff;
  }

  .ios-min-chip {
    background: rgba(255, 255, 255, 0.16);
    color: #ffffff;
    border: 1px dashed rgba(255, 255, 255, 0.4);
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 0.72rem;
    white-space: nowrap;
  }

  .ios-all-apps-glyph {
    background: rgba(255, 255, 255, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.25);
  }

  .ios-dots-grid {
    display: grid;
    grid-template-columns: repeat(2, 6px);
    gap: 4px;
  }

  .ios-dots-grid span {
    width: 6px;
    height: 6px;
    border-radius: 2px;
    background: #ffffff;
  }

  .ios-home-indicator {
    pointer-events: auto;
    display: grid;
    place-items: center;
    min-height: 22px;
    min-width: 120px;
    padding: 4px 12px;
    background: transparent;
    border: 0;
    border-radius: 999px;
  }

  .ios-home-pill {
    width: 108px;
    height: 4px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.85);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45);
  }

  .ios-library-backdrop {
    position: fixed;
    inset: 0;
    z-index: 55;
    display: grid;
    place-items: end center;
    padding: 12px;
    background: rgba(6, 10, 20, 0.55);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }

  .ios-library-sheet {
    width: min(36rem, 100%);
    max-height: 82dvh;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    border-radius: 24px;
    background: var(--panel-solid);
    color: var(--text);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-win);
    overflow: hidden;
  }

  .ios-library-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .ios-library-close {
    min-height: 36px;
    padding: 4px 12px;
    border-radius: 999px;
  }

  .ios-library-search-wrap {
    min-width: 0;
  }

  .ios-library-search {
    width: 100%;
    border-radius: 999px;
    padding: 8px 14px;
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
  }

  .ios-library-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px 6px;
    overflow-y: auto;
    padding: 4px 2px;
    min-width: 0;
  }

  .ios-library-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 6px 2px;
    min-width: 0;
    min-height: 0;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 14px;
    color: var(--text);
  }

  .ios-library-tile:hover {
    background: var(--surface);
    border-color: var(--border);
  }

  .ios-library-label {
    width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.72rem;
    text-align: center;
    color: var(--text);
  }

  .ios-library-empty {
    grid-column: 1 / -1;
    margin: 16px 0;
    text-align: center;
    font-size: 0.875rem;
    color: var(--muted);
  }
</style>
