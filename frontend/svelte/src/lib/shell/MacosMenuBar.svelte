<script lang="ts">
  import {
    CHROME_PROFILES,
    isChromeChoice,
    type ChromeChoice,
    type ChromeProfile,
  } from "./chrome-profile.ts";
  import type { WindowState } from "./window-store.ts";

  type ThemeMode = "system" | "light" | "dark";
  type MenuId = "mso" | "app" | "file" | "edit" | "view" | "window" | "help";

  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  function formatMacClock(now: Date): string {
    const hh = now.getHours();
    const mm = String(now.getMinutes()).padStart(2, "0");
    const t12 = `${(hh % 12) || 12}:${mm}`;
    const stamp = `${WEEKDAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`;
    return `${stamp}  ${t12} ${hh < 12 ? "AM" : "PM"}`;
  }

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

  type BatteryLike = {
    readonly level: number;
    readonly charging: boolean;
    addEventListener: (type: "levelchange" | "chargingchange", handler: () => void) => void;
  };
  type BatteryCapableNavigator = Navigator & { getBattery?: () => Promise<BatteryLike> };

  let openMenu = $state<MenuId | null>(null);
  let barEl = $state<HTMLElement | null>(null);
  let clockNow = $state(new Date());
  let batteryLevel = $state<number | null>(null);
  let batteryCharging = $state(false);
  let hostOnline = $state(true);

  let formattedClock = $derived(formatMacClock(clockNow));
  let batteryPct = $derived(batteryLevel === null ? null : Math.round(batteryLevel * 100));

  $effect(() => {
    const timer = setInterval(() => {
      clockNow = new Date();
    }, 30_000);
    return () => clearInterval(timer);
  });

  $effect(() => {
    if (typeof navigator === "undefined") return;
    const api = (navigator as BatteryCapableNavigator).getBattery;
    if (typeof api !== "function") return;
    let cancelled = false;
    let manager: BatteryLike | null = null;
    const sync = () => {
      if (cancelled || !manager) return;
      if (!Number.isFinite(manager.level)) return;
      batteryLevel = Math.min(1, Math.max(0, manager.level));
      batteryCharging = Boolean(manager.charging);
    };
    void api
      .call(navigator)
      .then((battery) => {
        if (cancelled) return;
        manager = battery;
        sync();
        battery.addEventListener("levelchange", sync);
        battery.addEventListener("chargingchange", sync);
      })
      .catch(() => {
        batteryLevel = null;
      });
    return () => {
      cancelled = true;
      manager = null;
    };
  });

  $effect(() => {
    if (typeof window === "undefined") return;
    hostOnline = window.navigator.onLine;
    const sync = () => {
      hostOnline = window.navigator.onLine;
    };
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
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

  function runEditCommand(cmd: "undo" | "redo" | "cut" | "copy" | "selectAll") {
    closeMenus();
    if (typeof document !== "undefined" && typeof document.execCommand === "function") {
      try {
        document.execCommand(cmd);
      } catch {
        /* browser may block execCommand outside editable selection */
      }
    }
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
        title={role ? `MSO (${role})` : "MSO"}
        aria-haspopup="menu"
        aria-expanded={openMenu === "mso"}
        onclick={() => toggleMenu("mso")}
        onmouseenter={() => hoverMenu("mso")}
      >
        <svg viewBox="0 0 24 24" width="15" height="15" class="brand-glyph" fill="currentColor" aria-hidden="true">
          <path
            d="M15.9 12.7c0-2 1.5-2.9 1.6-3-0.9-1.3-2.2-1.4-2.7-1.5-1.1-0.1-2.2 0.7-2.8 0.7-0.6 0-1.5-0.6-2.4-0.6-1.2 0-2.4 0.7-3 1.8-1.3 2.2-0.3 5.5 0.9 7.3 0.6 0.9 1.3 1.9 2.2 1.8 0.9 0 1.2-0.6 2.3-0.6s1.4 0.6 2.4 0.5c1 0 1.6-0.9 2.2-1.8 0.7-1 1-2 1-2-0.1 0-1.9-0.7-1.9-2.9z"
          />
          <path
            d="M14.2 6.9c0.5-0.6 0.8-1.4 0.7-2.3-0.7 0-1.6 0.5-2.1 1.1-0.5 0.5-0.9 1.4-0.8 2.2 0.8 0.1 1.6-0.4 2.2-1z"
          />
        </svg>
      </button>

      {#if openMenu === "mso"}
        <div class="menu-dropdown" role="menu" aria-label="MSO">
          <button type="button" role="menuitem" onclick={() => runAction(() => onOpenApp("settings", "Settings"))}>
            <span>About This MSO</span>
            {#if authenticated && role}
              <kbd class="role-kbd">{role}</kbd>
            {/if}
          </button>
          <div class="menu-sep" role="separator"></div>
          <button type="button" role="menuitem" onclick={() => runAction(() => onOpenApp("settings", "Settings"))}>
            <span>System Settings...</span>
            <kbd>Cmd+,</kbd>
          </button>
          <button type="button" role="menuitem" onclick={() => runAction(() => onOpenApp("store", "App Store"))}>
            <span>App Store...</span>
          </button>
          <div class="menu-sep" role="separator"></div>
          <button type="button" role="menuitem" onclick={() => runAction(onForceQuit)}>
            <span>Force Quit...</span>
          </button>
          <div class="menu-sep" role="separator"></div>
          <button type="button" role="menuitem" onclick={() => runAction(onLock)}>
            <span>Lock Screen</span>
            <kbd>Ctrl+Cmd+Q</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!authenticated || signingOut}
            onclick={() => runAction(onSignOut)}
          >
            <span>{signingOut ? "Signing Out..." : "Log Out..."}</span>
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
          <button type="button" role="menuitem" onclick={() => runAction(() => onOpenApp("settings", "Settings"))}>
            <span>Settings...</span>
            <kbd>Cmd+,</kbd>
          </button>
          <div class="menu-sep" role="separator"></div>
          <button type="button" role="menuitem" disabled={!hasFocused} onclick={() => runAction(onMinimizeFocused)}>
            <span>Minimize {focusedTitle}</span>
            <kbd>Cmd+M</kbd>
          </button>
          <button type="button" role="menuitem" disabled={!hasFocused} onclick={() => runAction(onMaximizeFocused)}>
            <span>Zoom</span>
          </button>
          <div class="menu-sep" role="separator"></div>
          <button type="button" role="menuitem" disabled={!hasFocused} onclick={() => runAction(onCloseFocused)}>
            <span>Quit {focusedTitle}</span>
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
            <kbd>Cmd+N</kbd>
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
        class:open={openMenu === "edit"}
        aria-haspopup="menu"
        aria-expanded={openMenu === "edit"}
        onclick={() => toggleMenu("edit")}
        onmouseenter={() => hoverMenu("edit")}
      >
        Edit
      </button>

      {#if openMenu === "edit"}
        <div class="menu-dropdown" role="menu" aria-label="Edit">
          <button type="button" role="menuitem" onclick={() => runEditCommand("undo")}>
            <span>Undo</span>
            <kbd>Cmd+Z</kbd>
          </button>
          <button type="button" role="menuitem" onclick={() => runEditCommand("redo")}>
            <span>Redo</span>
            <kbd>Shift+Cmd+Z</kbd>
          </button>
          <div class="menu-sep" role="separator"></div>
          <button type="button" role="menuitem" onclick={() => runEditCommand("cut")}>
            <span>Cut</span>
            <kbd>Cmd+X</kbd>
          </button>
          <button type="button" role="menuitem" onclick={() => runEditCommand("copy")}>
            <span>Copy</span>
            <kbd>Cmd+C</kbd>
          </button>
          <button type="button" role="menuitem" onclick={() => runEditCommand("selectAll")}>
            <span>Select All</span>
            <kbd>Cmd+A</kbd>
          </button>
          <div class="menu-sep" role="separator"></div>
          <button type="button" role="menuitem" onclick={() => runAction(onCommandPalette)}>
            <span>Find Command...</span>
            <kbd>Cmd+K</kbd>
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
            <span>Use Light Appearance</span>
          </button>
          <button type="button" role="menuitem" onclick={() => runAction(() => onThemeChange("dark"))}>
            <span class="menu-check" aria-hidden="true">{themeMode === "dark" ? "✓" : ""}</span>
            <span>Use Dark Appearance</span>
          </button>
          <button type="button" role="menuitem" onclick={() => runAction(() => onThemeChange("system"))}>
            <span class="menu-check" aria-hidden="true">{themeMode === "system" ? "✓" : ""}</span>
            <span>Auto Appearance</span>
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
            <span>Zoom</span>
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
            <span>{focusedTitle} Help</span>
          </button>
        </div>
      {/if}
    </div>
  </div>

  <div class="menubar-right session-actions">
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

    <button
      type="button"
      class="status-icon-btn"
      aria-label="Controls"
      title="Control Center"
      onclick={onControlCenter}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 8h9M17 8h3M4 16h3M11 16h9" />
        <circle cx="15" cy="8" r="2.3" fill="currentColor" stroke="none" />
        <circle cx="9" cy="16" r="2.3" fill="currentColor" stroke="none" />
      </svg>
    </button>

    <span
      class="status-glyph"
      class:is-offline={!hostOnline}
      title={hostOnline ? "Host reachable" : "Host offline"}
      data-host-online={hostOnline ? "true" : "false"}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M2.8 8.5a14 14 0 0 1 18.4 0" />
        <path d="M5.7 12a10 10 0 0 1 12.6 0" />
        <path d="M8.6 15.4a5.6 5.6 0 0 1 6.8 0" />
        <circle cx="12" cy="18.8" r="1.1" fill="currentColor" stroke="none" />
      </svg>
    </span>

    {#if batteryPct !== null}
      <span
        class="status-battery"
        class:is-charging={batteryCharging}
        title={batteryCharging ? `Battery ${batteryPct}% (charging)` : `Battery ${batteryPct}%`}
        data-battery-pct={batteryPct}
      >
        <span class="battery-pct">{batteryPct}%</span>
        <span class="battery-shell">
          <span class="battery-fill" style:width={`${Math.max(6, batteryPct)}%`}></span>
        </span>
      </span>
    {/if}

    <button
      type="button"
      class="status-icon-btn"
      aria-label="Commands"
      title="Spotlight Search (Cmd+K)"
      onclick={onCommandPalette}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-4-4" />
      </svg>
    </button>

    <button
      type="button"
      class="status-icon-btn"
      aria-label="Shortcuts"
      title="Keyboard Shortcuts (?)"
      onclick={onShortcuts}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />
      </svg>
    </button>

    {#if authenticated}
      <button
        type="button"
        class="status-signout-btn"
        aria-label="Sign out"
        disabled={signingOut}
        onclick={onSignOut}
      >
        {signingOut ? "Signing out..." : "Sign out"}
      </button>
    {/if}

    <time class="menubar-clock header-clock" datetime={clockNow.toISOString()}>
      {formattedClock}
    </time>
  </div>
</header>

<style>
  .macos-menubar.workspace-header {
    position: sticky;
    top: 0;
    z-index: 8100;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1px;
    height: 26px;
    min-height: 26px;
    padding: 0 9px;
    color: var(--label, #1c1c1e);
    font-size: 13px;
    font-weight: 400;
    line-height: 1;
    background: var(--menubar, rgba(255, 255, 255, 0.42));
    border-bottom: 0.5px solid var(--sep, rgba(60, 60, 67, 0.16));
    -webkit-backdrop-filter: blur(var(--blur, 26px)) saturate(180%);
    backdrop-filter: blur(var(--blur, 26px)) saturate(180%);
    user-select: none;
    flex-wrap: nowrap;
    max-width: 100%;
    letter-spacing: -0.01em;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .macos-menubar.workspace-header {
      color: var(--label, #ffffff);
      background: var(--menubar, rgba(0, 0, 0, 0.3));
      border-bottom-color: var(--sep, rgba(255, 255, 255, 0.1));
    }
  }

  :global(:root[data-theme="dark"]) .macos-menubar.workspace-header {
    color: var(--label, #ffffff);
    background: var(--menubar, rgba(0, 0, 0, 0.3));
    border-bottom-color: var(--sep, rgba(255, 255, 255, 0.1));
  }

  .menubar-left {
    display: flex;
    align-items: center;
    gap: 1px;
    min-width: 0;
    flex-wrap: nowrap;
  }

  .menu-group {
    position: relative;
    display: flex;
    align-items: center;
  }

  .macos-menubar .menu-trigger {
    min-height: 19px;
    height: 19px;
    padding: 0 9px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: inherit;
    font-size: 13px;
    font-weight: 400;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
    cursor: default;
  }

  .macos-menubar .menu-brand-trigger {
    padding: 0 8px;
  }

  .brand-glyph {
    display: block;
    color: inherit;
  }

  .macos-menubar .menu-app-trigger {
    font-weight: 600;
  }

  .app-title-text {
    max-width: 11rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .macos-menubar .menu-trigger:hover,
  .macos-menubar .menu-trigger.open {
    background: var(--fill, rgba(118, 118, 128, 0.12));
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .macos-menubar .menu-trigger:hover,
    :global(:root:not([data-theme="light"])) .macos-menubar .menu-trigger.open {
      background: var(--fill, rgba(120, 120, 128, 0.24));
    }
  }

  :global(:root[data-theme="dark"]) .macos-menubar .menu-trigger:hover,
  :global(:root[data-theme="dark"]) .macos-menubar .menu-trigger.open {
    background: var(--fill, rgba(120, 120, 128, 0.24));
  }

  .macos-menubar .menu-trigger:focus-visible,
  .macos-menubar .status-icon-btn:focus-visible,
  .macos-menubar .status-signout-btn:focus-visible,
  .macos-menubar .status-select:focus-visible {
    outline: 2px solid var(--tint, var(--accent, #007aff));
    outline-offset: -1px;
  }

  .menu-dropdown {
    position: absolute;
    top: 24px;
    left: 0;
    z-index: 20;
    min-width: 220px;
    max-width: calc(100vw - 16px);
    max-height: 70vh;
    overflow-y: auto;
    padding: 5px;
    border-radius: 10px;
    color: var(--label, #1c1c1e);
    background: var(--glass-bg, rgba(252, 252, 254, 0.62));
    border: 0.5px solid var(--glass-stroke, rgba(255, 255, 255, 0.7));
    box-shadow:
      0 14px 44px var(--glass-shadow, rgba(0, 0, 0, 0.18)),
      inset 0 0.5px 0 var(--glass-hi, rgba(255, 255, 255, 0.95));
    -webkit-backdrop-filter: blur(28px) saturate(180%);
    backdrop-filter: blur(28px) saturate(180%);
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .menu-dropdown {
      color: var(--label, #ffffff);
      background: var(--glass-bg, rgba(44, 44, 50, 0.55));
      border-color: var(--glass-stroke, rgba(255, 255, 255, 0.14));
      box-shadow:
        0 14px 44px var(--glass-shadow, rgba(0, 0, 0, 0.55)),
        inset 0 0.5px 0 var(--glass-hi, rgba(255, 255, 255, 0.2));
    }
  }

  :global(:root[data-theme="dark"]) .menu-dropdown {
    color: var(--label, #ffffff);
    background: var(--glass-bg, rgba(44, 44, 50, 0.55));
    border-color: var(--glass-stroke, rgba(255, 255, 255, 0.14));
    box-shadow:
      0 14px 44px var(--glass-shadow, rgba(0, 0, 0, 0.55)),
      inset 0 0.5px 0 var(--glass-hi, rgba(255, 255, 255, 0.2));
  }

  .macos-menubar .menu-dropdown [role="menuitem"] {
    width: 100%;
    min-height: 24px;
    height: auto;
    padding: 4px 10px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: inherit;
    font-size: 13px;
    font-weight: 400;
    line-height: 1.25;
    text-align: left;
    display: flex;
    align-items: center;
    gap: 6px;
    justify-content: flex-start;
    cursor: default;
  }

  .macos-menubar .menu-dropdown [role="menuitem"]:hover:not(:disabled),
  .macos-menubar .menu-dropdown [role="menuitem"]:focus-visible:not(:disabled) {
    background: var(--tint, var(--accent, #007aff));
    color: #ffffff;
    outline: none;
  }

  .macos-menubar .menu-dropdown [role="menuitem"]:disabled {
    opacity: 0.42;
    cursor: default;
  }

  .menu-dropdown kbd {
    margin-left: auto;
    padding-left: 16px;
    font-family: inherit;
    font-size: 12px;
    opacity: 0.55;
  }

  .role-kbd {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 10.5px;
    font-weight: 600;
  }

  .menu-dropdown [role="menuitem"]:hover:not(:disabled) kbd,
  .menu-dropdown [role="menuitem"]:focus-visible:not(:disabled) kbd {
    opacity: 0.92;
  }

  .menu-check {
    width: 14px;
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
    height: 0.5px;
    margin: 5px 8px;
    background: var(--sep, rgba(60, 60, 67, 0.16));
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .menu-sep {
      background: var(--sep, rgba(255, 255, 255, 0.1));
    }
  }

  :global(:root[data-theme="dark"]) .menu-sep {
    background: var(--sep, rgba(255, 255, 255, 0.1));
  }

  .menu-section-label {
    padding: 3px 10px 2px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--label2, rgba(60, 60, 67, 0.6));
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .menu-section-label {
      color: var(--label2, rgba(235, 235, 245, 0.6));
    }
  }

  :global(:root[data-theme="dark"]) .menu-section-label {
    color: var(--label2, rgba(235, 235, 245, 0.6));
  }

  .menubar-right.session-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: nowrap;
    min-width: 0;
    font-size: 12.5px;
    font-weight: 500;
    white-space: nowrap;
  }

  .macos-menubar .status-select {
    min-height: 20px;
    height: 20px;
    padding: 0 6px;
    font-size: 11.5px;
    font-weight: 500;
    line-height: 1;
    color: inherit;
    background: transparent;
    border: 0;
    border-radius: 5px;
    cursor: default;
    -webkit-appearance: none;
    appearance: none;
  }

  .macos-menubar .status-select:hover,
  .macos-menubar .status-select:focus-visible {
    background: var(--fill, rgba(118, 118, 128, 0.12));
  }

  .macos-menubar .status-select option {
    background: var(--elev, #ffffff);
    color: var(--label, #1c1c1e);
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .macos-menubar .status-select {
      background: transparent;
    }
    :global(:root:not([data-theme="light"])) .macos-menubar .status-select:hover,
    :global(:root:not([data-theme="light"])) .macos-menubar .status-select:focus-visible {
      background: var(--fill, rgba(120, 120, 128, 0.24));
    }
    :global(:root:not([data-theme="light"])) .macos-menubar .status-select option {
      background: var(--elev, #2c2c2e);
      color: var(--label, #ffffff);
    }
  }

  :global(:root[data-theme="dark"]) .macos-menubar .status-select {
    background: transparent;
  }

  :global(:root[data-theme="dark"]) .macos-menubar .status-select:hover,
  :global(:root[data-theme="dark"]) .macos-menubar .status-select:focus-visible {
    background: var(--fill, rgba(120, 120, 128, 0.24));
  }

  :global(:root[data-theme="dark"]) .macos-menubar .status-select option {
    background: var(--elev, #2c2c2e);
    color: var(--label, #ffffff);
  }

  .macos-menubar .status-icon-btn {
    min-height: 20px;
    height: 20px;
    min-width: 22px;
    padding: 0 4px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: inherit;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .macos-menubar .status-icon-btn:hover {
    background: var(--fill, rgba(118, 118, 128, 0.12));
  }

  .status-glyph {
    display: inline-flex;
    align-items: center;
    color: inherit;
    opacity: 0.92;
  }

  .status-glyph.is-offline {
    opacity: 0.55;
    color: var(--label2, rgba(60, 60, 67, 0.6));
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .status-glyph.is-offline {
      color: var(--label2, rgba(235, 235, 245, 0.6));
    }
  }

  :global(:root[data-theme="dark"]) .status-glyph.is-offline {
    color: var(--label2, rgba(235, 235, 245, 0.6));
  }

  .status-battery {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    color: inherit;
  }

  .status-battery.is-charging {
    color: #248a3d;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .status-battery.is-charging {
      color: #32d74b;
    }
  }

  :global(:root[data-theme="dark"]) .status-battery.is-charging {
    color: #32d74b;
  }

  .battery-shell {
    position: relative;
    display: inline-block;
    width: 23px;
    height: 11.5px;
    border-radius: 3px;
    border: 1px solid currentColor;
    opacity: 0.9;
  }

  .battery-shell::after {
    content: "";
    position: absolute;
    right: -3px;
    top: 3px;
    width: 1.5px;
    height: 4px;
    border-radius: 0 1px 1px 0;
    background: currentColor;
    opacity: 0.7;
  }

  .battery-fill {
    position: absolute;
    top: 1.5px;
    left: 1.5px;
    bottom: 1.5px;
    background: currentColor;
    border-radius: 1px;
    transition: width 240ms ease;
  }

  .macos-menubar .status-signout-btn {
    min-height: 19px;
    height: 19px;
    padding: 0 7px;
    border-radius: 5px;
    border: 0;
    background: transparent;
    color: inherit;
    font-size: 11.5px;
    font-weight: 500;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    white-space: nowrap;
    cursor: default;
  }

  .macos-menubar .status-signout-btn:hover:not(:disabled),
  .macos-menubar .status-signout-btn:focus-visible {
    background: var(--fill, rgba(118, 118, 128, 0.12));
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .macos-menubar .status-icon-btn:hover,
    :global(:root:not([data-theme="light"])) .macos-menubar .status-signout-btn:hover:not(:disabled),
    :global(:root:not([data-theme="light"])) .macos-menubar .status-signout-btn:focus-visible {
      background: var(--fill, rgba(120, 120, 128, 0.24));
    }
  }

  :global(:root[data-theme="dark"]) .macos-menubar .status-icon-btn:hover,
  :global(:root[data-theme="dark"]) .macos-menubar .status-signout-btn:hover:not(:disabled),
  :global(:root[data-theme="dark"]) .macos-menubar .status-signout-btn:focus-visible {
    background: var(--fill, rgba(120, 120, 128, 0.24));
  }

  .macos-menubar .menubar-clock.header-clock {
    font-size: 12.5px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    color: inherit;
    padding: 0 2px;
    white-space: nowrap;
  }

  @media (max-width: 52rem) {
    .status-battery,
    .status-glyph {
      display: none;
    }

    .menubar-right.session-actions {
      gap: 6px;
    }
  }

  @media (max-width: 40rem) {
    .macos-menubar.workspace-header {
      padding: 0 6px;
      gap: 4px;
    }

    .menubar-right.session-actions {
      width: auto;
      justify-content: flex-end;
    }

    .app-title-text {
      max-width: 6.5rem;
    }

    .macos-menubar .menu-group:nth-child(n + 4) {
      display: none;
    }
  }
</style>
