<script lang="ts">
  import type { Component } from "svelte";
  import type { Session } from "../host-api";
  import type { WindowState } from "./window-store";

  let {
    win,
    session,
    onFilesPathChange,
    onThemeChange,
    onEditorDirtyChange,
  }: {
    win: WindowState;
    session: Session;
    onFilesPathChange: (path: string) => void;
    onThemeChange: (theme: string) => void;
    onEditorDirtyChange: (winId: string, dirty: boolean) => void;
  } = $props();

  type AnySliceComponent = Component<Record<string, unknown>>;
  type Loader = () => Promise<{ default: unknown }>;

  const LOADERS: Record<string, Loader> = {
    assistant: () => import("../assistant/AssistantApp.svelte"),
    files: () => import("../files/FilesManager.svelte"),
    processes: () => import("../monitor/ProcessesList.svelte"),
    services: () => import("../monitor/ServicesList.svelte"),
    packages: () => import("../managed-apps/PackagesView.svelte"),
    apps: () => import("../managed-apps/ManagedAppsView.svelte"),
    settings: () => import("../settings/SettingsApp.svelte"),
    terminal: () => import("../terminal/TerminalApp.svelte"),
    devices: () => import("../DevicesPanel.svelte"),
    editor: () => import("../editor/CodeEditorApp.svelte"),
    docs: () => import("../docs/DocsApp.svelte"),
    workflows: () => import("../workflows/WorkflowsApp.svelte"),
    integrations: () => import("../integrations/IntegrationsView.svelte"),
    channels: () => import("../integrations/ChannelsView.svelte"),
  };

  const cache = new Map<string, Promise<AnySliceComponent>>();

  function getSlice(app: string): Promise<AnySliceComponent> | null {
    const loader = LOADERS[app];
    if (!loader) return null;
    let pending = cache.get(app);
    if (!pending) {
      pending = loader().then((mod) => mod.default as AnySliceComponent);
      cache.set(app, pending);
    }
    return pending;
  }

  function sliceProps(): Record<string, unknown> {
    if (win.app === "files") {
      return { initialPath: typeof win.payload === "string" ? win.payload : "~", onPathChange: onFilesPathChange };
    }
    if (win.app === "editor") {
      return {
        initialPath: typeof win.payload === "string" ? win.payload : undefined,
        onDirtyChange: (dirty: boolean) => onEditorDirtyChange(win.id, dirty),
      };
    }
    if (win.app === "settings") return { role: session.role, onThemeChange };
    if (win.app === "devices") return { currentDeviceId: session.deviceId };
    if (win.app === "integrations" || win.app === "channels") return { role: session.role };
    return {};
  }

  let promise = $derived(
    (win.app === "devices" || win.app === "terminal") && session.role !== "owner" ? null : getSlice(win.app),
  );
</script>

{#if promise}
  {#await promise}
    <p class="slice-loading" role="status">Loading {win.title}...</p>
  {:then SliceComponent}
    <SliceComponent {...sliceProps()} />
  {:catch}
    <p class="feedback error" role="alert">Could not load {win.title}. Retry or reopen the window.</p>
  {/await}
{:else}
  <p class="feedback pending">This app is unavailable for your current role.</p>
{/if}

<style>
  .slice-loading { margin: 0; color: var(--muted); font-size: 0.875rem; }
</style>
