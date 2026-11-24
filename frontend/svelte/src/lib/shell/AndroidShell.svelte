<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import MobileAppBar from "./MobileAppBar.svelte";
  import { resolveAppIcon } from "./app-icons.ts";
  import type { MobileNavSpec } from "./shell-design.ts";
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
    focusedWinId = null,
    mobileNav = null,
    chromeChoice,
    resolvedChrome,
    dockApps,
    openWindows = [],
    clockNow,
    signingOut = false,
    wallpaperUrl = "/wallpapers/material.webp",
    onOpenApp,
    onRestoreWindow,
    onMinimizeWindow,
    onMinimizeAll,
    onCloseWindow,
    onFocusWindow,
    onOpenPalette,
    onOpenControl,
    onOpenShortcuts,
    onChromeChange,
    onSignOut,
    onCycleWallpaper,
    monitorSlot,
    windowsSlot,
    widgetsSlot,
  }: {
    authenticated?: boolean;
    role?: string | null;
    focusedTitle?: string;
    focusedWinId?: string | null;
    mobileNav?: MobileNavSpec | null;
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
    onCloseWindow?: (id: string) => void;
    onFocusWindow?: (id: string) => void;
    onOpenPalette: () => void;
    onOpenControl: () => void;
    onOpenShortcuts: () => void;
    onChromeChange: (choice: ChromeChoice) => void;
    onSignOut: () => void;
    onCycleWallpaper?: () => void;
    monitorSlot: Snippet;
    windowsSlot?: Snippet;
    widgetsSlot?: Snippet;
  } = $props();

  let internalNow = $state(new Date());
  let localHome = $state(false);
  let shadeOpen = $state(false);
  let drawerOpen = $state(false);
  let recentsOpen = $state(false);
  let drawerQuery = $state("");

  let activeNow = $derived(clockNow ?? internalNow);
  let statusTime = $derived(
    activeNow.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
  );
  let atAGlanceDate = $derived(
    activeNow.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }),
  );
  let activeWindows = $derived(openWindows.filter((win) => !win.minimized));
  let minimizedWindows = $derived(openWindows.filter((win) => win.minimized));
  let openAppSet = $derived(new Set(openWindows.map((win) => win.app)));
  let showingWindows = $derived(authenticated && activeWindows.length > 0 && !localHome);

  let filteredDrawerApps = $derived.by(() => {
    const q = drawerQuery.trim().toLowerCase();
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
      ? `url("${wallpaperUrl}"), linear-gradient(155deg, #0f766e 0%, #1d4ed8 55%, #111827 100%)`
      : "linear-gradient(155deg, #0f766e 0%, #1d4ed8 55%, #111827 100%)",
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
    drawerOpen = false;
    shadeOpen = false;
    recentsOpen = false;
    onOpenApp(item.app, item.title, item.payload, item.multi);
  }

  function goHome() {
    drawerOpen = false;
    shadeOpen = false;
    recentsOpen = false;
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

  function handleBack() {
    if (shadeOpen) {
      shadeOpen = false;
      return;
    }
    if (drawerOpen) {
      drawerOpen = false;
      return;
    }
    if (recentsOpen) {
      recentsOpen = false;
      return;
    }
    if (showingWindows && mobileNav?.onBack) {
      mobileNav.onBack();
      return;
    }
    goHome();
  }

  function resumeWindow(win: WindowState) {
    localHome = false;
    recentsOpen = false;
    drawerOpen = false;
    shadeOpen = false;
    if (win.minimized) {
      onRestoreWindow?.(win.id);
    } else {
      onFocusWindow?.(win.id);
    }
  }

  function handleChromeSelect(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (isChromeChoice(value)) {
      onChromeChange(value);
    }
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    if (shadeOpen) {
      event.preventDefault();
      shadeOpen = false;
    } else if (drawerOpen) {
      event.preventDefault();
      drawerOpen = false;
    } else if (recentsOpen) {
      event.preventDefault();
      recentsOpen = false;
    }
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div
  class="android-shell"
  class:signed-out={!authenticated}
  style:background-image={backgroundImage}
  data-shell-view={showingWindows ? "app" : "home"}
>
  <header class="workspace-header android-status-bar">
    <div class="android-status-left">
      <time class="header-clock android-time" datetime={activeNow.toISOString()}>{statusTime}</time>
      <button
        type="button"
        class="android-shade-trigger"
        aria-expanded={shadeOpen}
        aria-controls="android-shade-panel"
        onclick={() => { shadeOpen = !shadeOpen; drawerOpen = false; recentsOpen = false; }}
      >
        Shade{openWindows.length > 0 ? ` (${openWindows.length})` : ""}
      </button>
    </div>

    <div class="session-actions android-status-actions">
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

  {#if shadeOpen}
    <div class="android-overlay-scrim" role="presentation" onclick={() => { shadeOpen = false; }}>
      <div
        id="android-shade-panel"
        class="android-shade"
        role="dialog"
        aria-modal="true"
        aria-labelledby="android-shade-title"
        tabindex="-1"
        onclick={(e) => e.stopPropagation()}
        onkeydown={handleWindowKeydown}
      >
        <header class="android-shade-head">
          <div>
            <h2 id="android-shade-title">Quick Settings</h2>
            <span class="android-shade-date">{atAGlanceDate} · {statusTime}</span>
          </div>
          <button type="button" class="android-shade-close" onclick={() => { shadeOpen = false; }}>
            Close
          </button>
        </header>

        <div class="android-qs-grid">
          <button
            type="button"
            class="android-qs-tile"
            onclick={() => { shadeOpen = false; onOpenControl(); }}
          >
            <span class="android-qs-title">Controls</span>
            <span class="android-qs-sub">Theme and lock</span>
          </button>
          <button
            type="button"
            class="android-qs-tile"
            onclick={() => { shadeOpen = false; onOpenPalette(); }}
          >
            <span class="android-qs-title">Commands</span>
            <span class="android-qs-sub">Search workspace</span>
          </button>
          <button
            type="button"
            class="android-qs-tile"
            onclick={() => { shadeOpen = false; onOpenShortcuts(); }}
          >
            <span class="android-qs-title">Shortcuts</span>
            <span class="android-qs-sub">Keyboard map</span>
          </button>
          {#if authenticated}
            <button
              type="button"
              class="android-qs-tile"
              onclick={() => { shadeOpen = false; onOpenApp("settings", "Settings"); }}
            >
              <span class="android-qs-title">Settings</span>
              <span class="android-qs-sub">Host options</span>
            </button>
          {/if}
          {#if onCycleWallpaper}
            <button
              type="button"
              class="android-qs-tile"
              onclick={() => { onCycleWallpaper(); }}
            >
              <span class="android-qs-title">Wallpaper</span>
              <span class="android-qs-sub">Cycle backdrop</span>
            </button>
          {/if}
        </div>

        <div class="android-notif-section">
          <h3>Notifications</h3>
          {#if openWindows.length === 0}
            <p class="android-notif-empty">No active notifications</p>
          {:else}
            <ul class="android-notif-list" role="list">
              {#each openWindows as win (win.id)}
                <li class="android-notif-row">
                  <div class="android-notif-copy">
                    <span class="android-notif-name">{win.title}</span>
                    <span class="android-notif-meta">{win.minimized ? "Minimized" : "Running"}</span>
                  </div>
                  <button type="button" class="android-notif-btn" onclick={() => resumeWindow(win)}>
                    Open
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>

        <button
          type="button"
          class="android-handle-btn"
          aria-label="Close notification shade"
          onclick={() => { shadeOpen = false; }}
        >
          <span class="android-handle-bar" aria-hidden="true"></span>
        </button>
      </div>
    </div>
  {/if}

  <main id="main-content" tabindex="-1" data-shell={resolvedChrome} class="android-main">
    <div class="android-home-stage" hidden={showingWindows}>
      {#if authenticated}
        <section class="android-glance" aria-label="At a Glance">
          <div class="android-glance-date">{atAGlanceDate}</div>
          <div class="android-glance-row">
            <time class="android-glance-clock" datetime={activeNow.toISOString()}>{statusTime}</time>
            <span class="android-glance-meta">
              {openWindows.length === 0
                ? "All apps ready"
                : openWindows.length === 1
                  ? "1 open app"
                  : `${openWindows.length} open apps`}
            </span>
          </div>
        </section>
      {/if}

      <div class="android-monitor-card" class:android-login-wrap={!authenticated}>
        {@render monitorSlot()}
      </div>

      {#if authenticated}
        {#if widgetsSlot}
          <div class="android-extra-widgets">
            {@render widgetsSlot()}
          </div>
        {/if}

        <button type="button" class="android-search-pill" onclick={onOpenPalette}>
          <svg class="android-search-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="8.75" cy="8.75" r="5.5" stroke="currentColor" stroke-width="1.8" />
            <path d="M13 13L17 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
          <span class="android-search-text">Search apps and commands</span>
        </button>

        <section class="android-grid-card" aria-label="Home screen apps">
          <div class="android-app-grid">
            {#each dockApps as item (item.app)}
              {@const visual = resolveAppIcon(item.app, "android")}
              <button
                type="button"
                class="android-app-cell"
                aria-label={item.label}
                title={item.title}
                onclick={() => launchApp(item)}
              >
                <span class="android-circle-icon" style:background={visual.gradient} aria-hidden="true">
                  {#if visual.image}
                    <img src={visual.image} alt="" loading="lazy" width="52" height="52" />
                  {:else}
                    <span class="android-circle-mono">{visual.monogram}</span>
                  {/if}
                </span>
                <span class="android-app-label">{item.title}</span>
                {#if openAppSet.has(item.app)}
                  <span class="android-running-pill" aria-hidden="true"></span>
                {/if}
              </button>
            {/each}
          </div>
        </section>

        <button
          type="button"
          class="android-drawer-trigger"
          aria-expanded={drawerOpen}
          aria-controls="android-app-drawer"
          onclick={() => { drawerOpen = true; shadeOpen = false; recentsOpen = false; }}
        >
          <span class="android-drawer-grabber" aria-hidden="true"></span>
          <span>All apps</span>
        </button>
      {/if}
    </div>

    {#if showingWindows}
      <div class="android-window-stage" data-open-windows={activeWindows.length}>
        <MobileAppBar
          variant="android"
          appTitle={focusedTitle}
          {mobileNav}
          onBackHome={goHome}
          onOpenAi={() => onOpenApp("assistant", "Alfa Assistant")}
          onCloseApp={focusedWinId && onCloseWindow ? () => onCloseWindow(focusedWinId) : undefined}
        />

        {#if windowsSlot}
          <div class="window-area android-window-list">
            {@render windowsSlot()}
          </div>
        {/if}
      </div>
    {/if}
  </main>

  {#if authenticated}
    <div class="android-bottom-chrome">
      <nav class="app-dock android-dock" aria-label="Workspace apps">
        {#each dockApps as item (item.app)}
          {@const visual = resolveAppIcon(item.app, "android")}
          <button
            type="button"
            class="dock-item android-dock-item"
            aria-label={item.label}
            title={item.title}
            onclick={() => launchApp(item)}
          >
            <span class="dock-icon-box android-dock-icon" style:background={visual.gradient} aria-hidden="true">
              {#if visual.image}
                <img src={visual.image} alt="" loading="lazy" width="38" height="38" />
              {:else}
                <span class="dock-icon-mono">{visual.monogram}</span>
              {/if}
            </span>
            <span class="dock-label android-dock-label" aria-hidden="true">{item.title}</span>
            {#if openAppSet.has(item.app)}
              <span class="dock-running-dot" aria-hidden="true"></span>
            {/if}
          </button>
        {/each}

        {#each minimizedWindows as win (win.id)}
          <button
            type="button"
            class="minimized-chip android-min-chip"
            onclick={() => resumeWindow(win)}
          >
            Restore {win.title}
          </button>
        {/each}
      </nav>

      <div class="android-sys-nav" role="group" aria-label="System navigation">
        <button type="button" class="android-nav-btn" aria-label="Back" onclick={handleBack}>
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M12.5 4.5L7 10L12.5 15.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <button type="button" class="android-nav-btn" aria-label="Home" onclick={goHome}>
          <span class="android-nav-circle" aria-hidden="true"></span>
        </button>
        <button
          type="button"
          class="android-nav-btn"
          aria-label="Recents"
          aria-expanded={recentsOpen}
          onclick={() => { recentsOpen = !recentsOpen; drawerOpen = false; shadeOpen = false; }}
        >
          <span class="android-nav-square" aria-hidden="true"></span>
        </button>
      </div>
    </div>
  {/if}

  {#if drawerOpen && authenticated}
    <div class="android-overlay-scrim android-drawer-scrim" role="presentation" onclick={() => { drawerOpen = false; }}>
      <div
        id="android-app-drawer"
        class="android-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="android-drawer-title"
        tabindex="-1"
        onclick={(e) => e.stopPropagation()}
        onkeydown={handleWindowKeydown}
      >
        <button
          type="button"
          class="android-handle-btn"
          aria-label="Close app drawer"
          onclick={() => { drawerOpen = false; }}
        >
          <span class="android-handle-bar" aria-hidden="true"></span>
        </button>

        <div class="android-drawer-head">
          <button type="button" class="android-drawer-back" onclick={() => { drawerOpen = false; }}>
            Home
          </button>
          <h2 id="android-drawer-title">All apps</h2>
        </div>

        <div class="android-drawer-search-wrap">
          <input
            type="search"
            class="android-drawer-search"
            aria-label="Search apps"
            placeholder="Search apps"
            bind:value={drawerQuery}
          />
        </div>

        <div class="android-drawer-grid">
          {#each filteredDrawerApps as item (item.app)}
            {@const visual = resolveAppIcon(item.app, "android")}
            <button
              type="button"
              class="android-drawer-cell"
              aria-label={item.label}
              onclick={() => launchApp(item)}
            >
              <span class="android-circle-icon" style:background={visual.gradient} aria-hidden="true">
                {#if visual.image}
                  <img src={visual.image} alt="" loading="lazy" width="52" height="52" />
                {:else}
                  <span class="android-circle-mono">{visual.monogram}</span>
                {/if}
              </span>
              <span class="android-drawer-label">{item.title}</span>
            </button>
          {/each}
          {#if filteredDrawerApps.length === 0}
            <p class="android-notif-empty">No matching apps</p>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  {#if recentsOpen && authenticated}
    <div class="android-overlay-scrim" role="presentation" onclick={() => { recentsOpen = false; }}>
      <div
        class="android-recents"
        role="dialog"
        aria-modal="true"
        aria-labelledby="android-recents-title"
        tabindex="-1"
        onclick={(e) => e.stopPropagation()}
        onkeydown={handleWindowKeydown}
      >
        <header class="android-shade-head">
          <h2 id="android-recents-title">Recent apps</h2>
          <button type="button" class="android-shade-close" onclick={() => { recentsOpen = false; }}>
            Close
          </button>
        </header>

        {#if openWindows.length === 0}
          <p class="android-notif-empty">No open apps</p>
        {:else}
          <ul class="android-recents-list" role="list">
            {#each openWindows as win (win.id)}
              {@const visual = resolveAppIcon(win.app, "android")}
              <li class="android-recent-card">
                <button type="button" class="android-recent-open" onclick={() => resumeWindow(win)}>
                  <span class="android-recent-icon" style:background={visual.gradient} aria-hidden="true">
                    {#if visual.image}
                      <img src={visual.image} alt="" width="28" height="28" />
                    {:else}
                      <span>{visual.monogram}</span>
                    {/if}
                  </span>
                  <span class="android-recent-copy">
                    <span class="android-recent-title">{win.title}</span>
                    <span class="android-recent-state">{win.minimized ? "Minimized" : "Active"}</span>
                  </span>
                </button>
                {#if onCloseWindow}
                  <button
                    type="button"
                    class="android-recent-close"
                    aria-label={`Close ${win.title}`}
                    onclick={() => onCloseWindow(win.id)}
                  >
                    Close
                  </button>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .android-shell {
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

  .android-shell .android-status-bar.workspace-header {
    position: sticky;
    top: 0;
    z-index: 40;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    flex-wrap: wrap;
    padding: 6px 10px;
    background: rgba(14, 20, 28, 0.78);
    border-bottom: 1px solid rgba(255, 255, 255, 0.14);
    color: #f8fafc;
    -webkit-backdrop-filter: blur(20px);
    backdrop-filter: blur(20px);
    min-width: 0;
    max-width: 100%;
  }

  .android-status-left {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex-wrap: wrap;
  }

  .android-time {
    font-size: 0.875rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: #ffffff;
  }

  .android-status-actions {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
    min-width: 0;
    max-width: 100%;
  }

  .android-shell .android-status-bar button,
  .android-shell .android-status-bar select {
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

  .android-shell .android-status-bar select option {
    background: #141a24;
    color: #f8fafc;
  }

  .android-shade-trigger {
    font-weight: 600;
  }

  .android-main {
    flex: 1 0 auto;
    width: 100%;
    max-width: 54rem;
    margin: 0 auto;
    padding: 12px clamp(8px, 3vw, 20px) 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }

  .android-shell.signed-out .android-main {
    justify-content: center;
    align-items: center;
    min-height: calc(100dvh - 64px);
  }

  .android-home-stage {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    min-width: 0;
  }

  .android-home-stage[hidden] {
    display: none;
  }

  .android-glance {
    background: rgba(12, 18, 28, 0.56);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 24px;
    padding: 14px 16px;
    color: #ffffff;
    -webkit-backdrop-filter: blur(18px);
    backdrop-filter: blur(18px);
    min-width: 0;
  }

  .android-glance-date {
    font-size: 0.875rem;
    font-weight: 500;
    color: rgba(241, 245, 249, 0.9);
  }

  .android-glance-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 2px;
  }

  .android-glance-clock {
    font-size: 1.75rem;
    font-weight: 700;
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
    color: #ffffff;
  }

  .android-glance-meta {
    font-size: 0.78rem;
    color: rgba(226, 232, 240, 0.88);
    padding: 2px 10px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.14);
  }

  .android-monitor-card {
    width: 100%;
    min-width: 0;
    border-radius: 24px;
    overflow: hidden;
  }

  .android-monitor-card.android-login-wrap {
    overflow: visible;
    display: flex;
    justify-content: center;
  }

  .android-extra-widgets {
    width: 100%;
    min-width: 0;
  }

  .android-search-pill {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 44px;
    padding: 8px 16px;
    border-radius: 999px;
    background: var(--panel-solid);
    color: var(--text);
    border: 1px solid var(--border);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.22);
    text-align: left;
    min-width: 0;
  }

  .android-search-pill:hover {
    border-color: var(--accent);
  }

  .android-search-icon {
    width: 18px;
    height: 18px;
    color: var(--muted);
    flex-shrink: 0;
  }

  .android-search-text {
    font-size: 0.875rem;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .android-grid-card {
    background: rgba(12, 18, 28, 0.42);
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 26px;
    padding: 12px 8px;
    -webkit-backdrop-filter: blur(16px);
    backdrop-filter: blur(16px);
    min-width: 0;
    max-width: 100%;
  }

  .android-app-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px 6px;
    width: 100%;
    min-width: 0;
  }

  @media (min-width: 48rem) {
    .android-app-grid {
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 16px 12px;
    }
  }

  .android-app-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 5px;
    width: 100%;
    min-width: 0;
    min-height: 0;
    padding: 4px 2px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 18px;
    color: #ffffff;
  }

  .android-app-cell:hover {
    background: rgba(255, 255, 255, 0.14);
  }

  .android-app-cell:active .android-circle-icon {
    transform: scale(0.9);
  }

  .android-circle-icon {
    width: min(52px, 100%);
    max-width: 52px;
    aspect-ratio: 1;
    border-radius: 50%;
    overflow: hidden;
    display: grid;
    place-items: center;
    box-shadow: 0 5px 14px rgba(0, 0, 0, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.25);
    transition: transform 140ms ease;
    flex-shrink: 0;
  }

  .android-circle-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .android-circle-mono {
    font-size: 0.85rem;
    font-weight: 700;
    color: #ffffff;
  }

  .android-app-label {
    display: block;
    width: 100%;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
    font-size: 0.72rem;
    font-weight: 500;
    color: #ffffff;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.85);
  }

  .android-running-pill {
    width: 14px;
    height: 3px;
    border-radius: 999px;
    background: #ffffff;
  }

  .android-drawer-trigger {
    align-self: center;
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    min-height: 36px;
    padding: 6px 16px;
    border-radius: 999px;
    background: rgba(14, 20, 30, 0.64);
    border: 1px solid rgba(255, 255, 255, 0.22);
    color: #ffffff;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .android-drawer-grabber {
    width: 32px;
    height: 3px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.72);
  }

  .android-window-stage {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
    min-width: 0;
  }

  .android-window-list {
    width: 100%;
    min-width: 0;
  }

  .android-bottom-chrome {
    position: sticky;
    bottom: 0;
    z-index: 35;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 6px 8px max(6px, env(safe-area-inset-bottom));
    background: rgba(14, 18, 28, 0.72);
    border-top: 1px solid rgba(255, 255, 255, 0.16);
    -webkit-backdrop-filter: blur(22px);
    backdrop-filter: blur(22px);
    width: 100%;
    max-width: 100%;
  }

  .android-shell .android-dock.app-dock {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    width: auto;
    max-width: min(100%, 48rem);
    padding: 6px 10px;
    border-radius: 28px;
    background: rgba(255, 255, 255, 0.12);
    border: 1px solid rgba(255, 255, 255, 0.2);
    box-shadow: none;
  }

  .android-shell .android-dock.app-dock::-webkit-scrollbar {
    display: none;
  }

  .android-dock-item {
    min-width: 46px;
    min-height: 46px;
    padding: 4px;
    border-radius: 16px;
    color: #ffffff;
  }

  .android-dock-icon {
    width: 38px;
    height: 38px;
    border-radius: 50%;
  }

  .android-dock-label {
    font-size: 0.65rem;
    max-width: 54px;
    color: #ffffff;
  }

  .android-min-chip {
    background: rgba(255, 255, 255, 0.16);
    color: #ffffff;
    border: 1px dashed rgba(255, 255, 255, 0.4);
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 0.72rem;
    white-space: nowrap;
  }

  .android-sys-nav {
    display: flex;
    align-items: center;
    justify-content: space-around;
    width: min(22rem, 100%);
    gap: 8px;
  }

  .android-nav-btn {
    display: grid;
    place-items: center;
    min-width: 44px;
    min-height: 34px;
    padding: 4px 12px;
    background: transparent;
    border: 0;
    border-radius: 999px;
    color: #f8fafc;
  }

  .android-nav-btn:hover {
    background: rgba(255, 255, 255, 0.16);
  }

  .android-nav-btn svg {
    width: 18px;
    height: 18px;
  }

  .android-nav-circle {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid currentColor;
  }

  .android-nav-square {
    width: 13px;
    height: 13px;
    border-radius: 3px;
    border: 2px solid currentColor;
  }

  .android-overlay-scrim {
    position: fixed;
    inset: 0;
    z-index: 55;
    display: flex;
    flex-direction: column;
    align-items: center;
    background: rgba(6, 10, 18, 0.56);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
    padding: 0 8px 12px;
  }

  .android-drawer-scrim {
    justify-content: flex-end;
    padding: 12px 8px 0;
  }

  .android-shade {
    width: min(36rem, 100%);
    max-height: 85dvh;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
    border-radius: 0 0 28px 28px;
    background: var(--panel-solid);
    color: var(--text);
    border: 1px solid var(--border);
    border-top: 0;
    box-shadow: var(--shadow-win);
    overflow-y: auto;
  }

  .android-shade-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }

  .android-shade-date {
    display: block;
    font-size: 0.78rem;
    color: var(--muted);
  }

  .android-shade-close {
    min-height: 36px;
    padding: 4px 12px;
    border-radius: 999px;
  }

  .android-qs-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(8.5rem, 100%), 1fr));
    gap: 8px;
  }

  .android-qs-tile {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 10px 12px;
    border-radius: 18px;
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    text-align: left;
  }

  .android-qs-tile:hover {
    border-color: var(--accent);
  }

  .android-qs-title {
    font-size: 0.85rem;
    font-weight: 600;
  }

  .android-qs-sub {
    font-size: 0.72rem;
    color: var(--muted);
  }

  .android-notif-section {
    display: grid;
    gap: 8px;
  }

  .android-notif-section h3 {
    margin: 0;
    font-size: 0.85rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .android-notif-empty {
    margin: 8px 0;
    text-align: center;
    font-size: 0.875rem;
    color: var(--muted);
  }

  .android-notif-list,
  .android-recents-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }

  .android-notif-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 16px;
    background: var(--surface);
    border: 1px solid var(--border);
  }

  .android-notif-copy {
    display: grid;
    min-width: 0;
  }

  .android-notif-name {
    font-size: 0.875rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .android-notif-meta {
    font-size: 0.75rem;
    color: var(--muted);
  }

  .android-notif-btn {
    min-height: 34px;
    padding: 4px 12px;
    border-radius: 999px;
  }

  .android-handle-btn {
    align-self: center;
    display: grid;
    place-items: center;
    min-height: 24px;
    width: 96px;
    padding: 4px;
    background: transparent;
    border: 0;
    border-radius: 999px;
  }

  .android-handle-bar {
    width: 48px;
    height: 4px;
    border-radius: 999px;
    background: var(--muted);
    opacity: 0.55;
  }

  .android-drawer {
    width: min(38rem, 100%);
    max-height: 86dvh;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 10px 14px 16px;
    border-radius: 28px 28px 0 0;
    background: var(--panel-solid);
    color: var(--text);
    border: 1px solid var(--border);
    border-bottom: 0;
    box-shadow: var(--shadow-win);
    overflow: hidden;
  }

  .android-drawer-head {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .android-drawer-back {
    min-height: 36px;
    padding: 4px 12px;
    border-radius: 999px;
  }

  .android-drawer-search-wrap {
    min-width: 0;
  }

  .android-drawer-search {
    width: 100%;
    border-radius: 999px;
    padding: 8px 14px;
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
  }

  .android-drawer-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px 6px;
    overflow-y: auto;
    padding: 4px 2px;
    min-width: 0;
  }

  .android-drawer-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    padding: 6px 2px;
    min-width: 0;
    min-height: 0;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 16px;
    color: var(--text);
  }

  .android-drawer-cell:hover {
    background: var(--surface);
    border-color: var(--border);
  }

  .android-drawer-label {
    width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.72rem;
    text-align: center;
    color: var(--text);
  }

  .android-recents {
    margin: auto 0;
    width: min(34rem, 100%);
    max-height: 80dvh;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
    border-radius: 24px;
    background: var(--panel-solid);
    color: var(--text);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-win);
    overflow-y: auto;
  }

  .android-recent-card {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    border-radius: 16px;
    background: var(--surface);
    border: 1px solid var(--border);
  }

  .android-recent-open {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px;
    background: transparent;
    border: 0;
    color: var(--text);
    text-align: left;
  }

  .android-recent-icon {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    overflow: hidden;
    color: #ffffff;
    font-size: 0.75rem;
    font-weight: 700;
    flex-shrink: 0;
  }

  .android-recent-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .android-recent-copy {
    display: grid;
    min-width: 0;
  }

  .android-recent-title {
    font-size: 0.875rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .android-recent-state {
    font-size: 0.75rem;
    color: var(--muted);
  }

  .android-recent-close {
    min-height: 34px;
    padding: 4px 10px;
    border-radius: 999px;
    flex-shrink: 0;
  }
</style>
