<script lang="ts">
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
    authenticated,
    role = null,
    dockApps,
    openAppSet,
    focusedApp = null,
    minimizedWindows = [],
    startOpen = false,
    chromeChoice,
    resolvedChrome,
    signingOut = false,
    onToggleStart,
    onOpenApp,
    onToggleApp,
    onCommandPalette,
    onMissionControl,
    onControlCenter,
    onShortcuts,
    onChromeChange,
    onRestoreWindow,
    onMinimizeAll,
    onSignOut,
    onAppContextMenu,
  }: {
    authenticated: boolean;
    role?: string | null;
    dockApps: readonly DockAppDef[];
    openAppSet: ReadonlySet<string>;
    focusedApp?: string | null;
    minimizedWindows?: readonly WindowState[];
    startOpen?: boolean;
    chromeChoice: ChromeChoice;
    resolvedChrome: ChromeProfile;
    signingOut?: boolean;
    onToggleStart: () => void;
    onOpenApp: (app: string, title: string, payload?: unknown, multi?: boolean) => void;
    onToggleApp?: (item: DockAppDef) => void;
    onCommandPalette: () => void;
    onMissionControl: () => void;
    onControlCenter: () => void;
    onShortcuts: () => void;
    onChromeChange: (choice: ChromeChoice) => void;
    onRestoreWindow: (id: string) => void;
    onMinimizeAll: () => void;
    onSignOut: () => void;
    onAppContextMenu?: (event: MouseEvent, item: DockAppDef) => void;
  } = $props();

  let clockNow = $state(new Date());
  let brokenImages = $state<Record<string, boolean>>({});

  let timeText = $derived(
    clockNow.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
  );
  let dateText = $derived(
    clockNow.toLocaleDateString(undefined, { month: "numeric", day: "numeric", year: "numeric" }),
  );

  $effect(() => {
    const timer = setInterval(() => {
      clockNow = new Date();
    }, 30_000);
    return () => clearInterval(timer);
  });

  function handleChromeSelect(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (isChromeChoice(value)) {
      onChromeChange(value);
    }
  }

  function handleContextMenu(event: MouseEvent, item: DockAppDef) {
    if (!onAppContextMenu) return;
    event.preventDefault();
    onAppContextMenu(event, item);
  }

  function handleAppClick(item: DockAppDef) {
    if (onToggleApp) {
      onToggleApp(item);
      return;
    }
    onOpenApp(item.app, item.title, item.payload, item.multi);
  }

  function markBroken(app: string) {
    brokenImages = { ...brokenImages, [app]: true };
  }
</script>

