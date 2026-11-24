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
    focusedTitle = "Overview",
    chromeChoice,
    resolvedChrome,
    dockApps,
    openWindows = [],
    clockNow,
    signingOut = false,
    onOpenApp,
    onRestoreWindow,
    onMinimizeWindow,
    onMinimizeAll,
    onCloseWindow,
    onOpenPalette,
    onOpenControl,
    onOpenShortcuts,
    onChromeChange,
    onSignOut,
    monitorSlot,
    widgetsSlot,
    windowsSlot,
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
    onOpenApp: (app: string, title: string, payload?: unknown, multi?: boolean) => void;
    onRestoreWindow?: (id: string) => void;
    onMinimizeWindow?: (id: string) => void;
    onMinimizeAll?: () => void;
    onCloseWindow?: (id: string) => void;
    onOpenPalette: () => void;
    onOpenControl: () => void;
    onOpenShortcuts: () => void;
    onChromeChange: (choice: ChromeChoice) => void;
    onSignOut: () => void;
    monitorSlot: Snippet;
    widgetsSlot?: Snippet;
    windowsSlot?: Snippet;
  } = $props();

  let internalNow = $state(new Date());
  let sidebarCollapsed = $state(false);
  let filterQuery = $state("");

  let activeNow = $derived(clockNow ?? internalNow);
  let headerTime = $derived(
    activeNow.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
  );
  let activeWindows = $derived(openWindows.filter((win) => !win.minimized));
  let minimizedWindows = $derived(openWindows.filter((win) => win.minimized));
  let openAppSet = $derived(new Set(openWindows.map((win) => win.app)));

  let filteredApps = $derived.by(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return dockApps;
    return dockApps.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.label.toLowerCase().includes(q) ||
        item.app.toLowerCase().includes(q),
    );
  });

  onMount(() => {
    if (clockNow) return;
    const timer = setInterval(() => {
      internalNow = new Date();
    }, 30_000);
    return () => clearInterval(timer);
  });

  function handleChromeSelect(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (isChromeChoice(value)) {
      onChromeChange(value);
    }
  }

  function goHome() {
    if (onMinimizeAll) {
      onMinimizeAll();
      return;
    }
    if (onMinimizeWindow) {
      for (const win of activeWindows) {
        onMinimizeWindow(win.id);
      }
    }
  }

  function closeAppWindows(appId: string) {
    if (!onCloseWindow) return;
    for (const win of openWindows) {
      if (win.app === appId) {
        onCloseWindow(win.id);
      }
    }
  }
</script>

