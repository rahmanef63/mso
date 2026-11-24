<script lang="ts">
  import { onMount } from "svelte";
  import Monitor from "../Monitor.svelte";
  import WindowFrame from "./WindowFrame.svelte";
  import LazyWindowBody from "./LazyWindowBody.svelte";
  import LazyModals from "./LazyModals.svelte";
  import NotificationToast from "./NotificationToast.svelte";
  import DesktopIcons from "./DesktopIcons.svelte";
  import WidgetsBar from "./WidgetsBar.svelte";
  import ContextMenu from "./ContextMenu.svelte";
  import MacosMenuBar from "./MacosMenuBar.svelte";
  import MacosDock from "./MacosDock.svelte";
  import LaunchpadModal from "./LaunchpadModal.svelte";
  import MissionControl from "./MissionControl.svelte";
  import WindowsTaskbar from "./WindowsTaskbar.svelte";
  import WindowsStartMenu from "./WindowsStartMenu.svelte";
  import WindowsRunDialog from "./WindowsRunDialog.svelte";
  import IosHomeScreen from "./IosHomeScreen.svelte";
  import AndroidShell from "./AndroidShell.svelte";
  import DashboardShell from "./DashboardShell.svelte";
  import DemoBanner from "../demo/DemoBanner.svelte";
  import { installDemoFetch, isDemoMode, uninstallDemoFetch, type PreviewDevice } from "../demo/demo-adapter";
  import { createNotificationStore, type NotificationItem } from "./notifications-store";
  import { createContextMenuStore, type ContextMenuItem, type ContextMenuState } from "./context-menu-store";
  import { CHROME_PROFILES, type ChromeChoice } from "./chrome-profile";
  import { designProfileFor, type MobileNavSpec } from "./shell-design";
  import { clearAllWinState, clearWinState } from "./window-feature-state";
  import {
    applyAppearanceToDom,
    applyQuickShellChoice,
    DEFAULT_SHELL_PREFS,
    extractAppearanceFromTweaks,
    extractShellPrefsFromTweaks,
    readLocalShellPrefs,
    resolveActiveShell,
    writeLocalShellPrefs,
    type ShellPrefs,
  } from "./shell-prefs-store";
  import { readPrefs } from "../settings/prefs-api";
  import { APP_SLUGS, DOCK_APPS, SHORTCUTS, buildShellCommands, visibleDockApps, type DockAppDef } from "./shell-registry";
  import { nextWallpaper, resolveWallpaperBackground, resolveWallpaperUrl, type WallpaperId } from "./wallpaper-store";
  import {
    createWindowStore,
    stateToUrl,
    urlToApp,
    type DesktopBounds,
    type ShellLayoutState,
    type SnapZone,
    type WindowState,
  } from "./window-store";
  import { logoutSession, type Session } from "../host-api";
  import "../../styles.css";
  import "./os-chrome.css";

  const BUILD_SHA = typeof __MSO_BUILD_SHA__ === "string" ? __MSO_BUILD_SHA__ : "dev";
  const BUILD_MODE = typeof __MSO_BUILD_MODE__ === "string" ? __MSO_BUILD_MODE__ : "dev";
  const DEMO_ACTIVE = typeof window !== "undefined" && isDemoMode(window.location, BUILD_MODE);
  if (DEMO_ACTIVE) installDemoFetch();
  const APP_BY_ID = new Map(DOCK_APPS.map((item) => [item.app, item]));

  const winStore = createWindowStore();
  const notifStore = createNotificationStore({ maxItems: 5 });
  const ctxStore = createContextMenuStore();
  const dirtyEditors = new Set<string>();
  const forceCloseOnce = new Set<string>();

  let layout = $state<ShellLayoutState>(winStore.getState());
  let toasts = $state<readonly NotificationItem[]>(notifStore.getItems());
  let ctxState = $state<ContextMenuState>(ctxStore.getState());
  let activeSession = $state<Session | null>(null);
  let signingOut = $state(false);
  let paletteOpen = $state(false);
  let shortcutsOpen = $state(false);
  let controlOpen = $state(false);
  let forceQuitOpen = $state(false);
  let locked = $state(false);
  let launchpadOpen = $state(false);
  let missionOpen = $state(false);
  let startMenuOpen = $state(false);
  let runDialogOpen = $state(false);
  let themeMode = $state<"system" | "light" | "dark">("system");
  let prefersDark = $state(false);
  let wallpaper = $state<WallpaperId>("auto");
  let shellPrefs = $state<ShellPrefs>({ ...DEFAULT_SHELL_PREFS });
  let hadLocalShellChoice = $state(false);
  let demoPreviewDevice = $state<PreviewDevice>("desktop");
  let viewportWidth = $state(1440);
  let viewportHeight = $state(900);
  let effectiveViewportWidth = $derived(
    DEMO_ACTIVE
      ? (demoPreviewDevice === "phone" ? 390 : demoPreviewDevice === "tablet" ? 820 : viewportWidth)
      : viewportWidth,
  );
  let ownerDevicesOpened = $state(false);
  let clockNow = $state(new Date());
  let mobileNavByWin = $state<Record<string, { title: string; backLabel: string } | null>>({});
  const mobileNavHandlers = new Map<string, () => void>();
  let monitorRef: { refresh: () => void } | undefined;

  let pendingDeepLink: { app: string; path?: string } | null = null;
  let deepLinkApplied = false;
  let restoringHistory = false;
  let prefsBootAbort: AbortController | undefined;

  let chromeChoice = $derived<ChromeChoice>(shellPrefs.override);
  let resolvedChrome = $derived(
    resolveActiveShell(
      shellPrefs,
      effectiveViewportWidth,
      typeof navigator === "undefined" ? "" : navigator.userAgent,
      { preferAndroidUaWhenDefault: !hadLocalShellChoice },
    ),
  );
  let isDark = $derived(themeMode === "dark" || (themeMode === "system" && prefersDark));
  let wallpaperUrl = $derived(resolveWallpaperUrl(wallpaper, resolvedChrome, isDark));
  let wallpaperBg = $derived(resolveWallpaperBackground(wallpaper, resolvedChrome, isDark));
  let openWindows = $derived(layout.order.map((id) => layout.windows[id]).filter((w): w is WindowState => Boolean(w)));
  let minimizedWindows = $derived(openWindows.filter((w) => w.minimized));
  let openAppSet = $derived(new Set(openWindows.map((w) => w.app)));
  let focusedWin = $derived(layout.focused ? layout.windows[layout.focused] ?? null : null);
  let focusedTitle = $derived(focusedWin?.title ?? "Desktop");
  const PINNED_DOCK_APPS = new Set([
    "assistant", "files", "editor", "terminal", "processes", "camoufox", "workflows",
    "agent-group", "apps", "integrations", "settings", "devices", "inspector",
  ]);
  let dockApps = $derived(visibleDockApps(activeSession?.role));
  let pinnedDockApps = $derived(dockApps.filter((item) => PINNED_DOCK_APPS.has(item.app) || openAppSet.has(item.app)));
  let isDesktopShell = $derived(resolvedChrome === "macos" || resolvedChrome === "windows");
  let isMobileShell = $derived(resolvedChrome === "ios" || resolvedChrome === "android");
  let activeDesign = $derived(designProfileFor(resolvedChrome));
  let activeMobileNav = $derived.by<MobileNavSpec | null>(() => {
    const id = layout.focused;
    if (!id) return null;
    const meta = mobileNavByWin[id];
    if (!meta) return null;
    return {
      title: meta.title,
      backLabel: meta.backLabel,
      onBack: () => mobileNavHandlers.get(id)?.(),
    };
  });
  let isDesktopFloating = $derived(isDesktopShell && effectiveViewportWidth >= 720 && Boolean(activeSession?.authenticated));
  let desktopBounds = $derived<DesktopBounds>({
    width: Math.max(360, effectiveViewportWidth),
    height: Math.max(320, viewportHeight - (resolvedChrome === "macos" ? 106 : 48)),
    top: 0,
    bottom: 0,
  });

  function closeShellOverlays() {
    launchpadOpen = false;
    missionOpen = false;
    startMenuOpen = false;
    runDialogOpen = false;
    ctxStore.close();
  }

  function setShellPrefs(next: ShellPrefs, persist = true) {
    closeShellOverlays();
    shellPrefs = next;
    if (persist && !DEMO_ACTIVE) {
      hadLocalShellChoice = true;
      writeLocalShellPrefs(next);
    }
  }

  function setChrome(next: ChromeChoice) {
    setShellPrefs(applyQuickShellChoice(shellPrefs, next, effectiveViewportWidth), true);
  }

  function setWallpaper(next: WallpaperId) {
    wallpaper = next;
  }

  async function bootstrapRemotePrefs() {
    prefsBootAbort?.abort();
    const ctrl = new AbortController();
    prefsBootAbort = ctrl;
    try {
      const prefs = await readPrefs(ctrl.signal);
      if (ctrl.signal.aborted) return;
      const appearance = extractAppearanceFromTweaks(prefs.tweaks);
      themeMode = appearance.theme;
      wallpaper = appearance.wallpaper;
      applyAppearanceToDom(appearance);
      if (!hadLocalShellChoice) {
        const extracted = extractShellPrefsFromTweaks(prefs.tweaks, shellPrefs);
        if (prefs.tweaks?.shell || extracted.migratedFromLegacyPreset) {
          shellPrefs = extracted.prefs;
        }
      }
    } catch {
      // Offline or unavailable prefs must not block the workspace; local prefs stay active.
    }
  }

  function openApp(app: string, title: string, payload?: unknown, multi = false) {
    closeShellOverlays();
    const w = Math.min(820, Math.max(340, viewportWidth - 96));
    const h = Math.min(560, Math.max(320, viewportHeight - 170));
    winStore.openWindow(app, title, { w, h }, payload, multi ? { multi: true } : undefined);
  }

  function openAppById(app: string, payload?: unknown) {
    const def = APP_BY_ID.get(app);
    const title = def?.title ?? app[0].toUpperCase() + app.slice(1);
    const multi = Boolean(def?.multi);
    openApp(app, title, payload ?? def?.payload, multi);
  }

  function focusOrOpenApp(item: DockAppDef) {
    closeShellOverlays();
    const appWins = openWindows.filter((w) => w.app === item.app);
    if (appWins.length > 0) {
      const top = appWins.reduce((a, b) => (a.z >= b.z ? a : b));
      winStore.restoreWindow(top.id);
      return;
    }
    openApp(item.app, item.title, item.payload, item.multi);
  }

  function toggleTaskbarApp(item: DockAppDef) {
    closeShellOverlays();
    if (focusedWin?.app === item.app && !focusedWin.minimized) {
      winStore.minimizeWindow(focusedWin.id);
      return;
    }
    focusOrOpenApp(item);
  }

  function handleMobileNavChange(winId: string, nav: MobileNavSpec | null) {
    if (nav === null) {
      mobileNavHandlers.delete(winId);
      if (!(winId in mobileNavByWin)) return;
      const next = { ...mobileNavByWin };
      delete next[winId];
      mobileNavByWin = next;
      return;
    }
    mobileNavHandlers.set(winId, nav.onBack);
    const prev = mobileNavByWin[winId];
    if (prev && prev.title === nav.title && prev.backLabel === nav.backLabel) return;
    mobileNavByWin = { ...mobileNavByWin, [winId]: { title: nav.title, backLabel: nav.backLabel } };
  }

  function closeWindowSafely(id: string) {
    if (winStore.closeWindow(id)) {
      dirtyEditors.delete(id);
      forceCloseOnce.delete(id);
      clearWinState(id);
      handleMobileNavChange(id, null);
    }
  }

  function forceCloseWindow(id: string) {
    dirtyEditors.delete(id);
    forceCloseOnce.delete(id);
    winStore.setCloseGuard(id, null);
    winStore.closeWindow(id);
    clearWinState(id);
    handleMobileNavChange(id, null);
  }
  function forceCloseAll() {
    for (const id of [...winStore.getState().order]) forceCloseWindow(id);
    clearAllWinState();
    mobileNavByWin = {};
    forceQuitOpen = false;
  }

  let commands = $derived(buildShellCommands({
    authenticated: Boolean(activeSession?.authenticated),
    role: activeSession?.role,
    onRefresh: () => monitorRef?.refresh(),
    onControlCenter: () => { controlOpen = true; },
    onForceQuit: () => { forceQuitOpen = true; },
    onLock: () => { locked = true; },
    onShortcuts: () => { shortcutsOpen = true; },
    onSignOut: () => void handleSignOut(),
    onOpenApp: openApp,
  }));

  function applyTheme(theme: string) {
    themeMode = theme === "light" || theme === "dark" ? theme : "system";
    if (typeof document === "undefined") return;
    if (themeMode === "light" || themeMode === "dark") document.documentElement.dataset.theme = themeMode;
    else delete document.documentElement.dataset.theme;
  }

  function cycleWallpaper() {
    wallpaper = nextWallpaper(wallpaper);
    notifStore.push({ title: "Wallpaper updated", detail: `Active wallpaper: ${wallpaper}`, tone: "info" });
  }

  function handleEditorDirtyChange(winId: string, dirty: boolean) {
    if (dirty) {
      dirtyEditors.add(winId);
      winStore.setCloseGuard(winId, () => {
        if (!dirtyEditors.has(winId) || forceCloseOnce.delete(winId)) return true;
        forceCloseOnce.add(winId);
        notifStore.push({
          title: "Unsaved changes in Code Editor",
          detail: "Save or click Close again to discard.",
          tone: "warn",
        });
        return false;
      });
    } else {
      dirtyEditors.delete(winId);
      forceCloseOnce.delete(winId);
      winStore.setCloseGuard(winId, null);
    }
  }

  function openDesktopContextMenu(event: MouseEvent) {
    if (!activeSession?.authenticated) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [data-win-id], .app-dock, .macos-menubar, .ctx-menu")) return;
    event.preventDefault();
    const items: ContextMenuItem[] = [
      { id: "open-alfa", label: "Open Alfa Assistant", onSelect: () => openApp("assistant", "Alfa Assistant") },
      { id: "open-files", label: "New Files Window", onSelect: () => openApp("files", "Files", "~", true) },
      ...(activeSession.role === "owner" ? [{ id: "open-term", label: "Open Terminal", onSelect: () => openApp("terminal", "Terminal") }] : []),
      { id: "open-settings", label: "System Settings...", onSelect: () => openApp("settings", "Settings") },
      { type: "sep" },
      { id: "wp-cycle", label: `Change Wallpaper (${wallpaper})`, onSelect: cycleWallpaper },
      ...CHROME_PROFILES.map((p): ContextMenuItem => ({
        id: `shell-${p.id}`,
        label: `Switch Shell: ${p.label}`,
        checked: resolvedChrome === p.id,
        onSelect: () => setChrome(p.id),
      })),
      { type: "sep" },
      { id: "theme-dark", label: "Dark Appearance", checked: themeMode === "dark", onSelect: () => applyTheme("dark") },
      { id: "theme-light", label: "Light Appearance", checked: themeMode === "light", onSelect: () => applyTheme("light") },
      { id: "theme-system", label: "System Appearance", checked: themeMode === "system", onSelect: () => applyTheme("system") },
      { type: "sep" },
      { id: "cascade", label: "Cascade Windows", disabled: openWindows.length === 0, onSelect: () => winStore.cascadeWindows(desktopBounds) },
      { id: "tile", label: "Tile Windows", disabled: openWindows.length === 0, onSelect: () => winStore.tileWindows(desktopBounds) },
      { id: "min-all", label: "Minimize All", disabled: openWindows.length === 0, onSelect: () => winStore.minimizeAll() },
      { type: "sep" },
      { id: "refresh", label: "Refresh System Monitor", onSelect: () => monitorRef?.refresh() },
      { id: "lock", label: "Lock Screen", shortcut: "Ctrl+L", onSelect: () => { locked = true; } },
    ];
    ctxStore.open(event.clientX, event.clientY, items, "Desktop");
  }

  function openWindowContextMenu(event: MouseEvent, win: WindowState) {
    event.preventDefault();
    event.stopPropagation();
    const items: ContextMenuItem[] = [
      { id: "win-max", label: win.maximized ? "Restore" : "Maximize", onSelect: () => winStore.toggleMaximize(win.id) },
      { id: "win-min", label: "Minimize", onSelect: () => winStore.minimizeWindow(win.id) },
      { id: "win-left", label: "Snap Left Half", onSelect: () => winStore.snapWindow(win.id, "left", desktopBounds) },
      { id: "win-right", label: "Snap Right Half", onSelect: () => winStore.snapWindow(win.id, "right", desktopBounds) },
      { id: "win-pin", label: win.pinned ? "Unpin from Top" : "Keep on Top", checked: Boolean(win.pinned), onSelect: () => winStore.togglePin(win.id) },
      { type: "sep" },
      { id: "win-close", label: "Close Window", danger: true, onSelect: () => winStore.closeWindow(win.id) },
    ];
    ctxStore.open(event.clientX, event.clientY, items, win.title);
  }

  function openDockAppContextMenu(event: MouseEvent, item: DockAppDef) {
    event.preventDefault();
    event.stopPropagation();
    const appWins = openWindows.filter((w) => w.app === item.app);
    const items: ContextMenuItem[] = [
      { id: "dock-open", label: item.multi ? `New ${item.title} Window` : `Open ${item.title}`, onSelect: () => openApp(item.app, item.title, item.payload, item.multi) },
      ...(appWins.length > 0
        ? [
            { id: "dock-focus", label: "Show Window", onSelect: () => winStore.restoreWindow(appWins[appWins.length - 1].id) },
            { id: "dock-min", label: "Minimize", onSelect: () => { for (const w of appWins) winStore.minimizeWindow(w.id); } },
            { type: "sep" as const },
            { id: "dock-close", label: appWins.length > 1 ? `Close All (${appWins.length})` : "Close", danger: true, onSelect: () => { for (const w of appWins) winStore.closeWindow(w.id); } },
          ]
        : []),
    ];
    ctxStore.open(event.clientX, event.clientY, items, item.title);
  }

  function handleGlobalKeydown(event: KeyboardEvent) {
    if (locked) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      closeShellOverlays();
      paletteOpen = !paletteOpen;
      shortcutsOpen = false;
      controlOpen = false;
    } else if (event.key === "?" && !paletteOpen && !/INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement | null)?.tagName ?? "")) {
      event.preventDefault();
      shortcutsOpen = !shortcutsOpen;
    } else if (event.key === "Escape") {
      closeShellOverlays();
    }
  }

  function restoreFromLocation(pathname: string) {
    if (!activeSession?.authenticated) return;
    const deep = urlToApp(pathname, APP_SLUGS);
    restoringHistory = true;
    try {
      if (!deep?.app) {
        winStore.minimizeAll();
        return;
      }
      const existing = winStore.focusApp(deep.app, deep.path);
      if (!existing) openAppById(deep.app, deep.path);
    } finally {
      restoringHistory = false;
    }
  }

  onMount(() => {
    viewportWidth = window.innerWidth;
    viewportHeight = window.innerHeight;
    const local = DEMO_ACTIVE
      ? { prefs: { ...DEFAULT_SHELL_PREFS }, hadStored: false, corrupt: false }
      : readLocalShellPrefs();
    shellPrefs = local.prefs;
    hadLocalShellChoice = local.hadStored;
    if (!DEMO_ACTIVE && local.corrupt) writeLocalShellPrefs(local.prefs);

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    prefersDark = mq.matches;
    const onScheme = (e: MediaQueryListEvent) => { prefersDark = e.matches; };
    mq.addEventListener("change", onScheme);
    const onResize = () => { viewportWidth = window.innerWidth; viewportHeight = window.innerHeight; };
    window.addEventListener("resize", onResize, { passive: true });
    const onPopState = () => { restoreFromLocation(window.location.pathname); };
    window.addEventListener("popstate", onPopState);
    const clockTimer = setInterval(() => { clockNow = new Date(); }, 30_000);

    pendingDeepLink = urlToApp(window.location.pathname, APP_SLUGS);

    const unsubWin = winStore.subscribe((next) => {
      layout = next;
      if (activeSession?.authenticated && !restoringHistory && (!pendingDeepLink || deepLinkApplied)) {
        const target = stateToUrl(next, APP_SLUGS);
        if (window.location.pathname !== target) {
          window.history.pushState({ msoPath: target }, "", target);
        }
      }
    });
    const unsubNotif = notifStore.subscribe((next) => { toasts = next; });
    const unsubCtx = ctxStore.subscribe((next) => { ctxState = next; });

    return () => {
      clearInterval(clockTimer);
      prefsBootAbort?.abort();
      mq.removeEventListener("change", onScheme);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("popstate", onPopState);
      unsubWin();
      unsubNotif();
      unsubCtx();
      notifStore.dispose();
      if (DEMO_ACTIVE) uninstallDemoFetch();
    };
  });

  function handleSessionChange(next: Session | null) {
    const wasAuthed = Boolean(activeSession?.authenticated);
    activeSession = next;
    if (next?.authenticated) {
      if (!wasAuthed) void bootstrapRemotePrefs();
      if (pendingDeepLink && !deepLinkApplied) {
        const target = pendingDeepLink;
        deepLinkApplied = true;
        pendingDeepLink = null;
        restoringHistory = true;
        try {
          openAppById(target.app, target.path);
        } finally {
          restoringHistory = false;
        }
        return;
      }
      if (
        next.role === "owner"
        && !ownerDevicesOpened
        && !deepLinkApplied
        && resolvedChrome !== "ios"
        && resolvedChrome !== "android"
      ) {
        ownerDevicesOpened = true;
        openApp("devices", "Devices");
      }
      return;
    }
    ownerDevicesOpened = false;
    locked = false;
    closeShellOverlays();
    forceCloseAll();
  }

  async function handleSignOut() {
    if (signingOut) return;
    signingOut = true;
    try {
      await logoutSession(new AbortController().signal);
      deepLinkApplied = false;
      handleSessionChange(null);
      monitorRef?.refresh();
    } catch {
      notifStore.push({ title: "Sign-out failed", detail: "Check connection and retry.", tone: "error" });
    } finally {
      signingOut = false;
    }
  }
