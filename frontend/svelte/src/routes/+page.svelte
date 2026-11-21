<script lang="ts">
  import { onMount } from "svelte";
  import Monitor from "../lib/Monitor.svelte";
  import DevicesPanel from "../lib/DevicesPanel.svelte";
  import ProcessesList from "../lib/monitor/ProcessesList.svelte";
  import ServicesList from "../lib/monitor/ServicesList.svelte";
  import FilesManager from "../lib/files/FilesManager.svelte";
  import TerminalApp from "../lib/terminal/TerminalApp.svelte";
  import WindowFrame from "../lib/shell/WindowFrame.svelte";
  import {
    createWindowStore,
    stateToUrl,
    urlToApp,
    type AppSlugMap,
    type ShellLayoutState,
  } from "../lib/shell/window-store";
  import { logoutSession, type Session } from "../lib/host-api";
  import "../styles.css";

  const APP_SLUGS: AppSlugMap = {
    files: "files",
    processes: "processes",
    services: "services",
    terminal: "terminal",
    devices: "devices",
  };

  const winStore = createWindowStore();
  let layout = $state<ShellLayoutState>(winStore.getState());
  let activeSession = $state<Session | null>(null);
  let signingOut = $state(false);
  let signOutError = $state<string | null>(null);
  let ownerDevicesOpened = $state(false);
  let monitorRef: { refresh: () => void } | undefined;

  function syncUrl(next: ShellLayoutState) {
    if (typeof window === "undefined") return;
    const target = stateToUrl(next, APP_SLUGS);
    if (window.location.pathname !== target) {
      window.history.replaceState(null, "", target);
    }
  }

  onMount(() => {
    const unsub = winStore.subscribe((next) => {
      layout = next;
      if (activeSession?.authenticated) syncUrl(next);
    });
    const deep = urlToApp(window.location.pathname, APP_SLUGS);
    if (deep?.app === "files") winStore.openWindow("files", "Files", undefined, deep.path ?? "~", { multi: true });
    else if (deep?.app === "processes") winStore.openWindow("processes", "Processes");
    else if (deep?.app === "services") winStore.openWindow("services", "Services");
    else if (deep?.app === "terminal") winStore.openWindow("terminal", "Terminal");
    else if (deep?.app === "devices") winStore.openWindow("devices", "Devices");
    return unsub;
  });

  function handleSessionChange(next: Session | null) {
    activeSession = next;
    if (next?.authenticated && next.role === "owner" && !ownerDevicesOpened) {
      ownerDevicesOpened = true;
      winStore.openWindow("devices", "Devices");
    }
    if (!next?.authenticated) {
      ownerDevicesOpened = false;
      for (const id of [...winStore.getState().order]) winStore.closeWindow(id);
    }
  }

  async function handleSignOut() {
    if (signingOut) return;
    signingOut = true;
    signOutError = null;
    try {
      await logoutSession(new AbortController().signal);
      handleSessionChange(null);
      monitorRef?.refresh();
    } catch {
      signOutError = "Could not complete sign-out. Check connection and retry.";
    } finally {
      signingOut = false;
    }
  }
</script>

<svelte:head><title>MSO | Svelte migration preview</title></svelte:head>
<a class="skip-link" href="#main-content">Skip to content</a>
<div class="workspace">
  <header class="workspace-header">
    <div class="brand">
      <h1>MSO</h1>
      <span>Svelte + Rust preview</span>
    </div>
    <div class="session-actions">
      {#if activeSession?.authenticated}
        <span class="role-badge">{activeSession.role}</span>
        <button disabled={signingOut} onclick={() => void handleSignOut()}>
          {signingOut ? "Signing out..." : "Sign out"}
        </button>
      {/if}
    </div>
  </header>
  {#if signOutError}
    <p class="feedback error" role="alert">{signOutError}</p>
  {/if}
  <main id="main-content" tabindex="-1" class="workspace-stack">
    <Monitor bind:this={monitorRef} onSessionChange={handleSessionChange} />

    {#if activeSession?.authenticated}
      <nav class="app-dock" aria-label="Workspace apps">
        <button type="button" onclick={() => winStore.openWindow("files", "Files", undefined, "~", { multi: true })}>
          Open Files
        </button>
        <button type="button" onclick={() => winStore.openWindow("processes", "Processes")}>
          Open Processes
        </button>
        <button type="button" onclick={() => winStore.openWindow("services", "Services")}>
          Open Services
        </button>
        {#if activeSession.role === "owner"}
          <button type="button" onclick={() => winStore.openWindow("terminal", "Terminal")}>
            Open Terminal
          </button>
          <button type="button" onclick={() => winStore.openWindow("devices", "Devices")}>
            Devices
          </button>
        {/if}
        {#each layout.order as id (id)}
          {@const win = layout.windows[id]}
          {#if win?.minimized}
            <button type="button" class="minimized-chip" onclick={() => winStore.restoreWindow(id)}>
              Restore {win.title}
            </button>
          {/if}
        {/each}
      </nav>

      {#if layout.order.length > 0}
        <div class="window-area" data-open-windows={layout.order.length}>
          {#each layout.order as id (id)}
            {@const win = layout.windows[id]}
            {#if win}
              <WindowFrame
                {win}
                focused={layout.focused === id}
                onFocus={(wid) => winStore.focusWindow(wid)}
                onMinimize={(wid) => winStore.minimizeWindow(wid)}
                onMaximize={(wid) => winStore.toggleMaximize(wid)}
                onClose={(wid) => winStore.closeWindow(wid)}
              >
                {#if win.app === "files"}
                  <FilesManager
                    initialPath={typeof win.payload === "string" ? win.payload : "~"}
                    onPathChange={(p) => { winStore.focusApp("files", p); }}
                  />
                {:else if win.app === "processes"}
                  <ProcessesList />
                {:else if win.app === "services"}
                  <ServicesList />
                {:else if win.app === "terminal"}
                  <TerminalApp />
                {:else if win.app === "devices" && activeSession.role === "owner"}
                  <DevicesPanel currentDeviceId={activeSession.deviceId} />
                {/if}
              </WindowFrame>
            {/if}
          {/each}
        </div>
      {/if}
    {/if}
  </main>
  <footer>Existing host API, CSRF depth-2, and device permissions. Production cockpit unchanged.</footer>
</div>
