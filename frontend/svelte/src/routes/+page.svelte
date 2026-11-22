<script lang="ts">
  import { onMount } from "svelte";
  import Monitor from "../lib/Monitor.svelte";
  import WindowFrame from "../lib/shell/WindowFrame.svelte";
  import LazyWindowBody from "../lib/shell/LazyWindowBody.svelte";
  import CommandPalette from "../lib/shell/CommandPalette.svelte";
  import NotificationToast from "../lib/shell/NotificationToast.svelte";
  import ShortcutHelp from "../lib/shell/ShortcutHelp.svelte";
  import ControlCenter from "../lib/shell/ControlCenter.svelte";
  import ForceQuitModal from "../lib/shell/ForceQuitModal.svelte";
  import LockScreen from "../lib/shell/LockScreen.svelte";
  import DesktopIcons from "../lib/shell/DesktopIcons.svelte";
  import WidgetsBar from "../lib/shell/WidgetsBar.svelte";
  import { createNotificationStore, type NotificationItem } from "../lib/shell/notifications-store";
  import { CHROME_PROFILES, isChromeChoice, resolveChromeProfile, type ChromeChoice } from "../lib/shell/chrome-profile";
  import { APP_SLUGS, SHORTCUTS, buildShellCommands, visibleDockApps } from "../lib/shell/shell-registry";
  import { createWindowStore, stateToUrl, urlToApp, type ShellLayoutState, type WindowState } from "../lib/shell/window-store";
  import { logoutSession, type Session } from "../lib/host-api";
  import "../styles.css";
  import "../lib/shell/os-chrome.css";

  const winStore = createWindowStore();
  const notifStore = createNotificationStore({ maxItems: 5 });
  const dirtyEditors = new Set<string>(), forceCloseOnce = new Set<string>();

  let layout = $state<ShellLayoutState>(winStore.getState());
  let toasts = $state<readonly NotificationItem[]>(notifStore.getItems());
  let activeSession = $state<Session | null>(null);
  let signingOut = $state(false), paletteOpen = $state(false), shortcutsOpen = $state(false);
  let controlOpen = $state(false), forceQuitOpen = $state(false), locked = $state(false);
  let themeMode = $state<"system" | "light" | "dark">("system");
  let chromeChoice = $state<ChromeChoice>("auto"), viewportWidth = $state(1440), ownerDevicesOpened = $state(false);
  let monitorRef: { refresh: () => void } | undefined;

  let resolvedChrome = $derived(resolveChromeProfile(chromeChoice, viewportWidth, typeof navigator === "undefined" ? "" : navigator.userAgent));
  let openWindows = $derived(layout.order.map((id) => layout.windows[id]).filter((w): w is WindowState => Boolean(w)));
  let dockApps = $derived(visibleDockApps(activeSession?.role));

  function openApp(app: string, title: string, payload?: unknown, multi = false) {
    winStore.openWindow(app, title, undefined, payload, multi ? { multi: true } : undefined);
  }
  function forceCloseWindow(id: string) {
    dirtyEditors.delete(id); forceCloseOnce.delete(id); winStore.setCloseGuard(id, null); winStore.closeWindow(id);
  }
  function forceCloseAll() { for (const id of [...winStore.getState().order]) forceCloseWindow(id); forceQuitOpen = false; }

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

  function handleEditorDirtyChange(winId: string, dirty: boolean) {
    if (dirty) {
      dirtyEditors.add(winId);
      winStore.setCloseGuard(winId, () => {
        if (!dirtyEditors.has(winId) || forceCloseOnce.delete(winId)) return true;
        forceCloseOnce.add(winId);
        notifStore.push({ title: "Unsaved changes in Code Editor", detail: "Save or click Close again to discard.", tone: "warn" });
        return false;
      });
    } else { dirtyEditors.delete(winId); forceCloseOnce.delete(winId); winStore.setCloseGuard(winId, null); }
  }

  function handleGlobalKeydown(event: KeyboardEvent) {
    if (locked) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault(); paletteOpen = !paletteOpen; shortcutsOpen = false; controlOpen = false;
    } else if (event.key === "?" && !paletteOpen && !/INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement | null)?.tagName ?? "")) {
      event.preventDefault(); shortcutsOpen = !shortcutsOpen;
    }
  }

  onMount(() => {
    viewportWidth = window.innerWidth;
    const onResize = () => { viewportWidth = window.innerWidth; };
    window.addEventListener("resize", onResize, { passive: true });
    const unsubWin = winStore.subscribe((next) => {
      layout = next;
      if (activeSession?.authenticated) {
        const target = stateToUrl(next, APP_SLUGS);
        if (window.location.pathname !== target) window.history.replaceState(null, "", target);
      }
    });
    const unsubNotif = notifStore.subscribe((next) => { toasts = next; });
    const deep = urlToApp(window.location.pathname, APP_SLUGS);
    if (deep?.app) openApp(deep.app, deep.app[0].toUpperCase() + deep.app.slice(1), deep.path, deep.app === "files" || deep.app === "editor");
    return () => { window.removeEventListener("resize", onResize); unsubWin(); unsubNotif(); notifStore.dispose(); };
  });

  function handleSessionChange(next: Session | null) {
    activeSession = next;
    if (next?.authenticated && next.role === "owner" && !ownerDevicesOpened) { ownerDevicesOpened = true; openApp("devices", "Devices"); }
    if (!next?.authenticated) { ownerDevicesOpened = false; locked = false; forceCloseAll(); }
  }

  async function handleSignOut() {
    if (signingOut) return;
    signingOut = true;
    try { await logoutSession(new AbortController().signal); handleSessionChange(null); monitorRef?.refresh(); }
    catch { notifStore.push({ title: "Sign-out failed", detail: "Check connection and retry.", tone: "error" }); }
    finally { signingOut = false; }
  }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />
<svelte:head><title>MSO | Svelte migration preview</title></svelte:head>
<a class="skip-link" href="#main-content">Skip to content</a>
<div class="workspace" data-chrome={resolvedChrome}>
  <header class="workspace-header">
    <div class="brand"><h1>MSO</h1><span>Svelte + Rust preview</span></div>
    <div class="session-actions">
      <button type="button" onclick={() => { paletteOpen = true; }}>Commands</button>
      <button type="button" onclick={() => { controlOpen = true; }}>Controls</button>
      <button type="button" onclick={() => { shortcutsOpen = true; }}>Shortcuts</button>
      <select aria-label="Shell chrome" value={chromeChoice} onchange={(e) => { const v = e.currentTarget.value; if (isChromeChoice(v)) chromeChoice = v; }}>
        <option value="auto">Auto ({resolvedChrome})</option>
        {#each CHROME_PROFILES as p (p.id)}<option value={p.id}>{p.label}</option>{/each}
      </select>
      {#if activeSession?.authenticated}
        <span class="role-badge">{activeSession.role}</span>
        <button disabled={signingOut} onclick={() => void handleSignOut()}>{signingOut ? "Signing out..." : "Sign out"}</button>
      {/if}
    </div>
  </header>
  <main id="main-content" tabindex="-1" class="workspace-stack">
    <Monitor bind:this={monitorRef} onSessionChange={handleSessionChange} />
    {#if activeSession?.authenticated}
      <WidgetsBar openWindowCount={openWindows.length} {resolvedChrome} role={activeSession.role} onOpenApp={(app, title) => openApp(app, title)} />
      <nav class="app-dock" aria-label="Workspace apps">
        {#each dockApps as item (item.app)}
          <button type="button" onclick={() => openApp(item.app, item.title, item.payload, item.multi)}>{item.label}</button>
        {/each}
        {#each layout.order as id (id)}
          {@const win = layout.windows[id]}
          {#if win?.minimized}<button type="button" class="minimized-chip" onclick={() => winStore.restoreWindow(id)}>Restore {win.title}</button>{/if}
        {/each}
      </nav>
      <DesktopIcons role={activeSession.role} onOpenApp={openApp} />
      {#if layout.order.length > 0}
        <div class="window-area" data-open-windows={layout.order.length}>
          {#each layout.order as id (id)}
            {@const win = layout.windows[id]}
            {#if win}
              <WindowFrame {win} focused={layout.focused === id} onFocus={(w) => winStore.focusWindow(w)} onMinimize={(w) => winStore.minimizeWindow(w)} onMaximize={(w) => winStore.toggleMaximize(w)} onClose={(w) => winStore.closeWindow(w)}>
                <LazyWindowBody {win} session={activeSession} {layout} {chromeChoice} {resolvedChrome} {viewportWidth} onFilesPathChange={(p) => winStore.focusApp("files", p)} onThemeChange={applyTheme} onChromeChange={(c) => { chromeChoice = c; }} onEditorDirtyChange={handleEditorDirtyChange} onOpenInEditor={(p) => openApp("editor", "Code Editor", p, true)} />
              </WindowFrame>
            {/if}
          {/each}
        </div>
      {/if}
    {/if}
  </main>
  <footer>Existing host API, CSRF depth-2, and device permissions. Production cockpit unchanged.</footer>
</div>
<CommandPalette open={paletteOpen} items={commands} onClose={() => { paletteOpen = false; }} />
<ControlCenter open={controlOpen} theme={themeMode} {chromeChoice} {resolvedChrome} role={activeSession?.role ?? null} openWindowCount={openWindows.length} onThemeChange={applyTheme} onChromeChange={(c) => { chromeChoice = c; }} onLock={() => { controlOpen = false; locked = true; }} onOpenForceQuit={() => { controlOpen = false; forceQuitOpen = true; }} onClose={() => { controlOpen = false; }} />
<ForceQuitModal open={forceQuitOpen} windows={openWindows} onForceClose={forceCloseWindow} onCloseAll={forceCloseAll} onClose={() => { forceQuitOpen = false; }} />
<ShortcutHelp open={shortcutsOpen} shortcuts={SHORTCUTS} onClose={() => { shortcutsOpen = false; }} />
<LockScreen {locked} deviceLabel={activeSession?.deviceLabel ?? null} role={activeSession?.role ?? null} onUnlock={() => { locked = false; }} onSignOut={() => void handleSignOut()} />
<NotificationToast items={toasts} onDismiss={(id) => notifStore.dismiss(id)} />