</script>

{#snippet monitorSnippet()}
  <Monitor bind:this={monitorRef} onSessionChange={handleSessionChange} />
{/snippet}

{#snippet widgetsSnippet()}
  {#if activeSession?.authenticated}
    <WidgetsBar
      openWindowCount={openWindows.length}
      {resolvedChrome}
      role={activeSession.role}
      onOpenApp={(app, title) => openApp(app, title)}
    />
  {/if}
{/snippet}

{#snippet windowsSnippet(floating: boolean)}
  {#if activeSession?.authenticated && layout.order.length > 0}
    <div class="window-area" class:floating-layer={floating} data-open-windows={layout.order.length}>
      {#each layout.order as id (id)}
        {@const win = layout.windows[id]}
        {#if win}
          <WindowFrame
            {win}
            focused={layout.focused === id}
            {floating}
            framelessMobile={isMobileShell}
            edgeToEdge={activeDesign.edgeToEdgeApps.includes(win.app)}
            chrome={resolvedChrome}
            {desktopBounds}
            onFocus={(w) => winStore.focusWindow(w)}
            onMinimize={(w) => winStore.minimizeWindow(w)}
            onMaximize={(w) => winStore.toggleMaximize(w)}
            onClose={closeWindowSafely}
            onMove={(w, x, y) => winStore.moveWindow(w, x, y)}
            onResize={(w, width, height) => winStore.resizeWindow(w, width, height)}
            onSnap={(w, zone: SnapZone) => winStore.snapWindow(w, zone, desktopBounds)}
            onTogglePin={(w) => winStore.togglePin(w)}
            onContextMenu={openWindowContextMenu}
          >
            <LazyWindowBody
              {win}
              session={activeSession}
              {layout}
              {chromeChoice}
              {resolvedChrome}
              {viewportWidth}
              {shellPrefs}
              {wallpaper}
              onFilesPathChange={(winId, p) => winStore.setWindowPayload(winId, p)}
              onThemeChange={applyTheme}
              onChromeChange={setChrome}
              onShellPrefsChange={(next) => setShellPrefs(next, true)}
              onWallpaperChange={setWallpaper}
              onEditorDirtyChange={handleEditorDirtyChange}
              onOpenInEditor={(p) => openApp("editor", "Code Editor", p, true)}
              onMobileNavChange={handleMobileNavChange}
            />
          </WindowFrame>
        {/if}
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet stackedWindowsSnippet()}
  {@render windowsSnippet(false)}
{/snippet}

<svelte:window onkeydown={handleGlobalKeydown} />
<svelte:head><title>MSO</title></svelte:head>
<a class="skip-link" href="#main-content">Skip to content</a>
<DemoBanner
  visible={DEMO_ACTIVE}
  buildSha={BUILD_SHA}
  previewDevice={demoPreviewDevice}
  onPreviewDeviceChange={(next) => { demoPreviewDevice = next; }}
/>

<div
  class="workspace"
  class:signed-out={!activeSession?.authenticated}
  class:desktop-fixed={isDesktopFloating}
  inert={locked || undefined}
  data-chrome={resolvedChrome}
  data-ios-style={shellPrefs.iosStyle}
  data-build-sha={BUILD_SHA}
  data-build-mode={DEMO_ACTIVE ? "demo" : BUILD_MODE}
  style:background-image={wallpaperBg}
  style:max-width={DEMO_ACTIVE && demoPreviewDevice !== "desktop" ? `${effectiveViewportWidth}px` : undefined}
  style:margin-inline={DEMO_ACTIVE && demoPreviewDevice !== "desktop" ? "auto" : undefined}
>
  {#if resolvedChrome === "ios"}
    <IosHomeScreen
      authenticated={Boolean(activeSession?.authenticated)}
      role={activeSession?.role ?? null}
      {focusedTitle}
      focusedWinId={layout.focused}
      mobileNav={activeMobileNav}
      {chromeChoice}
      {resolvedChrome}
      {dockApps}
      {openWindows}
      {clockNow}
      {signingOut}
      {wallpaperUrl}
      onOpenApp={openApp}
      onRestoreWindow={(id) => winStore.restoreWindow(id)}
      onMinimizeWindow={(id) => winStore.minimizeWindow(id)}
      onMinimizeAll={() => winStore.minimizeAll()}
      onCloseWindow={closeWindowSafely}
      onFocusWindow={(id) => winStore.restoreWindow(id)}
      onOpenPalette={() => { paletteOpen = true; }}
      onOpenControl={() => { controlOpen = true; }}
      onOpenShortcuts={() => { shortcutsOpen = true; }}
      onChromeChange={setChrome}
      onSignOut={() => void handleSignOut()}
      monitorSlot={monitorSnippet}
      windowsSlot={stackedWindowsSnippet}
      widgetsSlot={widgetsSnippet}
    />
  {:else if resolvedChrome === "android"}
    <AndroidShell
      authenticated={Boolean(activeSession?.authenticated)}
      role={activeSession?.role ?? null}
      {focusedTitle}
      focusedWinId={layout.focused}
      mobileNav={activeMobileNav}
      {chromeChoice}
      {resolvedChrome}
      {dockApps}
      {openWindows}
      {clockNow}
      {signingOut}
      {wallpaperUrl}
      onOpenApp={openApp}
      onRestoreWindow={(id) => winStore.restoreWindow(id)}
      onMinimizeWindow={(id) => winStore.minimizeWindow(id)}
      onMinimizeAll={() => winStore.minimizeAll()}
      onCloseWindow={closeWindowSafely}
      onFocusWindow={(id) => winStore.restoreWindow(id)}
      onOpenPalette={() => { paletteOpen = true; }}
      onOpenControl={() => { controlOpen = true; }}
      onOpenShortcuts={() => { shortcutsOpen = true; }}
      onChromeChange={setChrome}
      onSignOut={() => void handleSignOut()}
      onCycleWallpaper={cycleWallpaper}
      monitorSlot={monitorSnippet}
      windowsSlot={stackedWindowsSnippet}
      widgetsSlot={widgetsSnippet}
    />
  {:else if resolvedChrome === "dashboard"}
    <DashboardShell
      authenticated={Boolean(activeSession?.authenticated)}
      role={activeSession?.role ?? null}
      {focusedTitle}
      {chromeChoice}
      {resolvedChrome}
      {dockApps}
      {openWindows}
      {clockNow}
      {signingOut}
      onOpenApp={openApp}
      onRestoreWindow={(id) => winStore.restoreWindow(id)}
      onMinimizeWindow={(id) => winStore.minimizeWindow(id)}
      onMinimizeAll={() => winStore.minimizeAll()}
      onCloseWindow={(id) => winStore.closeWindow(id)}
      onOpenPalette={() => { paletteOpen = true; }}
      onOpenControl={() => { controlOpen = true; }}
      onOpenShortcuts={() => { shortcutsOpen = true; }}
      onChromeChange={setChrome}
      onSignOut={() => void handleSignOut()}
      monitorSlot={monitorSnippet}
      widgetsSlot={widgetsSnippet}
      windowsSlot={stackedWindowsSnippet}
    />
  {:else}
    {#if resolvedChrome === "macos"}
      <MacosMenuBar
        authenticated={Boolean(activeSession?.authenticated)}
        role={activeSession?.role ?? null}
        {focusedTitle}
        focusedWinId={layout.focused}
        {openWindows}
        {chromeChoice}
        {resolvedChrome}
        {themeMode}
        {signingOut}
        onOpenApp={openApp}
        onCommandPalette={() => { paletteOpen = true; }}
        onControlCenter={() => { controlOpen = true; }}
        onShortcuts={() => { shortcutsOpen = true; }}
        onChromeChange={setChrome}
        onThemeChange={applyTheme}
        onCycleWallpaper={cycleWallpaper}
        onLock={() => { locked = true; }}
        onForceQuit={() => { forceQuitOpen = true; }}
        onSignOut={() => void handleSignOut()}
        onLaunchpad={() => { launchpadOpen = !launchpadOpen; missionOpen = false; }}
        onMissionControl={() => { missionOpen = !missionOpen; launchpadOpen = false; }}
        onMinimizeFocused={() => { if (layout.focused) winStore.minimizeWindow(layout.focused); }}
        onMaximizeFocused={() => { if (layout.focused) winStore.toggleMaximize(layout.focused); }}
        onCloseFocused={() => { if (layout.focused) winStore.closeWindow(layout.focused); }}
        onFocusWindow={(id) => winStore.restoreWindow(id)}
        onCascade={() => winStore.cascadeWindows(desktopBounds)}
        onTile={() => winStore.tileWindows(desktopBounds)}
        onMinimizeAll={() => winStore.minimizeAll()}
      />
    {/if}

    <main
      id="main-content"
      tabindex="-1"
      data-shell={resolvedChrome}
      class="os-desktop-stage"
      class:signed-out-stage={!activeSession?.authenticated}
      oncontextmenu={openDesktopContextMenu}
    >
      <div class:desktop-backdrop-layer={Boolean(activeSession?.authenticated)} class:lock-center-shell={!activeSession?.authenticated}>
        <div class:desktop-top-widgets={Boolean(activeSession?.authenticated)}>
          {@render monitorSnippet()}
        </div>
        {#if activeSession?.authenticated}
          <DesktopIcons role={activeSession.role} chrome={resolvedChrome} onOpenApp={openApp} />
        {/if}
      </div>
      {#if activeSession?.authenticated}
        {@render windowsSnippet(isDesktopFloating)}
      {/if}
    </main>

    {#if resolvedChrome === "macos" && activeSession?.authenticated}
      <MacosDock
        dockApps={pinnedDockApps}
        {openAppSet}
        {minimizedWindows}
        onOpenApp={openApp}
        onFocusOrOpenApp={focusOrOpenApp}
        onLaunchpad={() => { launchpadOpen = !launchpadOpen; missionOpen = false; }}
        onMissionControl={() => { missionOpen = !missionOpen; launchpadOpen = false; }}
        onRestoreWindow={(id) => winStore.restoreWindow(id)}
        onAppContextMenu={openDockAppContextMenu}
      />
    {:else if resolvedChrome === "windows"}
      <WindowsTaskbar
        authenticated={Boolean(activeSession?.authenticated)}
        role={activeSession?.role ?? null}
        dockApps={pinnedDockApps}
        {openAppSet}
        focusedApp={focusedWin?.app ?? null}
        {minimizedWindows}
        startOpen={startMenuOpen}
        {chromeChoice}
        {resolvedChrome}
        {signingOut}
        onToggleStart={() => { startMenuOpen = !startMenuOpen; missionOpen = false; }}
        onOpenApp={openApp}
        onToggleApp={toggleTaskbarApp}
        onCommandPalette={() => { paletteOpen = true; }}
        onMissionControl={() => { missionOpen = !missionOpen; startMenuOpen = false; }}
        onControlCenter={() => { controlOpen = true; }}
        onShortcuts={() => { shortcutsOpen = true; }}
        onChromeChange={setChrome}
        onRestoreWindow={(id) => winStore.restoreWindow(id)}
        onMinimizeAll={() => winStore.minimizeAll()}
        onSignOut={() => void handleSignOut()}
        onAppContextMenu={openDockAppContextMenu}
      />
    {/if}
  {/if}
</div>

<LaunchpadModal open={launchpadOpen} {dockApps} chrome={resolvedChrome} onOpenApp={openApp} onClose={() => { launchpadOpen = false; }} />
<MissionControl
  open={missionOpen}
  windows={openWindows}
  focusedWinId={layout.focused}
  chrome={resolvedChrome}
  label={resolvedChrome === "windows" ? "Task View" : "Mission Control"}
  onFocusWindow={(id) => { winStore.restoreWindow(id); missionOpen = false; }}
  onCloseWindow={(id) => winStore.closeWindow(id)}
  onMinimizeAll={() => { winStore.minimizeAll(); missionOpen = false; }}
  onTileWindows={() => { winStore.tileWindows(desktopBounds); missionOpen = false; }}
  onClose={() => { missionOpen = false; }}
/>
<WindowsStartMenu
  open={startMenuOpen}
  {dockApps}
  role={activeSession?.role ?? null}
  authenticated={Boolean(activeSession?.authenticated)}
  {signingOut}
  onOpenApp={openApp}
  onOpenRun={() => { startMenuOpen = false; runDialogOpen = true; }}
  onLock={() => { startMenuOpen = false; locked = true; }}
  onSignOut={() => { startMenuOpen = false; void handleSignOut(); }}
  onClose={() => { startMenuOpen = false; }}
/>
<WindowsRunDialog open={runDialogOpen} {dockApps} onOpenApp={openApp} onClose={() => { runDialogOpen = false; }} />
<ContextMenu state={ctxState} onClose={() => ctxStore.close()} />
<LazyModals
  {paletteOpen} {controlOpen} {forceQuitOpen} {shortcutsOpen} {locked}
  {commands} shortcuts={SHORTCUTS} theme={themeMode} {chromeChoice} {resolvedChrome}
  role={activeSession?.role ?? null} deviceLabel={activeSession?.deviceLabel ?? null} {openWindows}
  onClosePalette={() => { paletteOpen = false; }} onCloseControl={() => { controlOpen = false; }}
  onCloseForceQuit={() => { forceQuitOpen = false; }} onCloseShortcuts={() => { shortcutsOpen = false; }}
  onThemeChange={applyTheme} onChromeChange={setChrome}
  onLock={() => { controlOpen = false; locked = true; }} onUnlock={() => { locked = false; }}
  onOpenForceQuit={() => { controlOpen = false; forceQuitOpen = true; }}
  onForceClose={forceCloseWindow} onCloseAll={forceCloseAll} onSignOut={() => void handleSignOut()}
/>
<NotificationToast items={toasts} onDismiss={(id) => notifStore.dismiss(id)} />