<div class="dash-shell" class:signed-out={!authenticated} data-sidebar-collapsed={sidebarCollapsed}>
  <header class="workspace-header dash-header">
    <div class="dash-header-left">
      {#if authenticated}
        <button
          type="button"
          class="dash-toggle-btn"
          aria-expanded={!sidebarCollapsed}
          aria-controls="dash-sidebar"
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          onclick={() => { sidebarCollapsed = !sidebarCollapsed; }}
        >
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <rect x="3" y="4" width="14" height="12" rx="2" stroke="currentColor" stroke-width="1.6" />
            <path d="M8 4V16" stroke="currentColor" stroke-width="1.6" />
          </svg>
        </button>
      {/if}

      <div class="brand dash-brand">
        <img src="/icon.svg" alt="" class="brand-mark" width="20" height="20" />
        <h1>MSO</h1>
      </div>

      {#if authenticated}
        <span class="dash-crumb-sep" aria-hidden="true">/</span>
        <button type="button" class="dash-crumb-home" onclick={goHome}>Overview</button>
        {#if activeWindows.length > 0}
          <span class="dash-crumb-sep" aria-hidden="true">/</span>
          <span class="header-subtitle dash-active-view">{focusedTitle}</span>
        {/if}
      {/if}
    </div>

    <div class="session-actions dash-actions">
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
          <span class="role-badge dash-role">{role}</span>
        {/if}
        <button type="button" disabled={signingOut} onclick={onSignOut}>
          {signingOut ? "Signing out..." : "Sign out"}
        </button>
      {/if}
      <time class="header-clock dash-clock" datetime={activeNow.toISOString()}>{headerTime}</time>
    </div>
  </header>

  <div class="dash-body">
    {#if authenticated}
      <aside id="dash-sidebar" class="dash-sidebar" class:collapsed={sidebarCollapsed}>
        <div class="dash-sidebar-top">
          <button
            type="button"
            class="dash-overview-btn"
            class:active={activeWindows.length === 0}
            aria-label="Overview"
            title="Overview"
            onclick={goHome}
          >
            <svg class="dash-home-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M3.5 9.5L10 4L16.5 9.5V16H12V12H8V16H3.5V9.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
            </svg>
            {#if !sidebarCollapsed}
              <span>Overview</span>
            {/if}
          </button>

          {#if !sidebarCollapsed}
            <div class="dash-filter-wrap">
              <input
                type="search"
                class="dash-filter-input"
                aria-label="Filter apps"
                placeholder="Filter apps"
                bind:value={filterQuery}
              />
            </div>
          {/if}
        </div>

        {#if !sidebarCollapsed}
          <div class="dash-section-label">Apps ({filteredApps.length})</div>
        {/if}

        <nav class="app-dock dash-nav" aria-label="Workspace apps">
          {#each filteredApps as item (item.app)}
            {@const visual = resolveAppIcon(item.app, "dashboard")}
            {@const isRunning = openAppSet.has(item.app)}
            <div class="dash-nav-row" class:running={isRunning}>
              <button
                type="button"
                class="dash-nav-item"
                class:active={focusedTitle === item.title && activeWindows.length > 0}
                aria-label={item.label}
                title={item.title}
                onclick={() => onOpenApp(item.app, item.title, item.payload, item.multi)}
              >
                <span class="dash-nav-icon" style:background={visual.gradient} aria-hidden="true">
                  {#if visual.image}
                    <img src={visual.image} alt="" loading="lazy" width="20" height="20" />
                  {:else}
                    <span class="dash-nav-mono">{visual.monogram}</span>
                  {/if}
                </span>
                {#if !sidebarCollapsed}
                  <span class="dash-nav-title">{item.title}</span>
                {/if}
                {#if isRunning}
                  <span class="dash-running-dot" aria-hidden="true"></span>
                  <span class="sr-only">(running)</span>
                {/if}
              </button>

              {#if isRunning && !sidebarCollapsed && onCloseWindow}
                <button
                  type="button"
                  class="dash-close-app"
                  aria-label={`Close ${item.title}`}
                  onclick={() => closeAppWindows(item.app)}
                >
                  x
                </button>
              {/if}
            </div>
          {/each}

          {#if filteredApps.length === 0 && !sidebarCollapsed}
            <p class="dash-empty-nav">No matching apps</p>
          {/if}

          {#if minimizedWindows.length > 0}
            {#if !sidebarCollapsed}
              <div class="dash-section-label">Minimized</div>
            {/if}
            {#each minimizedWindows as win (win.id)}
              <button
                type="button"
                class="minimized-chip dash-min-chip"
                onclick={() => onRestoreWindow?.(win.id)}
              >
                Restore {win.title}
              </button>
            {/each}
          {/if}
        </nav>
      </aside>
    {/if}

    <main id="main-content" tabindex="-1" data-shell={resolvedChrome} class="dash-main">
      <div class="dash-canvas">
        <div class="dash-monitor-slot" class:dash-login-wrap={!authenticated}>
          {@render monitorSlot()}
        </div>

        {#if authenticated}
          {#if widgetsSlot}
            <div class="dash-widgets-slot">
              {@render widgetsSlot()}
            </div>
          {/if}

          {#if activeWindows.length > 0 && windowsSlot}
            <div class="window-area dash-windows-grid" data-open-windows={activeWindows.length}>
              {@render windowsSlot()}
            </div>
          {:else}
            <div class="dash-idle-banner">
              <p>Select an app from the sidebar or press Ctrl/Cmd + K to open a workspace pane.</p>
            </div>
          {/if}
        {/if}
      </div>
    </main>
  </div>
</div>

<style>
  .dash-shell {
    min-height: 100dvh;
    width: 100%;
    max-width: 100%;
    display: flex;
    flex-direction: column;
    background-color: var(--surface);
    background-image: none;
    color: var(--text);
    overflow-x: clip;
    padding-top: env(safe-area-inset-top);
    padding-right: env(safe-area-inset-right);
    padding-bottom: env(safe-area-inset-bottom);
    padding-left: env(safe-area-inset-left);
  }

  .dash-shell .dash-header.workspace-header {
    position: sticky;
    top: 0;
    z-index: 40;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
    padding: 8px 12px;
    background: var(--panel-solid);
    color: var(--text);
    border-bottom: 1px solid var(--border);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    min-width: 0;
    max-width: 100%;
  }

  .dash-header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    min-width: 0;
    max-width: 100%;
  }

  .dash-shell .dash-header h1,
  .dash-shell .dash-header .dash-clock {
    color: var(--text);
  }

  .dash-shell .dash-header button,
  .dash-shell .dash-header select {
    min-height: 32px;
    padding: 4px 10px;
    font-size: 0.8125rem;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    max-width: 100%;
    min-width: 0;
  }

  .dash-shell .dash-header select option {
    background: var(--panel-solid);
    color: var(--text);
  }

  .dash-shell .dash-header button:hover,
  .dash-shell .dash-header select:hover {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, var(--surface));
  }

  .dash-toggle-btn {
    display: grid;
    place-items: center;
    width: 34px;
    padding: 4px;
    flex-shrink: 0;
  }

  .dash-toggle-btn svg {
    width: 18px;
    height: 18px;
  }

  .dash-crumb-sep {
    color: var(--muted);
    font-size: 0.85rem;
  }

  .dash-shell .dash-header .dash-crumb-home {
    background: transparent;
    border-color: transparent;
    color: var(--muted);
    padding: 2px 6px;
  }

  .dash-shell .dash-header .dash-crumb-home:hover {
    color: var(--text);
    background: var(--surface);
  }

  .dash-active-view {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }

  .dash-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    min-width: 0;
    max-width: 100%;
  }

  .dash-role {
    border-color: var(--border);
    color: var(--text);
    background: var(--surface);
  }

  .dash-body {
    flex: 1 0 auto;
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    width: 100%;
    max-width: 100%;
  }

  @media (min-width: 48rem) {
    .dash-body {
      flex-direction: row;
      align-items: stretch;
    }
  }

  .dash-sidebar {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 8px;
    background: var(--panel-solid);
    border-bottom: 1px solid var(--border);
    min-width: 0;
    max-width: 100%;
  }

  @media (min-width: 48rem) {
    .dash-sidebar {
      width: 14.5rem;
      flex: 0 0 14.5rem;
      border-bottom: 0;
      border-right: 1px solid var(--border);
      position: sticky;
      top: 52px;
      max-height: calc(100dvh - 52px);
      overflow: hidden;
    }

    .dash-sidebar.collapsed {
      width: 4rem;
      flex: 0 0 4rem;
      align-items: center;
    }
  }

  .dash-sidebar-top {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    min-width: 0;
  }

  .dash-overview-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 36px;
    padding: 6px 10px;
    border-radius: 8px;
    background: transparent;
    border: 1px solid transparent;
    color: var(--text);
    font-size: 0.875rem;
    font-weight: 500;
    text-align: left;
  }

  .dash-sidebar.collapsed .dash-overview-btn {
    justify-content: center;
    padding: 6px;
  }

  .dash-overview-btn:hover {
    background: var(--surface);
  }

  .dash-overview-btn.active {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    border-color: color-mix(in srgb, var(--accent) 32%, transparent);
    color: var(--text);
    font-weight: 600;
  }

  .dash-home-icon {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }

  .dash-filter-wrap {
    width: 100%;
    min-width: 0;
  }

  .dash-filter-input {
    width: 100%;
    min-height: 34px;
    padding: 5px 10px;
    border-radius: 8px;
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    font-size: 0.8125rem;
  }

  .dash-section-label {
    padding: 4px 10px 0;
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }

  .dash-shell .dash-nav.app-dock {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 4px;
    flex-wrap: nowrap;
    overflow-x: auto;
    overflow-y: hidden;
    width: 100%;
    max-width: 100%;
    padding: 2px 0;
    background: transparent;
    border: 0;
    border-radius: 0;
    box-shadow: none;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  @media (min-width: 48rem) {
    .dash-shell .dash-nav.app-dock {
      flex-direction: column;
      align-items: stretch;
      flex: 1 1 auto;
      min-height: 0;
      overflow-x: hidden;
      overflow-y: auto;
      gap: 2px;
    }
  }

  .dash-nav-row {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 0 0 auto;
    border-radius: 8px;
    min-width: 0;
  }

  @media (min-width: 48rem) {
    .dash-nav-row {
      width: 100%;
    }
  }

  .dash-nav-item {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 36px;
    padding: 5px 8px;
    border-radius: 8px;
    background: transparent;
    border: 1px solid transparent;
    color: var(--text);
    font-size: 0.83rem;
    text-align: left;
    white-space: nowrap;
  }

  .dash-sidebar.collapsed .dash-nav-item {
    justify-content: center;
    padding: 6px;
  }

  .dash-nav-item:hover {
    background: var(--surface);
    border-color: var(--border);
  }

  .dash-nav-item.active {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    border-color: color-mix(in srgb, var(--accent) 32%, transparent);
    font-weight: 600;
  }

  .dash-nav-icon {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    overflow: hidden;
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }

  .dash-nav-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .dash-nav-mono {
    font-size: 0.625rem;
    font-weight: 700;
    color: #ffffff;
  }

  .dash-nav-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }

  .dash-running-dot {
    margin-left: auto;
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--accent);
    flex-shrink: 0;
  }

  .dash-close-app {
    min-width: 26px;
    min-height: 26px;
    padding: 0 6px;
    border-radius: 6px;
    background: transparent;
    border: 1px solid transparent;
    color: var(--muted);
    font-size: 0.75rem;
    flex-shrink: 0;
  }

  .dash-close-app:hover {
    color: var(--danger);
    border-color: var(--danger);
    background: var(--danger-bg);
  }

  .dash-empty-nav {
    margin: 6px 10px;
    font-size: 0.8rem;
    color: var(--muted);
  }

  .dash-min-chip {
    flex: 0 0 auto;
    min-height: 32px;
    padding: 4px 10px;
    font-size: 0.75rem;
    text-align: left;
    background: var(--surface);
    color: var(--text);
    border: 1px dashed var(--border);
    border-radius: 8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dash-main {
    flex: 1 1 auto;
    min-width: 0;
    width: 100%;
    padding: 14px clamp(10px, 2vw, 24px) 28px;
  }

  .dash-shell.signed-out .dash-main {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: calc(100dvh - 64px);
  }

  .dash-canvas {
    width: 100%;
    max-width: 96rem;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
  }

  .dash-monitor-slot,
  .dash-widgets-slot {
    width: 100%;
    min-width: 0;
  }

  .dash-monitor-slot.dash-login-wrap {
    display: flex;
    justify-content: center;
  }

  .dash-windows-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(26rem, 100%), 1fr));
    gap: 14px;
    align-items: stretch;
    width: 100%;
    min-width: 0;
  }

  .dash-idle-banner {
    padding: 14px 16px;
    border: 1px dashed var(--border);
    border-radius: 12px;
    background: var(--panel-solid);
  }

  .dash-idle-banner p {
    margin: 0;
    font-size: 0.875rem;
    color: var(--muted);
  }
</style>
