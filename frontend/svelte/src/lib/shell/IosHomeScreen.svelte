<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import MobileAppBar from "./MobileAppBar.svelte";
  import { resolveAppIcon } from "./app-icons.ts";
  // iPhone Files overrides. This is a static import, so the stylesheet ships with the
  // shell bundle and is present for every chrome. That is safe because every rule in
  // files-ios.css is scoped under
  // `.ios-shell .files-shell.is-ios-files[data-files-variant="ios-files"]`,
  // and `.ios-shell` is rendered only by this component.
  import "../files/files-ios.css";
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
    wallpaperUrl = "/wallpapers/ios.webp",
    viewportWidth,
    isPadPreview = false,
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
    viewportWidth?: number;
    isPadPreview?: boolean;
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
    monitorSlot: Snippet;
    windowsSlot?: Snippet;
    widgetsSlot?: Snippet;
  } = $props();

  let internalNow = $state(new Date());
  let measuredWidth = $state(typeof window !== "undefined" ? window.innerWidth : 390);
  let pageScrollY = $state(0);
  let mainScrollTop = $state(0);
  let localHome = $state(false);
  let libraryOpen = $state(false);
  let libraryQuery = $state("");

  let padPaneRole = $derived((role ?? null) as "viewer" | "operator" | "owner" | null);

  type SlicePane = import("svelte").Component<Record<string, unknown>>;
  let paneCache = new Map<string, Promise<SlicePane>>();
  // Two separate loaders on purpose. A ternary of two dynamic imports makes Vite emit
  // one shared __vite__mapDeps array for both branches, so the iPad Settings pane
  // received FilesManager's CSS and SettingsApp.css was never injected.
  const settingsPaneLoader = () =>
    import("../settings/SettingsApp.svelte").then((mod) => mod.default as unknown as SlicePane);
  const filesPaneLoader = () =>
    import("../files/FilesManager.svelte").then((mod) => mod.default as unknown as SlicePane);
  function loadPane(id: "settings" | "files"): Promise<SlicePane> {
    let pending = paneCache.get(id);
    if (!pending) {
      pending = id === "settings" ? settingsPaneLoader() : filesPaneLoader();
      paneCache.set(id, pending);
    }
    return pending;
  }

  let activeNow = $derived(clockNow ?? internalNow);
  let effectiveWidth = $derived(viewportWidth ?? measuredWidth);
  let isFramed = $derived(effectiveWidth >= 500);
  let isPadMode = $derived(Boolean(isPadPreview) && effectiveWidth >= 500);
  let isPhoneBezel = $derived(isFramed && !isPadMode);
  let navScrolled = $derived(mainScrollTop > 10 || pageScrollY > 10);
  let padSplit = $derived(isPadMode && authenticated);
  let settingsPane = $derived(padSplit ? loadPane("settings") : null);
  let filesPane = $derived(padSplit ? loadPane("files") : null);

  function trackMainScroll(event: Event) {
    mainScrollTop = (event.currentTarget as HTMLElement).scrollTop;
  }

  let statusTime = $derived.by(() => {
    const hours = activeNow.getHours() % 12 || 12;
    const mins = String(activeNow.getMinutes()).padStart(2, "0");
    return `${hours}:${mins}`;
  });
  let padStatusDate = $derived(
    activeNow.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }),
  );

  let activeWindows = $derived(openWindows.filter((win) => !win.minimized));
  let minimizedWindows = $derived(openWindows.filter((win) => win.minimized));
  let openAppSet = $derived(new Set(openWindows.map((win) => win.app)));
  let showingWindows = $derived(authenticated && activeWindows.length > 0 && !localHome);

  let pinnedDockApps = $derived.by(() => {
    const byApp = new Map(dockApps.map((item) => [item.app, item]));
    const picked: DockAppDef[] = [];
    const seen = new Set<string>();
    const addIfPresent = (id: string) => {
      const found = byApp.get(id);
      if (found && !seen.has(found.app)) {
        seen.add(found.app);
        picked.push(found);
      }
    };
    addIfPresent("assistant");
    addIfPresent("files");
    if (byApp.has("terminal")) {
      addIfPresent("terminal");
    } else {
      addIfPresent("editor");
    }
    addIfPresent("settings");
    for (const item of dockApps) {
      if (picked.length >= 4) break;
      if (!seen.has(item.app)) {
        seen.add(item.app);
        picked.push(item);
      }
    }
    return picked;
  });

  // Springboard shows one primary page of apps; everything else lives in the App Library.
  // Exactly 7 apps so the page is two 4-column rows with the App Library tile.
  const PRIMARY_APP_IDS: readonly string[] = [
    "assistant",
    "files",
    "editor",
    "workflows",
    "processes",
    "services",
    "settings",
  ];

  let primaryApps = $derived.by(() => {
    const byApp = new Map(dockApps.map((item) => [item.app, item]));
    const picked: DockAppDef[] = [];
    const seen = new Set<string>();
    for (const id of PRIMARY_APP_IDS) {
      const found = byApp.get(id);
      if (found && !seen.has(found.app)) {
        seen.add(found.app);
        picked.push(found);
      }
    }
    return picked;
  });

  let libraryApps = $derived.by(() => {
    const onHome = new Set(primaryApps.map((item) => item.app));
    return dockApps.filter((item) => !onHome.has(item.app));
  });

  let filteredLibrary = $derived.by(() => {
    const q = libraryQuery.trim().toLowerCase();
    if (!q) return libraryApps;
    return libraryApps.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.label.toLowerCase().includes(q) ||
        item.app.toLowerCase().includes(q),
    );
  });

  let backgroundImage = $derived(
    wallpaperUrl
      ? `url("${wallpaperUrl}"), linear-gradient(155deg, #1d4ed8 0%, #6d28d9 48%, #0f172a 100%)`
      : undefined,
  );

  $effect(() => {
    if (activeWindows.length === 0) {
      localHome = false;
    }
  });

  onMount(() => {
    if (typeof window !== "undefined") {
      measuredWidth = window.innerWidth;
    }
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
    if (onRestoreWindow) {
      onRestoreWindow(id);
    } else {
      onFocusWindow?.(id);
    }
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

<svelte:window bind:innerWidth={measuredWidth} onkeydown={handleWindowKeydown} onscroll={() => { pageScrollY = window.scrollY; }} />

<div
  class="ios-shell"
  class:signed-out={!authenticated}
  class:is-framed={isFramed}
  class:is-phone-bezel={isPhoneBezel}
  class:is-pad-mode={isPadMode}
  class:is-app-open={showingWindows}
  style:background-image={backgroundImage}
  data-shell-view={showingWindows ? "sheet" : "home"}
  data-device-form={isPadMode ? "ipad" : isPhoneBezel ? "iphone-bezel" : "iphone-fluid"}
>
  <div
    class="ios-device-screen"
    class:is-framed={isFramed}
    class:is-phone-bezel={isPhoneBezel}
    class:is-pad-mode={isPadMode}
    class:is-app-open={showingWindows}
  >
    <header
      class="workspace-header ios-status-bar"
      class:is-pad={isPadMode}
      class:is-app-open={showingWindows}
      class:is-scrolled={navScrolled}
    >
      <div class="ios-status-left">
        <time class="header-clock ios-time" datetime={activeNow.toISOString()}>
          {statusTime}{#if isPadMode}<span class="ios-pad-date"> · {padStatusDate}</span>{/if}
        </time>
        <span class="ios-brand-pill">
          <img src="/icon.svg" alt="" class="ios-brand-mark" width="14" height="14" />
          <span class="ios-brand-name">MSO</span>
        </span>
      </div>

      {#if !isPadMode}
        <div class="ios-dynamic-island" aria-hidden="true">
          <span class="ios-island-lens"></span>
        </div>
      {/if}

      <div class="session-actions ios-status-actions">
        <select
          class="ios-chrome-select"
          aria-label="Shell chrome"
          title="Shell chrome"
          value={chromeChoice}
          onchange={handleChromeSelect}
        >
          <option value="auto">Auto ({resolvedChrome})</option>
          {#each CHROME_PROFILES as profile (profile.id)}
            <option value={profile.id}>{profile.label}</option>
          {/each}
        </select>

        <button
          type="button"
          class="ios-status-btn ios-cc-trigger"
          aria-label="Open Control Center"
          title="Control Center"
          onclick={onOpenControl}
        >
          <svg class="ios-wifi-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M2.8 8.5a14 14 0 0 1 18.4 0" />
            <path d="M5.7 12a10 10 0 0 1 12.6 0" />
            <path d="M8.6 15.4a5.6 5.6 0 0 1 6.8 0" />
            <circle cx="12" cy="18.8" r="1.2" fill="currentColor" stroke="none" />
          </svg>
        </button>

        {#if authenticated}
          <button
            type="button"
            class="ios-status-btn ios-signout-btn"
            aria-label={signingOut ? "Signing out..." : "Sign out"}
            title={signingOut ? "Signing out..." : "Sign out"}
            disabled={signingOut}
            onclick={onSignOut}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M8 3.5H5.5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2H8" />
              <path d="M12.5 6.5 16 10l-3.5 3.5M16 10H7.5" />
            </svg>
            <span class="sr-only">{signingOut ? "Signing out..." : "Sign out"}</span>
          </button>
        {/if}
      </div>
    </header>

    {#if padSplit}
      <MobileAppBar
        variant="ios"
        appTitle="Settings and Files"
        {mobileNav}
        isPad
        padFloating
        onBackHome={goHome}
        onOpenAi={() => onOpenApp("assistant", "Alfa Assistant")}
      />
    {/if}

    <main
      id="main-content"
      tabindex="-1"
      data-shell={resolvedChrome}
      class="ios-main"
      class:is-app-open={showingWindows}
      onscroll={trackMainScroll}
    >
      <div class="ios-home-stage" class:is-pad-split={padSplit} hidden={showingWindows}>
        {#if padSplit}
          <div class="ios-pad-split" data-ios-split="settings-files">
            <section class="ios-pad-pane is-settings" aria-label="Settings split pane">
              {#await settingsPane then Pane}
                <Pane role={padPaneRole} resolvedChrome="macos" />
              {:catch}
                <p class="ios-pad-fallback">Settings pane unavailable.</p>
              {/await}
            </section>
            <section class="ios-pad-pane is-files" aria-label="Files split pane">
              {#await filesPane then Pane}
                <Pane initialPath="~" resolvedChrome="macos" />
              {:catch}
                <p class="ios-pad-fallback">Files pane unavailable.</p>
              {/await}
            </section>
          </div>
        {:else}
          <div class="ios-widget-surface" class:ios-login-wrap={!authenticated}>
            {@render monitorSlot()}
          </div>
        {/if}

        {#if authenticated && !padSplit}
          <section class="ios-grid-section" aria-label="Home screen apps">
            <div class="ios-app-grid" class:is-pad={isPadMode}>
              {#each primaryApps as item (item.app)}
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
                      <img src={visual.image} alt="" width="58" height="58" />
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

              {#if libraryApps.length > 0}
                <button
                  type="button"
                  class="ios-app-tile ios-library-tile-entry"
                  aria-label={`App Library, ${libraryApps.length} more apps`}
                  aria-expanded={libraryOpen}
                  aria-controls="ios-app-library"
                  title="App Library"
                  onclick={() => { libraryOpen = true; }}
                >
                  <span class="ios-squircle ios-library-entry-glyph" aria-hidden="true">
                    <span class="ios-dots-grid">
                      <span></span><span></span><span></span><span></span>
                    </span>
                  </span>
                  <span class="ios-app-label">App Library</span>
                </button>
              {/if}
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
            {#each minimizedWindows as win (win.id)}
              <button
                type="button"
                class="ios-glass-pill ios-min-pill"
                onclick={() => restoreAndShow(win.id)}
              >
                <span>{win.title}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      {#if showingWindows}
        <div class="ios-sheet-stage" data-open-windows={activeWindows.length}>
          <MobileAppBar
            variant="ios"
            appTitle={focusedTitle}
            {mobileNav}
            isPad={isPadMode}
            scrolled={navScrolled}
            onBackHome={goHome}
            onOpenAi={() => onOpenApp("assistant", "Alfa Assistant")}
            onCloseApp={focusedWinId && onCloseWindow ? () => onCloseWindow(focusedWinId) : undefined}
          />

          {#if windowsSlot}
            <div class="window-area ios-sheet-windows" onscroll={trackMainScroll}>
              {@render windowsSlot()}
            </div>
          {/if}
        </div>
      {/if}
    </main>

    {#if authenticated && !showingWindows}
      <div class="ios-dock-wrap" class:is-pad={isPadMode}>
        <nav class="app-dock ios-dock" class:is-pad={isPadMode} aria-label="Workspace apps">
          {#each pinnedDockApps as item (item.app)}
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
                  <img src={visual.image} alt="" width="56" height="56" />
                {:else}
                  <span class="dock-icon-mono">{visual.monogram}</span>
                {/if}
              </span>
              {#if openAppSet.has(item.app)}
                <span class="dock-running-dot ios-dock-dot" aria-hidden="true"></span>
              {/if}
            </button>
          {/each}

          <button
            type="button"
            class="dock-item ios-dock-item ios-all-apps-btn"
            aria-label="App Library"
            title="App Library"
            aria-expanded={libraryOpen}
            aria-controls="ios-app-library"
            onclick={() => { libraryOpen = !libraryOpen; }}
          >
            <span class="dock-icon-box ios-dock-icon ios-all-apps-glyph" aria-hidden="true">
              <span class="ios-dots-grid">
                <span></span><span></span><span></span><span></span>
              </span>
            </span>
          </button>
        </nav>

        <button
          type="button"
          class="ios-home-indicator"
          aria-label="Return to Home screen"
          onclick={goHome}
        >
          <span class="ios-home-pill" class:is-pad={isPadMode} aria-hidden="true"></span>
        </button>
      </div>
    {:else if authenticated && showingWindows}
      <div class="ios-sheet-footer">
        <button
          type="button"
          class="ios-home-indicator is-sheet-indicator"
          aria-label="Return to Home screen"
          onclick={goHome}
        >
          <span class="ios-home-pill is-sheet-pill" class:is-pad={isPadMode} aria-hidden="true"></span>
        </button>
      </div>
    {/if}

    {#if libraryOpen && authenticated}
      <div
        class="ios-library-backdrop"
        class:is-contained={isFramed}
        role="presentation"
        onclick={() => { libraryOpen = false; }}
      >
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
            <div class="ios-library-head-copy">
              <h2 id="ios-library-title">App Library</h2>
              <p class="ios-library-sub">{libraryApps.length} {libraryApps.length === 1 ? "app" : "apps"} not on your Home Screen</p>
            </div>
            <div class="ios-library-head-actions">
              <button
                type="button"
                class="ios-library-action"
                onclick={() => { libraryOpen = false; onOpenShortcuts(); }}
              >
                Shortcuts
              </button>
              <button type="button" class="ios-library-close" onclick={() => { libraryOpen = false; }}>
                Done
              </button>
            </div>
          </header>

          <div class="ios-library-search-wrap">
            <input
              type="search"
              class="ios-library-search"
              aria-label="Search all apps"
              placeholder="Search apps"
              bind:value={libraryQuery}
            />
          </div>

          <div class="ios-library-grid" class:is-pad={isPadMode}>
            {#each filteredLibrary as item (item.app)}
              {@const visual = resolveAppIcon(item.app, "ios")}
              <button
                type="button"
                class="ios-library-tile"
                aria-label={item.label}
                onclick={() => launchApp(item)}
              >
                <span class="ios-squircle ios-library-squircle" style:background={visual.gradient} aria-hidden="true">
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
              <p class="ios-library-empty">
                {libraryApps.length === 0 ? "Every app is already on your Home Screen." : "No matching apps"}
              </p>
            {/if}
          </div>

          {#if widgetsSlot}
            <div class="ios-library-widgets">
              {@render widgetsSlot()}
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
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
    --ios-widget-bg: var(--glass-bg, rgba(252, 252, 254, 0.78));
    --ios-dock-surface: var(--glass-bg, rgba(252, 252, 254, 0.34));
    --ios-dock-stroke: var(--glass-stroke, rgba(255, 255, 255, 0.45));
    --ios-dock-hi: var(--glass-hi, rgba(255, 255, 255, 0.72));
    --ios-dock-shadow: var(--glass-shadow, rgba(0, 0, 0, 0.28));
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .ios-shell {
      --ios-widget-bg: var(--glass-bg, rgba(36, 36, 44, 0.74));
      --ios-dock-surface: var(--glass-bg, rgba(44, 44, 50, 0.55));
      --ios-dock-stroke: var(--glass-stroke, rgba(255, 255, 255, 0.16));
      --ios-dock-hi: var(--glass-hi, rgba(255, 255, 255, 0.24));
      --ios-dock-shadow: var(--glass-shadow, rgba(0, 0, 0, 0.55));
    }
  }

  :global(:root[data-theme="dark"]) .ios-shell {
    --ios-widget-bg: var(--glass-bg, rgba(36, 36, 44, 0.74));
    --ios-dock-surface: var(--glass-bg, rgba(44, 44, 50, 0.55));
    --ios-dock-stroke: var(--glass-stroke, rgba(255, 255, 255, 0.16));
    --ios-dock-hi: var(--glass-hi, rgba(255, 255, 255, 0.24));
    --ios-dock-shadow: var(--glass-shadow, rgba(0, 0, 0, 0.55));
  }

  /* Desktop hardware bezel framing (iPhone 402x844 or iPad 1024x768) */
  .ios-shell.is-framed {
    height: 100dvh;
    align-items: center;
    justify-content: center;
    padding: 23px 16px;
    overflow: hidden;
  }

  .ios-shell.is-pad-mode {
    padding: 23px 24px;
  }

  .ios-device-screen {
    position: relative;
    width: 100%;
    max-width: 100%;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    overflow-x: clip;
    background: transparent;
    transition: background-color 200ms ease;
  }

  .ios-device-screen.is-phone-bezel {
    width: min(402px, calc(100% - 24px));
    height: min(844px, calc(100dvh - 46px));
    min-height: 0;
    border-radius: 52px;
    overflow: hidden;
    box-shadow: 0 0 0 11px #0a0a0c, 0 40px 90px rgba(0, 0, 0, 0.6);
  }

  .ios-device-screen.is-pad-mode {
    width: min(1024px, calc(100% - 48px));
    height: min(768px, calc(100dvh - 46px));
    min-height: 0;
    border-radius: 30px;
    overflow: hidden;
    box-shadow: 0 0 0 13px #0a0a0c, 0 40px 90px rgba(0, 0, 0, 0.6);
  }

  .ios-device-screen.is-app-open {
    background: var(--grouped, var(--bg, var(--panel-solid)));
    color: var(--label, var(--text));
  }

  /* Authentic iOS / iPadOS Status Bar */
  .ios-shell .ios-status-bar.workspace-header,
  :global(.workspace[data-chrome="ios"][data-ios-style="modern"]) .ios-shell .ios-status-bar.workspace-header {
    position: sticky;
    top: 0;
    z-index: 40;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: nowrap;
    gap: 6px;
    height: 50px;
    min-height: 48px;
    padding: 0 14px;
    background: transparent;
    border-bottom: 0;
    box-shadow: none;
    color: var(--label, #1c1c1e);
    text-shadow: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    flex-shrink: 0;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .ios-shell .ios-status-bar.workspace-header {
      color: #ffffff;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    }
  }

  :global(:root[data-theme="dark"]) .ios-shell .ios-status-bar.workspace-header {
    color: #ffffff;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  }

  .ios-shell .ios-status-bar.workspace-header.is-pad,
  :global(.workspace[data-chrome="ios"][data-ios-style="modern"]) .ios-shell .ios-status-bar.workspace-header.is-pad {
    height: 32px;
    min-height: 30px;
    padding: 0 22px;
  }

  .ios-shell .ios-status-bar.workspace-header.is-app-open,
  :global(.workspace[data-chrome="ios"][data-ios-style="modern"]) .ios-shell .ios-status-bar.workspace-header.is-app-open {
    background: transparent;
    color: var(--label, var(--text));
    text-shadow: none;
  }

  .ios-status-left {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex: 0 1 auto;
    flex-wrap: nowrap;
    overflow: hidden;
  }

  .ios-shell .ios-status-bar .ios-time {
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
    color: inherit;
    padding: 0;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .ios-status-bar.is-pad .ios-time {
    font-size: 13.5px;
  }

  .ios-pad-date {
    font-weight: 500;
    opacity: 0.92;
  }

  .ios-shell .ios-brand-pill {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 20px;
    padding: 0 6px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.16);
    border: 0.5px solid rgba(255, 255, 255, 0.24);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: inherit;
    flex-shrink: 0;
  }

  .ios-status-bar.is-app-open .ios-brand-pill {
    background: color-mix(in srgb, var(--label, var(--text)) 8%, transparent);
    border-color: color-mix(in srgb, var(--label, var(--text)) 14%, transparent);
  }

  .ios-brand-mark {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    flex-shrink: 0;
    display: block;
  }

  /* Authentic iPhone Dynamic Island */
  .ios-dynamic-island {
    position: absolute;
    left: 50%;
    top: 9px;
    transform: translateX(-50%);
    width: 118px;
    height: 32px;
    border-radius: 20px;
    background: #000000;
    box-shadow: inset 0 0 0 0.5px rgba(255, 255, 255, 0.08);
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding-right: 11px;
    pointer-events: none;
    z-index: 2;
  }

  .ios-island-lens {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: radial-gradient(circle at 38% 38%, #1e293b 0%, #090d16 55%, #000000 100%);
    box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.22);
  }

  /* Hide Dynamic Island on narrow phones (<= 369px) and at 200% font scale */
  @media (max-width: 23.125rem) {
    .ios-dynamic-island {
      display: none;
    }

    .ios-shell .ios-status-bar.workspace-header {
      padding: 0 10px;
    }
  }

  .ios-shell .ios-status-bar .ios-status-actions.session-actions {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 3px;
    flex-wrap: nowrap;
    width: auto;
    flex: 0 1 auto;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
  }

  .ios-shell .ios-status-bar.is-pad .ios-status-actions.session-actions {
    gap: 6px;
  }

  .ios-shell .ios-status-bar .ios-chrome-select {
    height: 22px;
    min-height: 22px;
    max-width: 46px;
    padding: 0 1px;
    font-size: 10.5px;
    font-weight: 500;
    line-height: 1;
    color: inherit;
    background: transparent;
    border: 0;
    border-radius: 6px;
    min-width: 0;
    flex-shrink: 1;
    cursor: pointer;
    text-overflow: ellipsis;
  }

  .ios-shell .ios-status-bar .ios-chrome-select:focus-visible,
  .ios-shell .ios-status-bar .ios-status-btn:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 2px;
    border-radius: 7px;
  }

  .ios-status-bar.is-pad .ios-chrome-select {
    height: 24px;
    min-height: 24px;
    max-width: 96px;
    padding: 0 4px;
    font-size: 11px;
  }

  .ios-shell .ios-status-bar .ios-chrome-select option {
    background: #141724;
    color: #f8fafc;
  }

  .ios-shell .ios-status-bar .ios-status-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    height: 24px;
    min-height: 24px;
    min-width: 22px;
    padding: 0 2px;
    border-radius: 7px;
    border: 0;
    background: transparent;
    color: inherit;
    font-size: 11.5px;
    font-weight: 600;
    line-height: 1;
    flex-shrink: 0;
    box-shadow: none;
  }

  .ios-shell .ios-status-bar .ios-status-btn:hover {
    background: color-mix(in srgb, currentColor 14%, transparent);
  }

  .ios-shell .ios-status-bar .ios-signout-btn svg {
    width: 14px;
    height: 14px;
    display: block;
    flex-shrink: 0;
  }

  .ios-status-bar.is-pad .ios-signout-btn {
    padding: 0 8px;
  }

  .ios-wifi-icon {
    width: 16px;
    height: 16px;
    display: block;
    flex-shrink: 0;
  }

  /* Main Springboard & App Sheet Container */
  .ios-main {
    position: relative;
    flex: 1 1 auto;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow-x: clip;
  }

  .ios-device-screen.is-framed .ios-main {
    overflow-y: auto;
    scrollbar-width: thin;
  }

  /* D1: an open app owns the viewport. Without an explicit height the shell grows to
     its content, so the document becomes the scroller and the sheet's own bounded
     scroller never engages. Bound height and clear min-height down the chain
     (.ios-shell -> .ios-device-screen -> .ios-main) so .ios-sheet-windows scrolls. */
  .ios-shell.is-app-open {
    height: 100dvh;
    min-height: 0;
    max-height: 100dvh;
    overflow: hidden;
  }

  .ios-device-screen.is-app-open {
    height: 100%;
    min-height: 0;
    max-height: 100%;
    overflow: hidden;
  }

  .ios-main.is-app-open {
    flex: 1 1 auto;
    height: auto;
    min-height: 0;
    overflow: hidden;
  }

  .ios-shell.signed-out .ios-main {
    justify-content: center;
    align-items: center;
    padding: 16px;
  }

  .ios-home-stage {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    /* clears the sticky dock so the last icon row scrolls fully above it */
    padding: 4px 0 108px;
  }

  .ios-home-stage[hidden] {
    display: none;
  }

  /* iPadOS split view: Settings (macOS sidebar) beside Files (Finder) */
  .ios-home-stage.is-pad-split {
    flex: 1 1 auto;
    min-height: 0;
    gap: 12px;
    /* 92px clears the floating toolbar, 76px clears the sticky dock */
    padding: 92px 16px 76px;
    overflow: hidden;
  }

  .ios-pad-split {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(0, 4fr);
    gap: 12px;
  }

  .ios-pad-pane {
    min-width: 0;
    min-height: 0;
    overflow: auto;
    border-radius: 18px;
    background: var(--ios-widget-bg);
    border: 0.5px solid var(--ios-dock-stroke);
    box-shadow:
      inset 0 0.5px 0 var(--ios-dock-hi),
      0 10px 28px var(--ios-dock-shadow);
    color: var(--label, var(--text));
  }

  .ios-pad-pane :global(.settings-root),
  .ios-pad-pane :global(.files-shell) {
    height: 100%;
    min-height: 0;
  }

  .ios-pad-fallback {
    margin: 12px;
    font-size: 0.8125rem;
    color: var(--muted);
  }

  @keyframes iosSpringIn {
    from {
      transform: scale(0.985);
    }
    to {
      transform: scale(1);
    }
  }

  /* Compact Liquid Glass Host Telemetry Widget (iOS Smart Stack style) */
  .ios-widget-surface {
    width: calc(100% - 32px);
    max-width: 100%;
    margin: 4px auto 0;
    min-width: 0;
    border-radius: 22px;
    overflow: hidden;
    background: var(--ios-widget-bg);
    border: 0.5px solid var(--ios-dock-stroke);
    box-shadow:
      inset 0 0.5px 0 var(--ios-dock-hi),
      0 10px 28px var(--ios-dock-shadow);
    -webkit-backdrop-filter: blur(var(--blur, 26px)) saturate(180%);
    backdrop-filter: blur(var(--blur, 26px)) saturate(180%);
  }

  .ios-device-screen.is-pad-mode .ios-widget-surface {
    width: calc(100% - 88px);
  }

  .ios-widget-surface.ios-login-wrap {
    width: 100%;
    margin: 0;
    background: transparent;
    border: 0;
    box-shadow: none;
    overflow: visible;
    display: flex;
    justify-content: center;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }

  .ios-widget-surface:not(.ios-login-wrap) :global(.monitor-widget) {
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }

  /* Collapsed Smart Stack strip: one stat row, no charts or secondary chrome */
  .ios-widget-surface:not(.ios-login-wrap) :global(.monitor-widget[data-monitor-expanded="false"]) {
    padding: 8px 12px;
  }

  .ios-widget-surface:not(.ios-login-wrap) :global(.monitor-widget[data-monitor-expanded="true"]) {
    padding: 12px 14px;
  }

  .ios-widget-surface:not(.ios-login-wrap) :global(.monitor-widget h2) {
    font-size: 13px;
    font-weight: 700;
  }

  .ios-widget-surface:not(.ios-login-wrap) :global(.monitor-widget .head-actions) {
    gap: 4px;
  }

  .ios-widget-surface:not(.ios-login-wrap) :global(.monitor-widget .head-actions button) {
    min-height: 44px;
    padding: 2px 12px;
    font-size: 12px;
    border-radius: 999px;
  }

  .ios-widget-surface:not(.ios-login-wrap) :global(.monitor-widget[data-monitor-expanded="false"] .kpi-grid) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 4px 10px;
    margin-top: 6px;
  }

  .ios-device-screen.is-pad-mode .ios-widget-surface:not(.ios-login-wrap) :global(.monitor-widget .kpi-grid) {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .ios-widget-surface:not(.ios-login-wrap) :global(.monitor-widget[data-monitor-expanded="false"] .kpi) {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 6px;
    padding: 0;
    border: 0;
    background: transparent;
    border-radius: 0;
  }

  .ios-widget-surface:not(.ios-login-wrap) :global(.monitor-widget[data-monitor-expanded="false"] .kpi-head) {
    display: block;
    flex: 0 1 auto;
    min-width: 0;
  }

  .ios-widget-surface:not(.ios-login-wrap) :global(.monitor-widget[data-monitor-expanded="false"] .kpi-value) {
    font-size: 12.5px;
    line-height: 1.25;
    margin: 0;
    text-align: end;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    overflow-wrap: normal;
  }

  .ios-widget-surface:not(.ios-login-wrap) :global(.monitor-widget[data-monitor-expanded="false"] .pill),
  .ios-widget-surface:not(.ios-login-wrap) :global(.monitor-widget[data-monitor-expanded="false"] .chart-grid),
  .ios-widget-surface:not(.ios-login-wrap) :global(.monitor-widget[data-monitor-expanded="false"] .kpi-sub),
  .ios-widget-surface:not(.ios-login-wrap) :global(.monitor-widget[data-monitor-expanded="false"] .bar),
  .ios-widget-surface:not(.ios-login-wrap) :global(.monitor-widget[data-monitor-expanded="false"] .device-line) {
    display: none;
  }

  .ios-widget-surface:not(.ios-login-wrap) :global(.monitor-widget[data-monitor-expanded="false"] .kpi-label) {
    font-size: 10px;
  }

  @media (max-width: 350px) {
    .ios-widget-surface {
      width: calc(100% - 16px);
      border-radius: 18px;
    }
  }

  /* Authentic Borderless Springboard Grid (zero heavy grey card box!) */
  .ios-shell .ios-grid-section,
  :global(.workspace[data-chrome="ios"][data-ios-style="modern"]) .ios-shell .ios-grid-section {
    background: transparent;
    border: 0;
    border-radius: 0;
    box-shadow: none;
    padding: 0;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    min-width: 0;
    max-width: 100%;
  }

  .ios-app-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px 12px;
    padding: 10px 18px 6px;
    width: 100%;
    min-width: 0;
    align-content: start;
  }

  .ios-app-grid.is-pad {
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 28px 20px;
    padding: 28px 44px;
  }

  @media (max-width: 350px) {
    .ios-app-grid {
      gap: 14px 8px;
      padding: 10px 10px;
    }
  }

  .ios-app-tile {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 6px;
    width: 100%;
    min-width: 0;
    min-height: 0;
    padding: 2px;
    background: transparent;
    border: 0;
    border-radius: 14px;
    color: #ffffff;
    text-align: center;
  }

  .ios-app-tile:hover {
    background: transparent;
  }

  @media (hover: hover) {
    .ios-app-tile:hover .ios-squircle {
      transform: scale(1.04);
    }
  }

  .ios-app-tile:active .ios-squircle {
    transform: scale(0.91);
  }

  .ios-squircle {
    width: min(58px, 100%);
    max-width: 58px;
    aspect-ratio: 1;
    border-radius: 23%;
    overflow: hidden;
    display: grid;
    place-items: center;
    filter: drop-shadow(0 7px 13px rgba(0, 0, 0, 0.3));
    transition: transform 140ms cubic-bezier(0.2, 0.8, 0.2, 1);
    flex-shrink: 0;
  }

  .ios-app-grid.is-pad .ios-squircle {
    width: min(68px, 100%);
    max-width: 68px;
  }

  .ios-squircle img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .ios-squircle-mono {
    font-size: 16px;
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
    font-size: 12px;
    font-weight: 600;
    line-height: 1.25;
    color: var(--label, #1c1c1e);
    text-shadow: 0 1px 2px rgba(255, 255, 255, 0.55);
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .ios-app-label {
      color: #ffffff;
      font-weight: 500;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
    }
  }

  :global(:root[data-theme="dark"]) .ios-app-label {
    color: #ffffff;
    font-weight: 500;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
  }

  .ios-app-grid.is-pad .ios-app-label {
    font-size: 13.5px;
  }

  .ios-app-dot {
    width: 4px;
    height: 4px;
    border-radius: 999px;
    background: #ffffff;
    box-shadow: 0 0 6px rgba(255, 255, 255, 0.9);
  }

  /* App Library entry tile closes the primary page: everything else lives in the sheet */
  .ios-library-entry-glyph {
    background: rgba(255, 255, 255, 0.24);
    border: 0.5px solid rgba(255, 255, 255, 0.34);
    -webkit-backdrop-filter: blur(12px);
    backdrop-filter: blur(12px);
  }

  .ios-library-tile-entry .ios-dots-grid span {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.92);
  }

  /* Search & App Library Floating Glass Pills */
  .ios-home-pills {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 2px 16px 6px;
    min-width: 0;
    max-width: 100%;
  }

  .ios-glass-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: 30px;
    min-height: 30px;
    padding: 0 13px;
    border-radius: 999px;
    background: var(--ios-dock-surface);
    border: 0.5px solid var(--ios-dock-stroke);
    color: #ffffff;
    font-size: 12px;
    font-weight: 500;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
    -webkit-backdrop-filter: blur(var(--blur, 26px)) saturate(180%);
    backdrop-filter: blur(var(--blur, 26px)) saturate(180%);
    box-shadow:
      inset 0 0.5px 0 var(--ios-dock-hi),
      0 8px 20px var(--ios-dock-shadow);
    transition: transform 140ms ease, background-color 140ms ease;
    max-width: 100%;
  }

  .ios-glass-pill:active {
    transform: scale(0.95);
  }

  .ios-pill-icon {
    width: 13px;
    height: 13px;
    flex-shrink: 0;
  }

  /* Open App Sheet Stage (MobileShell.dc.html 1:1) */
  .ios-sheet-stage {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    background: var(--bg, var(--panel-solid));
    animation: iosSpringIn 280ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .ios-sheet-windows {
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    overflow-y: auto;
    overflow-x: clip;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  /* D1: the sheet is the scroller. A 100%-tall window-area would absorb the overflow
     into itself, so let the sheet own the scroll and keep rows in document order. */
  .ios-sheet-windows :global(.window-area) {
    gap: 0;
    height: auto;
    min-height: 0;
  }

  .ios-sheet-windows :global(.win-frame) {
    border: 0;
    border-radius: 0;
    box-shadow: none;
    background: transparent;
  }

  /* Floating Liquid Glass Springboard Dock */
  .ios-dock-wrap {
    position: sticky;
    bottom: 0;
    z-index: 35;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 6px 12px max(8px, env(safe-area-inset-bottom));
    pointer-events: none;
    width: 100%;
    max-width: 100%;
    flex-shrink: 0;
  }

  .ios-shell .ios-dock.app-dock {
    pointer-events: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    width: auto;
    max-width: 100%;
    padding: 11px 15px;
    border-radius: 31px;
    background: var(--ios-dock-surface);
    border: 0.5px solid var(--ios-dock-stroke);
    box-shadow:
      inset 0 0.5px 0 var(--ios-dock-hi),
      0 12px 34px var(--ios-dock-shadow);
    -webkit-backdrop-filter: blur(var(--blur, 26px)) saturate(180%);
    backdrop-filter: blur(var(--blur, 26px)) saturate(180%);
  }

  .ios-shell .ios-dock.app-dock.is-pad {
    gap: 20px;
    padding: 13px 19px;
    border-radius: 34px;
  }

  .ios-shell .ios-dock.app-dock::-webkit-scrollbar {
    display: none;
  }

  .ios-shell .ios-dock .ios-dock-item {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-width: 0;
    min-height: 0;
    padding: 0;
    border: 0;
    border-radius: 23%;
    background: transparent;
    color: #ffffff;
    flex-shrink: 0;
    transition: transform 140ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .ios-shell .ios-dock .ios-dock-item:hover {
    background: transparent;
    transform: translateY(-2px);
  }

  .ios-shell .ios-dock .ios-dock-item:active {
    transform: scale(0.91);
  }

  .ios-shell .ios-dock .ios-dock-icon {
    width: 56px;
    height: 56px;
    border-radius: 23%;
    overflow: hidden;
    display: grid;
    place-items: center;
    box-shadow: none;
    filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.25));
  }

  .ios-shell .ios-dock.is-pad .ios-dock-icon {
    width: 62px;
    height: 62px;
  }

  @media (max-width: 390px) {
    .ios-shell .ios-dock.app-dock {
      gap: 10px;
      padding: 10px 12px;
      border-radius: 28px;
    }

    .ios-shell .ios-dock .ios-dock-icon {
      width: 52px;
      height: 52px;
    }
  }

  @media (max-width: 350px) {
    .ios-shell .ios-dock.app-dock {
      gap: 8px;
      padding: 9px 10px;
      border-radius: 25px;
    }

    .ios-shell .ios-dock .ios-dock-icon {
      width: 44px;
      height: 44px;
    }
  }

  .ios-dock-dot {
    position: absolute;
    bottom: -6px;
    left: 50%;
    transform: translateX(-50%);
    width: 4px;
    height: 4px;
    border-radius: 999px;
    background: #ffffff;
    box-shadow: 0 0 6px rgba(255, 255, 255, 0.9);
  }

  .ios-all-apps-glyph {
    background: rgba(255, 255, 255, 0.24);
    border: 0.5px solid rgba(255, 255, 255, 0.34);
  }

  .ios-dots-grid {
    display: grid;
    grid-template-columns: repeat(2, 9px);
    gap: 5px;
  }

  .ios-dots-grid span {
    width: 9px;
    height: 9px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.92);
  }

  /* Home Indicator */
  .ios-sheet-footer {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 4px 0 max(8px, env(safe-area-inset-bottom));
    background: var(--bg, var(--panel-solid));
    flex-shrink: 0;
  }

  .ios-home-indicator {
    pointer-events: auto;
    display: grid;
    place-items: center;
    min-height: 20px;
    min-width: 148px;
    padding: 4px 8px;
    background: transparent;
    border: 0;
    border-radius: 999px;
  }

  .ios-home-pill {
    width: 138px;
    height: 5px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.72);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
    transition: opacity 140ms ease, transform 140ms ease;
  }

  .ios-home-pill.is-pad {
    width: 200px;
  }

  .ios-home-pill.is-sheet-pill {
    background: color-mix(in srgb, var(--label, var(--text)) 36%, transparent);
    box-shadow: none;
  }

  .ios-home-indicator:active .ios-home-pill {
    transform: scaleX(0.94);
  }

  /* App Library Sheet */
  .ios-library-backdrop {
    position: fixed;
    inset: 0;
    z-index: 55;
    display: grid;
    place-items: end center;
    padding: 12px;
    background: rgba(6, 10, 20, 0.5);
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
  }

  .ios-library-backdrop.is-contained {
    position: absolute;
    border-radius: inherit;
  }

  .ios-library-sheet {
    width: min(36rem, 100%);
    max-height: 82%;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px;
    border-radius: 26px;
    background: var(--bg, var(--panel-solid));
    color: var(--label, var(--text));
    border: 0.5px solid var(--sep, var(--border));
    box-shadow: 0 22px 60px rgba(0, 0, 0, 0.42);
    overflow: hidden;
  }

  .ios-library-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  }

  .ios-library-head-copy {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .ios-library-sub {
    margin: 0;
    font-size: 12.5px;
    color: var(--muted);
  }

  .ios-library-head-actions {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .ios-library-action,
  .ios-library-close {
    min-height: 32px;
    padding: 4px 12px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 600;
  }

  .ios-library-close {
    background: var(--tint, var(--accent));
    color: #ffffff;
    border-color: transparent;
  }

  .ios-library-search-wrap {
    min-width: 0;
  }

  .ios-library-search {
    width: 100%;
    min-height: 38px;
    border-radius: 12px;
    padding: 6px 12px;
    background: var(--fill, var(--surface));
    color: var(--label, var(--text));
    border: 0.5px solid var(--sep, var(--border));
    font-size: 15px;
  }

  .ios-library-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 14px 8px;
    overflow-y: auto;
    padding: 4px 2px;
    min-width: 0;
  }

  .ios-library-grid.is-pad {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }

  .ios-library-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    padding: 4px 2px;
    min-width: 0;
    min-height: 0;
    background: transparent;
    border: 0;
    border-radius: 14px;
    color: var(--label, var(--text));
  }

  .ios-library-tile:hover {
    background: var(--fill, var(--surface));
  }

  .ios-library-squircle {
    width: min(52px, 100%);
    max-width: 52px;
  }

  .ios-library-label {
    width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11.5px;
    text-align: center;
    color: var(--label, var(--text));
  }

  .ios-library-empty {
    grid-column: 1 / -1;
    margin: 16px 0;
    text-align: center;
    font-size: 14px;
    color: var(--muted);
  }

  .ios-library-widgets {
    border-top: 0.5px solid var(--sep, var(--border));
    padding-top: 8px;
    overflow-x: auto;
  }

  /* Accessibility overrides: reduce-glass, high-contrast, reduced-motion */
  :global(:root[data-reduce-glass="true"]) .ios-widget-surface:not(.ios-login-wrap),
  :global(:root[data-reduce-glass="true"]) .ios-shell .ios-dock.app-dock,
  :global(:root[data-reduce-glass="true"]) .ios-glass-pill {
    background: var(--panel-solid);
    color: var(--text);
    text-shadow: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }

  :global(:root[data-high-contrast="true"]) .ios-shell .ios-status-bar.workspace-header {
    background: #0b0d14;
    color: #ffffff;
    border-bottom: 1.5px solid #ffffff;
  }

  :global(:root[data-high-contrast="true"]) .ios-shell .ios-dock.app-dock,
  :global(:root[data-high-contrast="true"]) .ios-glass-pill {
    background: #0b0d14;
    color: #ffffff;
    border: 2px solid #ffffff;
    box-shadow: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }

  :global(:root[data-reduced-motion="true"]) .ios-home-stage,
  :global(:root[data-reduced-motion="true"]) .ios-sheet-stage,
  :global(:root[data-reduced-motion="true"]) .ios-squircle,
  :global(:root[data-reduced-motion="true"]) .ios-dock-item,
  :global(:root[data-reduced-motion="true"]) .ios-glass-pill,
  :global(:root[data-reduced-motion="true"]) .ios-home-pill {
    animation: none;
    transition: none;
  }
</style>
