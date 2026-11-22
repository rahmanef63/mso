<script lang="ts">
  import type { Component } from "svelte";
  import type { Session } from "../host-api";
  import type { ChromeChoice, ChromeProfile } from "./chrome-profile";
  import type { ShellLayoutState, WindowState } from "./window-store";

  let {
    win, session, layout, chromeChoice, resolvedChrome, viewportWidth,
    onFilesPathChange, onThemeChange, onChromeChange, onEditorDirtyChange, onOpenInEditor,
  }: {
    win: WindowState;
    session: Session;
    layout: ShellLayoutState;
    chromeChoice: ChromeChoice;
    resolvedChrome: ChromeProfile;
    viewportWidth: number;
    onFilesPathChange: (path: string) => void;
    onThemeChange: (theme: string) => void;
    onChromeChange: (c: ChromeChoice) => void;
    onEditorDirtyChange: (winId: string, dirty: boolean) => void;
    onOpenInEditor: (path: string) => void;
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
    "shell-settings": () => import("./ShellSettingsApp.svelte"),
    terminal: () => import("../terminal/TerminalApp.svelte"),
    devices: () => import("../DevicesPanel.svelte"),
    editor: () => import("../editor/CodeEditorApp.svelte"),
    docs: () => import("../docs/DocsApp.svelte"),
    workflows: () => import("../workflows/WorkflowsApp.svelte"),
    integrations: () => import("../integrations/IntegrationsView.svelte"),
    channels: () => import("../integrations/ChannelsView.svelte"),
    organization: () => import("../organization/OrganizationApp.svelte"),
    memory: () => import("../memory-graph/MemoryGraphApp.svelte"),
    store: () => import("../catalog/AppStoreView.svelte"),
    extensions: () => import("../catalog/ExtensionsView.svelte"),
    infra: () => import("../infra/InfrastructureView.svelte"),
    clipboard: () => import("./ClipboardPanel.svelte"),
    inspector: () => import("./InspectorPanel.svelte"),
    "agent-vault": () => import("../agent-vault/AgentVaultApp.svelte"),
    "agent-group": () => import("../agent-group/AgentGroupApp.svelte"),
    media: () => import("../media/MediaViewerApp.svelte"),
    pickers: () => import("../media/PickersApp.svelte"),
    "create-app": () => import("../create-app/CreateAppView.svelte"),
  };

  const cache = new Map<string, Promise<AnySliceComponent>>();
  const ROLE_PROPS = new Set(["integrations", "channels", "store", "extensions", "infra", "agent-vault", "agent-group", "create-app"]);

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
    if (win.app === "files") return { initialPath: typeof win.payload === "string" ? win.payload : "~", onPathChange: onFilesPathChange };
    if (win.app === "editor") {
      return {
        initialPath: typeof win.payload === "string" ? win.payload : undefined,
        onDirtyChange: (dirty: boolean) => onEditorDirtyChange(win.id, dirty),
      };
    }
    if (win.app === "media") return { initialPath: typeof win.payload === "string" ? win.payload : undefined };
    if (win.app === "settings") return { role: session.role, onThemeChange };
    if (win.app === "shell-settings") return { role: session.role, chromeChoice, onChromeChange, onThemeChange };
    if (win.app === "devices") return { currentDeviceId: session.deviceId };
    if (win.app === "memory") return { role: session.role, onOpenFile: onOpenInEditor };
    if (win.app === "inspector") return { layout, resolvedChrome, viewportWidth, role: session.role };
    if (ROLE_PROPS.has(win.app)) return { role: session.role };
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
