<script lang="ts">
  import {
    CHROME_PROFILES,
    isChromeChoice,
    type ChromeChoice,
    type ChromeProfile,
  } from "./chrome-profile.ts";
  import type { WindowState } from "./window-store.ts";

  type ThemeMode = "system" | "light" | "dark";
  type MenuId = "mso" | "app" | "file" | "view" | "window" | "help";

  let {
    authenticated,
    role = null,
    focusedTitle = "Desktop",
    focusedWinId = null,
    openWindows = [],
    chromeChoice,
    resolvedChrome,
    themeMode = "system",
    signingOut = false,
    onOpenApp,
    onCommandPalette,
    onControlCenter,
    onShortcuts,
    onChromeChange,
    onThemeChange,
    onCycleWallpaper,
    onLock,
    onForceQuit,
    onSignOut,
    onLaunchpad,
    onMissionControl,
    onMinimizeFocused,
    onMaximizeFocused,
    onCloseFocused,
    onFocusWindow,
    onCascade,
    onTile,
    onMinimizeAll,
  }: {
    authenticated: boolean;
    role?: string | null;
    focusedTitle?: string;
    focusedWinId?: string | null;
    openWindows?: readonly WindowState[];
    chromeChoice: ChromeChoice;
    resolvedChrome: ChromeProfile;
    themeMode?: ThemeMode;
    signingOut?: boolean;
    onOpenApp: (app: string, title: string, payload?: unknown, multi?: boolean) => void;
    onCommandPalette: () => void;
    onControlCenter: () => void;
    onShortcuts: () => void;
    onChromeChange: (choice: ChromeChoice) => void;
    onThemeChange: (mode: ThemeMode) => void;
    onCycleWallpaper: () => void;
    onLock: () => void;
    onForceQuit: () => void;
    onSignOut: () => void;
    onLaunchpad: () => void;
    onMissionControl: () => void;
    onMinimizeFocused: () => void;
    onMaximizeFocused: () => void;
    onCloseFocused: () => void;
    onFocusWindow: (id: string) => void;
    onCascade: () => void;
    onTile: () => void;
    onMinimizeAll: () => void;
  } = $props();

  let openMenu = $state<MenuId | null>(null);
  let barEl = $state<HTMLElement | null>(null);
  let clockNow = $state(new Date());

  let formattedClock = $derived(
    clockNow.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }),
  );

  $effect(() => {
    const timer = setInterval(() => {
      clockNow = new Date();
    }, 30_000);
    return () => clearInterval(timer);
  });

  function closeMenus() {
    openMenu = null;
  }

  function toggleMenu(id: MenuId) {
    openMenu = openMenu === id ? null : id;
  }

  function hoverMenu(id: MenuId) {
    if (openMenu !== null && openMenu !== id) {
      openMenu = id;
    }
  }

  function runAction(action: () => void) {
    closeMenus();
    action();
  }

  function handleWindowPointerDown(event: PointerEvent) {
    if (openMenu === null) return;
    const target = event.target as Node | null;
    if (barEl && target && barEl.contains(target)) return;
    closeMenus();
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (openMenu === null) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenus();
    }
  }

  function handleChromeSelect(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (isChromeChoice(value)) {
      onChromeChange(value);
    }
  }

  let hasFocused = $derived(Boolean(focusedWinId));
  let hasWindows = $derived(openWindows.length > 0);
</script>

<svelte:window onpointerdown={handleWindowPointerDown} onkeydown={handleWindowKeydown} />

