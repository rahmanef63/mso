<script lang="ts">
  import { onMount } from "svelte";
  import Monitor from "../lib/Monitor.svelte";
  import WindowFrame from "../lib/shell/WindowFrame.svelte";
  import LazyWindowBody from "../lib/shell/LazyWindowBody.svelte";
  import CommandPalette from "../lib/shell/CommandPalette.svelte";
  import NotificationToast from "../lib/shell/NotificationToast.svelte";
  import ShortcutHelp from "../lib/shell/ShortcutHelp.svelte";
  import { createNotificationStore, type NotificationItem } from "../lib/shell/notifications-store";
  import { CHROME_PROFILES, isChromeChoice, resolveChromeProfile, type ChromeChoice } from "../lib/shell/chrome-profile";
  import type { CommandItem } from "../lib/shell/command-palette";
  import { createWindowStore, stateToUrl, urlToApp, type AppSlugMap, type ShellLayoutState } from "../lib/shell/window-store";
  import { logoutSession, type Session } from "../lib/host-api";
  import "../styles.css";

  const APP_SLUGS: AppSlugMap = {
    assistant: "assistant", files: "files", editor: "editor", docs: "docs", workflows: "workflows",
    integrations: "integrations", channels: "channels", processes: "processes", services: "services",
    packages: "packages", apps: "apps", settings: "settings", terminal: "terminal", devices: "devices",
  };
  const SHORTCUTS = [
    { keys: "Ctrl/Cmd + K", description: "Open command palette" },
    { keys: "Shift + ?", description: "Open keyboard shortcuts" },
    { keys: "Ctrl/Cmd + S", description: "Save active file in Code Editor" },
    { keys: "Escape", description: "Close open dialog" },
  ];

  const winStore = createWindowStore();
  const notifStore = createNotificationStore({ maxItems: 5 });
  const dirtyEditors = new Set<string>();
  const forceCloseOnce = new Set<string>();

  let layout = $state<ShellLayoutState>(winStore.getState());
  let toasts = $state<readonly NotificationItem[]>(notifStore.getItems());
  let activeSession = $state<Session | null>(null);
  let signingOut = $state(false);
  let paletteOpen = $state(false);
  let shortcutsOpen = $state(false);
  let chromeChoice = $state<ChromeChoice>("auto");
  let viewportWidth = $state(1440);
  let ownerDevicesOpened = $state(false);
  let monitorRef: { refresh: () => void } | undefined;

  let resolvedChrome = $derived(resolveChromeProfile(chromeChoice, viewportWidth, typeof navigator === "undefined" ? "" : navigator.userAgent));

  function openApp(app: string, title: string, payload?: unknown, multi = false) {
    winStore.openWindow(app, title, undefined, payload, multi ? { multi: true } : undefined);
  }

  let commands = $derived.by<CommandItem[]>(() => {
    const items: CommandItem[] = [
      { id: "refresh-monitor", label: "Refresh system monitor", category: "System", run: () => monitorRef?.refresh() },
      { id: "shortcuts", label: "Show keyboard shortcuts", category: "Help", shortcut: "?", run: () => { shortcutsOpen = true; } },
    ];
    if (!activeSession?.authenticated) return items;
    const apps: Array<[string, string, unknown?, boolean?]> = [
      ["assistant", "Alfa Assistant"], ["files", "Files", "~", true], ["editor", "Code Editor", undefined, true],
      ["docs", "Docs & Changelog"], ["workflows", "Workflows"], ["processes", "Processes"],
      ["services", "Services"], ["packages", "Packages"], ["apps", "Managed Apps"], ["settings", "Settings"],
    ];
    if (activeSession.role === "owner") {
      apps.push(["integrations", "Integrations"], ["channels", "Channels"], ["terminal", "Terminal"], ["devices", "Devices"]);
    }
    for (const [app, title, payload, multi] of apps) {
      items.push({ id: `open-${app}`, label: `Open ${title}`, category: "Apps", keywords: [app], run: () => openApp(app, title, payload, multi) });
    }
    items.push({ id: "sign-out", label: "Sign out", category: "Session", run: () => void handleSignOut() });
    return items;
  });

  function applyTheme(theme: string) {
    if (typeof document === "undefined") return;
    if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
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
    } else {
      dirtyEditors.delete(winId);
      forceCloseOnce.delete(winId);
      winStore.setCloseGuard(winId, null);
    }
  }

  function handleGlobalKeydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault(); paletteOpen = !paletteOpen; shortcutsOpen = false;
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
    if (!next?.authenticated) { ownerDevicesOpened = false; for (const id of [...winStore.getState().order]) winStore.closeWindow(id); }
  }

  async function handleSignOut() {
    if (signingOut) return;
    signingOut = true;
    try {
      await logoutSession(new AbortController().signal);
      handleSessionChange(null);
      monitorRef?.refresh();
    } catch {
      notifStore.push({ title: "Sign-out failed", detail: "Check connection and retry.", tone: "error" });
    } finally {
      signingOut = false;
    }
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
      <nav class="app-dock" aria-label="Workspace apps">
        <button type="button" onclick={() => openApp("assistant", "Alfa Assistant")}>Open Alfa</button>
        <button type="button" onclick={() => openApp("files", "Files", "~", true)}>Open Files</button>
        <button type="button" onclick={() => openApp("editor", "Code Editor", undefined, true)}>Open Editor</button>
        <button type="button" onclick={() => openApp("docs", "Docs")}>Docs</button>
        <button type="button" onclick={() => openApp("workflows", "Workflows")}>Workflows</button>
        <button type="button" onclick={() => openApp("processes", "Processes")}>Open Processes</button>
        <button type="button" onclick={() => openApp("services", "Services")}>Open Services</button>
        <button type="button" onclick={() => openApp("packages", "Packages")}>Open Packages</button>
        <button type="button" onclick={() => openApp("apps", "Managed Apps")}>Managed Apps</button>
        <button type="button" onclick={() => openApp("settings", "Settings")}>Settings</button>
        {#if activeSession.role === "owner"}
          <button type="button" onclick={() => openApp("integrations", "Integrations")}>Integrations</button>
          <button type="button" onclick={() => openApp("channels", "Channels")}>Channels</button>
          <button type="button" onclick={() => openApp("terminal", "Terminal")}>Open Terminal</button>
          <button type="button" onclick={() => openApp("devices", "Devices")}>Devices</button>
        {/if}
        {#each layout.order as id (id)}
          {@const win = layout.windows[id]}
          {#if win?.minimized}
            <button type="button" class="minimized-chip" onclick={() => winStore.restoreWindow(id)}>Restore {win.title}</button>
          {/if}
        {/each}
      </nav>
      {#if layout.order.length > 0}
        <div class="window-area" data-open-windows={layout.order.length}>
          {#each layout.order as id (id)}
            {@const win = layout.windows[id]}
            {#if win}
              <WindowFrame {win} focused={layout.focused === id} onFocus={(w) => winStore.focusWindow(w)} onMinimize={(w) => winStore.minimizeWindow(w)} onMaximize={(w) => winStore.toggleMaximize(w)} onClose={(w) => winStore.closeWindow(w)}>
                <LazyWindowBody {win} session={activeSession} onFilesPathChange={(p) => winStore.focusApp("files", p)} onThemeChange={applyTheme} onEditorDirtyChange={handleEditorDirtyChange} />
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
<ShortcutHelp open={shortcutsOpen} shortcuts={SHORTCUTS} onClose={() => { shortcutsOpen = false; }} />
<NotificationToast items={toasts} onDismiss={(id) => notifStore.dismiss(id)} />