<div class="win-taskbar-shell">
  <nav class="app-dock win-taskbar" aria-label="Workspace apps">
    <div class="tb-main">
      <button
        type="button"
        class="tb-icon-btn tb-start-btn"
        class:active={startOpen}
        aria-label="Start"
        aria-expanded={startOpen}
        title="Start"
        onclick={onToggleStart}
      >
        <svg viewBox="0 0 24 24" class="win-logo" aria-hidden="true">
          <rect x="2" y="2" width="9.2" height="9.2" rx="1.2" fill="#0078d4" />
          <rect x="12.8" y="2" width="9.2" height="9.2" rx="1.2" fill="#0078d4" />
          <rect x="2" y="12.8" width="9.2" height="9.2" rx="1.2" fill="#0078d4" />
          <rect x="12.8" y="12.8" width="9.2" height="9.2" rx="1.2" fill="#0078d4" />
        </svg>
      </button>

      <button
        type="button"
        class="tb-search-btn"
        title="Search commands"
        onclick={onCommandPalette}
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <circle cx="9" cy="9" r="5.5" />
          <path d="M13.5 13.5 17 17" stroke-linecap="round" />
        </svg>
        <span class="tb-search-text">Commands</span>
      </button>

      <button
        type="button"
        class="tb-icon-btn"
        aria-label="Task View"
        title="Task View"
        onclick={onMissionControl}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" class="tb-glyph" aria-hidden="true">
          <rect x="3" y="5" width="11" height="9" rx="1.75" />
          <rect x="10" y="10" width="11" height="9" rx="1.75" />
        </svg>
      </button>

      <div class="tb-apps" role="group" aria-label="Pinned and open apps">
        {#each dockApps as item (item.app)}
          {@const visual = resolveAppIcon(item.app, "windows")}
          {@const running = openAppSet.has(item.app)}
          {@const isFocused = focusedApp === item.app && running}
          {@const showImg = Boolean(visual.image) && !brokenImages[item.app]}
          <div class="tb-app-wrap">
            <span class="tb-tooltip" aria-hidden="true">{item.title}</span>
            <button
              type="button"
              class="tb-icon-btn tb-app-btn"
              class:running
              class:focused={isFocused}
              aria-label={item.label}
              title={item.title}
              onclick={() => handleAppClick(item)}
              oncontextmenu={(e) => handleContextMenu(e, item)}
            >
              <span class="tb-app-icon" style:background={visual.gradient} aria-hidden="true">
                {#if showImg && visual.image}
                  <img
                    src={visual.image}
                    alt=""
                    loading="lazy"
                    draggable="false"
                    onerror={() => markBroken(item.app)}
                  />
                {:else}
                  <span class="tb-app-mono">{visual.monogram}</span>
                {/if}
              </span>
              {#if running}
                <span class="tb-pill" class:focused={isFocused} aria-hidden="true"></span>
              {/if}
            </button>
          </div>
        {/each}

        {#each minimizedWindows as win (win.id)}
          <button
            type="button"
            class="minimized-chip tb-min-chip"
            onclick={() => onRestoreWindow(win.id)}
          >
            Restore {win.title}
          </button>
        {/each}
      </div>
    </div>

    <div class="tb-tray">
      <select
        aria-label="Shell chrome"
        class="tray-select"
        value={chromeChoice}
        onchange={handleChromeSelect}
      >
        <option value="auto">Auto ({resolvedChrome})</option>
        {#each CHROME_PROFILES as p (p.id)}
          <option value={p.id}>{p.label}</option>
        {/each}
      </select>
      <button type="button" class="tray-btn" onclick={onControlCenter}>Controls</button>
      <button type="button" class="tray-btn" onclick={onShortcuts}>Shortcuts</button>
      {#if authenticated && role}
        <span class="role-badge tray-role">{role}</span>
      {/if}
      {#if authenticated}
        <button type="button" class="tray-btn" disabled={signingOut} onclick={onSignOut}>
          {signingOut ? "Signing out..." : "Sign out"}
        </button>
      {/if}
      <time class="tray-clock" datetime={clockNow.toISOString()}>
        <span>{timeText}</span>
        <span>{dateText}</span>
      </time>
      <button
        type="button"
        class="tb-show-desktop"
        aria-label="Show desktop"
        title="Show desktop"
        onclick={onMinimizeAll}
      ></button>
    </div>
  </nav>
</div>

<style>
  .win-taskbar-shell {
    position: sticky;
    bottom: 0;
    z-index: 8100;
    width: 100%;
    max-width: 100%;
    padding-bottom: env(safe-area-inset-bottom);
  }

  .win-taskbar {
    width: 100%;
    max-width: 100%;
    min-height: 48px;
    padding: 0 0.25rem 0 0.5rem;
    border-radius: 0;
    border: 0;
    border-top: 1px solid rgba(0, 0, 0, 0.1);
    background: rgba(243, 243, 246, 0.88);
    color: #1c1c1f;
    box-shadow: 0 -2px 16px rgba(0, 0, 0, 0.08);
    -webkit-backdrop-filter: blur(26px) saturate(180%);
    backdrop-filter: blur(26px) saturate(180%);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    overflow: visible;
    flex-wrap: nowrap;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .win-taskbar {
      background: rgba(25, 25, 29, 0.9);
      color: #f3f3f5;
      border-top-color: rgba(255, 255, 255, 0.12);
      box-shadow: 0 -2px 20px rgba(0, 0, 0, 0.45);
    }
  }

  :global(:root[data-theme="dark"]) .win-taskbar {
    background: rgba(25, 25, 29, 0.9);
    color: #f3f3f5;
    border-top-color: rgba(255, 255, 255, 0.12);
    box-shadow: 0 -2px 20px rgba(0, 0, 0, 0.45);
  }

  .tb-main {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-width: 0;
    flex: 1 1 auto;
  }

  .tb-apps {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    min-width: 0;
    flex: 1 1 auto;
    overflow-x: auto;
    overflow-y: visible;
    scrollbar-width: none;
    padding: 2px 0;
  }

  .tb-apps::-webkit-scrollbar {
    display: none;
  }

  .tb-app-wrap {
    position: relative;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
  }

  .tb-icon-btn {
    position: relative;
    width: 40px;
    height: 40px;
    min-height: 40px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: inherit;
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }

  .tb-icon-btn:hover,
  .tb-icon-btn.active,
  .tb-icon-btn.focused {
    background: rgba(0, 0, 0, 0.07);
    border-color: rgba(0, 0, 0, 0.06);
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .tb-icon-btn:hover,
    :global(:root:not([data-theme="light"])) .tb-icon-btn.active,
    :global(:root:not([data-theme="light"])) .tb-icon-btn.focused {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.08);
    }
  }

  :global(:root[data-theme="dark"]) .tb-icon-btn:hover,
  :global(:root[data-theme="dark"]) .tb-icon-btn.active,
  :global(:root[data-theme="dark"]) .tb-icon-btn.focused {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.08);
  }

  .win-logo {
    width: 20px;
    height: 20px;
    display: block;
  }

  .tb-glyph {
    width: 20px;
    height: 20px;
  }

  .tb-search-btn {
    height: 34px;
    min-height: 34px;
    padding: 0 0.75rem;
    border-radius: 999px;
    border: 1px solid rgba(0, 0, 0, 0.12);
    background: rgba(255, 255, 255, 0.72);
    color: inherit;
    font-size: 13px;
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    flex-shrink: 0;
  }

  .tb-search-btn svg {
    width: 15px;
    height: 15px;
    flex-shrink: 0;
  }

  .tb-search-btn:hover {
    background: rgba(255, 255, 255, 0.92);
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .tb-search-btn {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.14);
    }
    :global(:root:not([data-theme="light"])) .tb-search-btn:hover {
      background: rgba(255, 255, 255, 0.16);
    }
  }

  :global(:root[data-theme="dark"]) .tb-search-btn {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.14);
  }

  :global(:root[data-theme="dark"]) .tb-search-btn:hover {
    background: rgba(255, 255, 255, 0.16);
  }

  .tb-app-icon {
    width: 24px;
    height: 24px;
    border-radius: 6px;
    overflow: hidden;
    display: grid;
    place-items: center;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  }

  .tb-app-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .tb-app-mono {
    font-size: 10px;
    font-weight: 700;
    color: #ffffff;
  }

  .tb-pill {
    position: absolute;
    bottom: 2px;
    left: 50%;
    transform: translateX(-50%);
    width: 8px;
    height: 3px;
    border-radius: 999px;
    background: #0067c0;
    transition: width 150ms ease;
  }

  .tb-pill.focused {
    width: 18px;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .tb-pill {
      background: #60cdff;
    }
  }

  :global(:root[data-theme="dark"]) .tb-pill {
    background: #60cdff;
  }

  .tb-tooltip {
    pointer-events: none;
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    opacity: 0;
    visibility: hidden;
    white-space: nowrap;
    padding: 0.2rem 0.55rem;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    color: #ffffff;
    background: rgba(24, 24, 30, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.16);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
    transition: opacity 120ms ease;
    z-index: 8160;
  }

  .tb-app-wrap:hover .tb-tooltip,
  .tb-app-wrap:focus-within .tb-tooltip {
    opacity: 1;
    visibility: visible;
  }

  .tb-min-chip {
    min-height: 32px;
    height: 32px;
    padding: 0 0.55rem;
    border-radius: 6px;
    border: 1px dashed currentColor;
    background: transparent;
    color: inherit;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .tb-tray {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .tray-btn,
  .tray-select {
    min-height: 30px;
    height: 30px;
    padding: 0 0.45rem;
    border-radius: 5px;
    border: 1px solid rgba(0, 0, 0, 0.12);
    background: rgba(0, 0, 0, 0.04);
    color: inherit;
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
  }

  .tray-btn:hover:not(:disabled),
  .tray-select:hover {
    background: rgba(0, 0, 0, 0.09);
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .tray-btn,
    :global(:root:not([data-theme="light"])) .tray-select {
      border-color: rgba(255, 255, 255, 0.14);
      background: rgba(255, 255, 255, 0.08);
    }
    :global(:root:not([data-theme="light"])) .tray-btn:hover:not(:disabled),
    :global(:root:not([data-theme="light"])) .tray-select:hover {
      background: rgba(255, 255, 255, 0.16);
    }
    :global(:root:not([data-theme="light"])) .tray-select option {
      background: #1c1c22;
      color: #f3f3f5;
    }
  }

  :global(:root[data-theme="dark"]) .tray-btn,
  :global(:root[data-theme="dark"]) .tray-select {
    border-color: rgba(255, 255, 255, 0.14);
    background: rgba(255, 255, 255, 0.08);
  }

  :global(:root[data-theme="dark"]) .tray-btn:hover:not(:disabled),
  :global(:root[data-theme="dark"]) .tray-select:hover {
    background: rgba(255, 255, 255, 0.16);
  }

  :global(:root[data-theme="dark"]) .tray-select option {
    background: #1c1c22;
    color: #f3f3f5;
  }

  .tray-role {
    border-color: currentColor;
    opacity: 0.85;
  }

  .tray-clock {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    justify-content: center;
    padding: 0 0.35rem;
    font-size: 11px;
    font-weight: 500;
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .tb-show-desktop {
    width: 8px;
    min-width: 8px;
    height: 40px;
    min-height: 40px;
    padding: 0;
    border: 0;
    border-left: 1px solid rgba(128, 128, 140, 0.35);
    border-radius: 0;
    background: transparent;
    flex-shrink: 0;
  }

  .tb-show-desktop:hover {
    background: rgba(128, 128, 140, 0.25);
  }

  @media (max-width: 58rem) {
    .win-taskbar {
      flex-wrap: wrap;
      padding: 0.25rem 0.4rem;
    }

    .tb-tray {
      flex-wrap: wrap;
      width: 100%;
      justify-content: flex-end;
    }

    .tb-search-text {
      display: none;
    }

    .tb-search-btn {
      padding: 0 0.55rem;
    }
  }
</style>