<header class="macos-menubar workspace-header" bind:this={barEl}>
  <div class="menubar-left" role="menubar" aria-label="Application menus">
    <div class="menu-group">
      <button
        type="button"
        role="menuitem"
        class="menu-trigger menu-brand-trigger"
        class:open={openMenu === "mso"}
        aria-label="MSO menu"
        aria-haspopup="menu"
        aria-expanded={openMenu === "mso"}
        onclick={() => toggleMenu("mso")}
        onmouseenter={() => hoverMenu("mso")}
      >
        <img src="/icon.svg" alt="" width="15" height="15" class="brand-icon" />
      </button>

      {#if openMenu === "mso"}
        <div class="menu-dropdown" role="menu" aria-label="MSO">
          <button type="button" role="menuitem" onclick={() => runAction(() => onOpenApp("settings", "Settings"))}>
            <span>About MSO</span>
          </button>
          <button type="button" role="menuitem" onclick={() => runAction(() => onOpenApp("settings", "Settings"))}>
            <span>System Settings...</span>
          </button>
          <button type="button" role="menuitem" onclick={() => runAction(() => onOpenApp("store", "App Store"))}>
            <span>App Store</span>
          </button>
          <div class="menu-sep" role="separator"></div>
          <button type="button" role="menuitem" onclick={() => runAction(onLock)}>
            <span>Lock Screen</span>
          </button>
          <button type="button" role="menuitem" onclick={() => runAction(onForceQuit)}>
            <span>Force Quit...</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!authenticated || signingOut}
            onclick={() => runAction(onSignOut)}
          >
            <span>{signingOut ? "Signing Out..." : "Sign Out"}</span>
          </button>
        </div>
      {/if}
    </div>

    <div class="menu-group">
      <button
        type="button"
        role="menuitem"
        class="menu-trigger menu-app-trigger"
        class:open={openMenu === "app"}
        aria-haspopup="menu"
        aria-expanded={openMenu === "app"}
        onclick={() => toggleMenu("app")}
        onmouseenter={() => hoverMenu("app")}
      >
        <span class="app-title-text">{focusedTitle}</span>
      </button>

      {#if openMenu === "app"}
        <div class="menu-dropdown" role="menu" aria-label={focusedTitle}>
          <button type="button" role="menuitem" disabled={!hasFocused} onclick={() => runAction(onMinimizeFocused)}>
            <span>Minimize Window</span>
            <kbd>Cmd+M</kbd>
          </button>
          <button type="button" role="menuitem" disabled={!hasFocused} onclick={() => runAction(onMaximizeFocused)}>
            <span>Maximize / Restore</span>
          </button>
          <div class="menu-sep" role="separator"></div>
          <button type="button" role="menuitem" disabled={!hasFocused} onclick={() => runAction(onCloseFocused)}>
            <span>Close Window</span>
            <kbd>Cmd+W</kbd>
          </button>
        </div>
      {/if}
    </div>

    <div class="menu-group">
      <button
        type="button"
        role="menuitem"
        class="menu-trigger"
        class:open={openMenu === "file"}
        aria-haspopup="menu"
        aria-expanded={openMenu === "file"}
        onclick={() => toggleMenu("file")}
        onmouseenter={() => hoverMenu("file")}
      >
        File
      </button>

      {#if openMenu === "file"}
        <div class="menu-dropdown" role="menu" aria-label="File">
          <button type="button" role="menuitem" onclick={() => runAction(() => onOpenApp("files", "Files", "~", true))}>
            <span>New Files Window</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onclick={() => runAction(() => onOpenApp("editor", "Code Editor", undefined, true))}
          >
            <span>New Code Editor</span>
          </button>
          <button type="button" role="menuitem" onclick={() => runAction(() => onOpenApp("terminal", "Terminal"))}>
            <span>New Terminal</span>
          </button>
          <div class="menu-sep" role="separator"></div>
          <button
            type="button"
            role="menuitem"
            onclick={() => runAction(() => onOpenApp("assistant", "Alfa Assistant"))}
          >
            <span>Alfa Assistant</span>
          </button>
        </div>
      {/if}
    </div>

    <div class="menu-group">
      <button
        type="button"
        role="menuitem"
        class="menu-trigger"
        class:open={openMenu === "view"}
        aria-haspopup="menu"
        aria-expanded={openMenu === "view"}
        onclick={() => toggleMenu("view")}
        onmouseenter={() => hoverMenu("view")}
      >
        View
      </button>

      {#if openMenu === "view"}
        <div class="menu-dropdown" role="menu" aria-label="View">
          <button type="button" role="menuitem" onclick={() => runAction(() => onThemeChange("light"))}>
            <span class="menu-check" aria-hidden="true">{themeMode === "light" ? "✓" : ""}</span>
            <span>Light Theme</span>
          </button>
          <button type="button" role="menuitem" onclick={() => runAction(() => onThemeChange("dark"))}>
            <span class="menu-check" aria-hidden="true">{themeMode === "dark" ? "✓" : ""}</span>
            <span>Dark Theme</span>
          </button>
          <button type="button" role="menuitem" onclick={() => runAction(() => onThemeChange("system"))}>
            <span class="menu-check" aria-hidden="true">{themeMode === "system" ? "✓" : ""}</span>
            <span>System Theme</span>
          </button>
          <div class="menu-sep" role="separator"></div>
          <div class="menu-section-label">Switch Shell</div>
          {#each CHROME_PROFILES as profile (profile.id)}
            <button type="button" role="menuitem" onclick={() => runAction(() => onChromeChange(profile.id))}>
              <span class="menu-check" aria-hidden="true">{resolvedChrome === profile.id ? "✓" : ""}</span>
              <span>{profile.label}</span>
            </button>
          {/each}
          <div class="menu-sep" role="separator"></div>
          <button type="button" role="menuitem" onclick={() => runAction(onLaunchpad)}>
            <span>Launchpad</span>
          </button>
          <button type="button" role="menuitem" onclick={() => runAction(onMissionControl)}>
            <span>Mission Control</span>
          </button>
          <button type="button" role="menuitem" onclick={() => runAction(onCycleWallpaper)}>
            <span>Change Wallpaper</span>
          </button>
        </div>
      {/if}
    </div>

    <div class="menu-group">
      <button
        type="button"
        role="menuitem"
        class="menu-trigger"
        class:open={openMenu === "window"}
        aria-haspopup="menu"
        aria-expanded={openMenu === "window"}
        onclick={() => toggleMenu("window")}
        onmouseenter={() => hoverMenu("window")}
      >
        Window
      </button>

      {#if openMenu === "window"}
        <div class="menu-dropdown" role="menu" aria-label="Window">
          <button type="button" role="menuitem" disabled={!hasFocused} onclick={() => runAction(onMinimizeFocused)}>
            <span>Minimize</span>
            <kbd>Cmd+M</kbd>
          </button>
          <button type="button" role="menuitem" disabled={!hasFocused} onclick={() => runAction(onMaximizeFocused)}>
            <span>Maximize / Restore</span>
          </button>
          <div class="menu-sep" role="separator"></div>
          <button type="button" role="menuitem" disabled={!hasWindows} onclick={() => runAction(onCascade)}>
            <span>Cascade Windows</span>
          </button>
          <button type="button" role="menuitem" disabled={!hasWindows} onclick={() => runAction(onTile)}>
            <span>Tile Windows</span>
          </button>
          <button type="button" role="menuitem" disabled={!hasWindows} onclick={() => runAction(onMinimizeAll)}>
            <span>Minimize All</span>
          </button>
          {#if openWindows.length > 0}
            <div class="menu-sep" role="separator"></div>
            {#each openWindows as win (win.id)}
              <button type="button" role="menuitem" onclick={() => runAction(() => onFocusWindow(win.id))}>
                <span class="menu-check" aria-hidden="true">
                  {win.id === focusedWinId ? "✓" : win.minimized ? "◆" : ""}
                </span>
                <span class="menu-win-title">{win.title}</span>
              </button>
            {/each}
          {/if}
        </div>
      {/if}
    </div>

    <div class="menu-group">
      <button
        type="button"
        role="menuitem"
        class="menu-trigger"
        class:open={openMenu === "help"}
        aria-haspopup="menu"
        aria-expanded={openMenu === "help"}
        onclick={() => toggleMenu("help")}
        onmouseenter={() => hoverMenu("help")}
      >
        Help
      </button>

      {#if openMenu === "help"}
        <div class="menu-dropdown" role="menu" aria-label="Help">
          <button type="button" role="menuitem" onclick={() => runAction(onCommandPalette)}>
            <span>Command Palette</span>
            <kbd>Cmd+K</kbd>
          </button>
          <button type="button" role="menuitem" onclick={() => runAction(onShortcuts)}>
            <span>Keyboard Shortcuts</span>
            <kbd>?</kbd>
          </button>
          <div class="menu-sep" role="separator"></div>
          <button type="button" role="menuitem" onclick={() => runAction(() => onOpenApp("docs", "Docs"))}>
            <span>Docs & Changelog</span>
          </button>
        </div>
      {/if}
    </div>
  </div>

  <div class="menubar-right session-actions">
    <button type="button" class="status-btn" onclick={onCommandPalette}>Commands</button>
    <button type="button" class="status-btn" onclick={onControlCenter}>Controls</button>
    <button type="button" class="status-btn" onclick={onShortcuts}>Shortcuts</button>
    <select
      aria-label="Shell chrome"
      class="status-select"
      value={chromeChoice}
      onchange={handleChromeSelect}
    >
      <option value="auto">Auto ({resolvedChrome})</option>
      {#each CHROME_PROFILES as p (p.id)}
        <option value={p.id}>{p.label}</option>
      {/each}
    </select>
    {#if authenticated && role}
      <span class="role-badge mac-role">{role}</span>
    {/if}
    {#if authenticated}
      <button type="button" class="status-btn" disabled={signingOut} onclick={onSignOut}>
        {signingOut ? "Signing out..." : "Sign out"}
      </button>
    {/if}
    <time class="menubar-clock header-clock" datetime={clockNow.toISOString()}>
      {formattedClock}
    </time>
  </div>
</header>

<style>
  .macos-menubar {
    position: sticky;
    top: 0;
    z-index: 8100;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    min-height: 30px;
    padding: 0 0.625rem;
    color: #ffffff;
    font-size: 13px;
    font-weight: 500;
    line-height: 1;
    background: rgba(20, 22, 30, 0.72);
    border-bottom: 1px solid rgba(255, 255, 255, 0.14);
    backdrop-filter: blur(24px) saturate(180%);
    -webkit-backdrop-filter: blur(24px) saturate(180%);
    user-select: none;
    flex-wrap: wrap;
    max-width: 100%;
  }

  .menubar-left {
    display: flex;
    align-items: center;
    gap: 0.125rem;
    min-width: 0;
    flex-wrap: wrap;
  }

  .menu-group {
    position: relative;
    display: flex;
    align-items: center;
  }

  .menu-trigger {
    min-height: 24px;
    height: 24px;
    padding: 0 0.5rem;
    border: 0;
    border-radius: 0.375rem;
    background: transparent;
    color: #ffffff;
    font-size: 13px;
    font-weight: 500;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    white-space: nowrap;
  }

  .menu-brand-trigger {
    padding: 0 0.45rem;
  }

  .brand-icon {
    display: block;
    width: 15px;
    height: 15px;
    border-radius: 3px;
  }

  .menu-app-trigger {
    font-weight: 700;
  }

  .app-title-text {
    max-width: 10rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .menu-trigger:hover,
  .menu-trigger.open {
    background: rgba(255, 255, 255, 0.2);
  }

  .menu-trigger:focus-visible,
  .status-btn:focus-visible,
  .status-select:focus-visible {
    outline: 2px solid #ffffff;
    outline-offset: -2px;
  }

  .menu-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 8200;
    min-width: 224px;
    max-width: calc(100vw - 16px);
    max-height: 70vh;
    overflow-y: auto;
    padding: 5px;
    border-radius: 12px;
    color: #1a1a1d;
    background: rgba(250, 250, 253, 0.88);
    border: 1px solid rgba(255, 255, 255, 0.48);
    box-shadow:
      inset 0 0 0 0.5px rgba(255, 255, 255, 0.2),
      0 12px 40px rgba(0, 0, 0, 0.32);
    backdrop-filter: blur(24px) saturate(180%);
    -webkit-backdrop-filter: blur(24px) saturate(180%);
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .menu-dropdown {
      color: #f5f5f7;
      background: rgba(38, 38, 44, 0.92);
      border-color: rgba(255, 255, 255, 0.18);
      box-shadow:
        inset 0 0 0 0.5px rgba(255, 255, 255, 0.14),
        0 14px 48px rgba(0, 0, 0, 0.55);
    }
  }

  :global(:root[data-theme="dark"]) .menu-dropdown {
    color: #f5f5f7;
    background: rgba(38, 38, 44, 0.92);
    border-color: rgba(255, 255, 255, 0.18);
    box-shadow:
      inset 0 0 0 0.5px rgba(255, 255, 255, 0.14),
      0 14px 48px rgba(0, 0, 0, 0.55);
  }

  .menu-dropdown [role="menuitem"] {
    width: 100%;
    min-height: 26px;
    padding: 4px 9px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: inherit;
    font-size: 13px;
    font-weight: 500;
    line-height: 1.25;
    text-align: left;
    display: flex;
    align-items: center;
    gap: 0.375rem;
    justify-content: flex-start;
  }

  .menu-dropdown [role="menuitem"]:hover:not(:disabled),
  .menu-dropdown [role="menuitem"]:focus-visible:not(:disabled) {
    background: #0062e6;
    color: #ffffff;
    outline: none;
  }

  .menu-dropdown [role="menuitem"]:disabled {
    opacity: 0.42;
    cursor: default;
  }

  .menu-dropdown kbd {
    margin-left: auto;
    font-family: inherit;
    font-size: 11px;
    opacity: 0.72;
  }

  .menu-dropdown [role="menuitem"]:hover:not(:disabled) kbd,
  .menu-dropdown [role="menuitem"]:focus-visible:not(:disabled) kbd {
    opacity: 0.95;
  }

  .menu-check {
    width: 0.9rem;
    text-align: center;
    flex-shrink: 0;
    font-size: 11px;
  }

  .menu-win-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .menu-sep {
    height: 1px;
    margin: 4px 6px;
    background: rgba(0, 0, 0, 0.12);
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .menu-sep {
      background: rgba(255, 255, 255, 0.14);
    }
  }

  :global(:root[data-theme="dark"]) .menu-sep {
    background: rgba(255, 255, 255, 0.14);
  }

  .menu-section-label {
    padding: 3px 9px 2px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.65;
  }

  .menubar-right {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-wrap: wrap;
    min-width: 0;
  }

  .status-btn,
  .status-select {
    min-height: 22px;
    height: 22px;
    padding: 0 0.45rem;
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
    color: #ffffff;
    background: rgba(255, 255, 255, 0.12);
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 0.35rem;
  }

  .status-btn:hover:not(:disabled),
  .status-select:hover {
    background: rgba(255, 255, 255, 0.22);
  }

  .status-select option {
    background: #1c1c22;
    color: #f8fafc;
  }

  .mac-role {
    color: #ffffff;
    border-color: rgba(255, 255, 255, 0.3);
    background: rgba(255, 255, 255, 0.1);
  }

  .menubar-clock {
    font-size: 12px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: #ffffff;
    padding: 0 0.25rem;
    white-space: nowrap;
  }

  @media (max-width: 40rem) {
    .macos-menubar {
      padding: 0.25rem 0.5rem;
      gap: 0.25rem;
    }

    .app-title-text {
      max-width: 6.5rem;
    }
  }
</style>
